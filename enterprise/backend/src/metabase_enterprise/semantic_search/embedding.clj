(ns metabase-enterprise.semantic-search.embedding
  (:require
   [buddy.core.codecs :as buddy-codecs]
   [buddy.core.hash :as buddy-hash]
   [clj-http.client :as http]
   [clojure.string :as str]
   [metabase-enterprise.semantic-search.models.token-tracking :as semantic.models.token-tracking]
   [metabase-enterprise.semantic-search.settings :as semantic-settings]
   [metabase.analytics-interface.core :as analytics]
   [metabase.analytics.core :as analytics.core]
   [metabase.embeddings.provider :as embeddings.provider]
   [metabase.llm.settings :as llm.settings]
   [metabase.premium-features.core :as premium-features]
   [metabase.tracing.core :as tracing]
   [metabase.util :as u]
   [metabase.util.json :as json]
   [metabase.util.log :as log]
   [metabase.util.malli :as mu])
  (:import
   [com.knuddels.jtokkit Encodings]
   [com.knuddels.jtokkit.api Encoding EncodingType]
   [java.net ConnectException]))

(set! *warn-on-reflection* true)

(defn ^:private clean-model-name
  "Clean up a model name to make it friendly for use in index names."
  [model-name]
  (-> model-name
      (str/split #"/")
      last
      (str/replace #"[-:.]" "_")))

(def ^:private model-abbreviations {"small" "sm" "medium" "md" "large" "lg" "tiny" "tn"})

(defn abbrev-model-name
  "Abbreviate long model names for use in index names."
  [model-name]
  (-> model-name
      clean-model-name
      (str/replace #"embedding|embed" "")
      ((fn [s] (reduce-kv str/replace s model-abbreviations)))
      (str/replace #"_{2,}" "_")
      (str/replace #"^_+|_+$" "")))

(defn clean-provider-name
  "Clean up a provider names for use in index names."
  [provider-name]
  (-> provider-name
      (str/replace #"[^A-Za-z0-9_]" "_")
      (str/replace #"_{2,}" "_")
      (str/replace #"^_+|_+$" "")))

(defn abbrev-provider-name
  "Abbreviate long provider names for use in index names."
  [provider-name]
  (case provider-name
    "ai-service" "ais"
    "ollama" "ollama"
    "openai" "openai"
    "in-process" "inproc"
    ;; Every plugin provider uses the same reserved form, including already-safe names. Otherwise an unsafe name's
    ;; encoded output could itself be registered as a safe provider name and collide with the same physical index.
    (str "plugin_" (clean-provider-name provider-name) "_"
         (subs (buddy-codecs/bytes->hex (buddy-hash/sha1 provider-name)) 0 16))))

;;; Token Counting for OpenAI Models

(def ^:private ^Encoding openai-encoding
  "OpenAI tokenizer encoding for cl100k_base (used by text-embedding models)."
  (delay (.getEncoding (Encodings/newDefaultEncodingRegistry) EncodingType/CL100K_BASE)))

(defn- count-tokens
  "Count the number of tokens in a text string using OpenAI's cl100k_base encoding."
  [^String text]
  (when text
    (let [^Encoding encoding @openai-encoding]
      (.size (.encode encoding text)))))

(defn- count-tokens-batch
  "Count the total number of tokens across multiple text strings."
  [texts]
  (reduce + 0 (map count-tokens texts)))

(defn- decode-embeddings
  "Decode OpenAI base64 response"
  [data]
  (vec
   (for [{:keys [embedding]} data]
     (let [bytes  (u/decode-base64-to-bytes ^String embedding)
           buffer (doto (java.nio.ByteBuffer/wrap bytes)
                    (.order java.nio.ByteOrder/LITTLE_ENDIAN))
           length (/ (alength bytes) 4)
           _      (when-not (int? length)
                    (throw (ex-info "Invalid base64 length, not divisible by 4" {:length (alength bytes)})))
           result (float-array length)]
       (.get (.asFloatBuffer buffer) result)
       result))))

;;; Batching Logic

(defn- create-batches
  "Split texts into batches that don't exceed the threshold.
   Returns a vector of batches, where each batch is a vector of texts.
   - threshold: Maximum allowed measure per batch
   - measure: Function to measure each text (e.g., count-tokens)
   - texts: Collection of texts to batch"
  [threshold measure texts]
  (let [step (fn [{:keys [current-batch current-measure batches] :as acc} text]
               (let [text-measure (measure text)]
                 (cond
                   ;; Single text exceeds the limit - skip it with warning
                   ;; TODO (Chris 2026-06-29) -- silently dropping an over-budget doc here is a poor default —
                   ;; it vanishes from the index with only a warning. Make the over-budget policy a per-call
                   ;; option (:truncate / :skip / :error, likely truncate-by-default eventually) and check what
                   ;; the ai-service path does, which bypasses create-batches entirely.
                   ;; https://linear.app/metabase/issue/BOT-1742
                   (> text-measure threshold)
                   (do
                     (log/warn
                      (format "Skipping text that exceeds maximum measure per batch: %s"
                              (str (subs text 0 10) "..."))
                      {:measure text-measure :threshold threshold})
                     acc)

                   ;; Adding this text would exceed the limit - start new batch
                   (> (+ current-measure text-measure) threshold)
                   (assoc acc
                          :current-batch [text]
                          :current-measure text-measure
                          :batches (conj batches current-batch))

                   ;; Add to current batch
                   :else
                   (assoc acc
                          :current-batch (conj current-batch text)
                          :current-measure (+ current-measure text-measure)))))
        {:keys [batches current-batch]}
        (reduce step
                {:current-batch [] :current-measure 0 :batches []}
                texts)]
    (if (seq current-batch)
      (conj batches current-batch)
      batches)))

;;;; Provider API

(defn- record-in-process-token-usage!
  [{:keys [provider model-name]} texts {:keys [record-tokens? type]}]
  (when (= "in-process" provider)
    ;; The bundled tokenizer is intentionally private to the plugin artifact. Use the existing cl100k
    ;; counter as an operational estimate so local inference participates in the same metrics/tracking.
    (let [tokens (count-tokens-batch texts)]
      (analytics/inc! :metabase-search/semantic-embedding-tokens
                      {:provider provider :model model-name}
                      tokens)
      (when record-tokens?
        (semantic.models.token-tracking/record-tokens model-name type tokens)))))

(defn resolve-model
  "Resolve a requested embedding model to its immutable vector-space descriptor."
  [embedding-model]
  (embeddings.provider/resolve-model embedding-model))

(defn get-embedding
  "Return one embedding vector for `text`."
  [embedding-model text & {:as opts}]
  (let [resolved-model (resolve-model embedding-model)]
    (u/prog1 (embeddings.provider/embed-text resolved-model text opts)
      (record-in-process-token-usage! resolved-model [text] opts))))

(defn get-embeddings-batch
  "Return one embedding vector per input text, in the same order."
  [embedding-model texts & {:as opts}]
  (let [resolved-model (resolve-model embedding-model)]
    (u/prog1 (embeddings.provider/embed-texts resolved-model texts opts)
      (record-in-process-token-usage! resolved-model texts opts))))

(defn pull-model
  "Prepare a provider model eagerly when the provider supports it."
  [embedding-model]
  (embeddings.provider/prepare! embedding-model))

;;;; Ollama impl

(defn- ollama-get-embedding [model-name text]
  (try
    ;; TODO count ollama tokens into :metabase-search/semantic-embedding-tokens?
    (log/debug "Generating Ollama embedding for text of length:" (count text))
    (-> (http/post "http://localhost:11434/api/embeddings" ;; TODO: we should make the host configurable
                   {:headers {"Content-Type" "application/json"}
                    :body    (json/encode {:model model-name
                                           :prompt text})})
        :body
        (json/decode true)
        :embedding)
    (catch Exception e
      (log/error e "Failed to generate Ollama embedding for text of length:" (count text))
      (throw e))))

(defn- ollama-get-embeddings-batch [model-name texts]
  ;; Ollama doesn't have a native batch API, so we fall back to individual calls
  ;; No special batching needed for Ollama - just process all texts
  (log/debug "Generating" (count texts) "Ollama embeddings (using individual calls)")
  (mapv #(ollama-get-embedding model-name %) texts))

(defn- ollama-pull-model [model-name]
  (try
    (log/debug "Pulling embedding model from Ollama...")
    (http/post "http://localhost:11434/api/pull" ;; TODO: make the host configurable
               {:headers {"Content-Type" "application/json"}
                :body    (json/encode {:model model-name})})
    (catch Exception e
      (log/error e "Failed to pull embedding model")
      (throw e))))

;;;; OpenAI-compatible embedding service impl (shared by "ai-service" and "openai" providers)

(defn- supports-dimensions?
  "Check whether the model's API supports dimensions in request's body. At the time of writing supported on OpenAI's
  text-embedding-3-small and text-embedding-3-large. Should be supported also on newer models when those are out."
  [{:keys [model-name] :as _embedding-model}]
  (boolean
   (when (string? model-name)
     (str/starts-with? model-name "text-embedding-3"))))

(mu/defn- openai-compatible-get-embeddings-batch
  "Call an OpenAI-compatible /v1/embeddings endpoint. Shared implementation for both
  the `ai-service` and `openai` providers.

  `:provider`        — label for analytics (e.g. \"ai-service\", \"openai\")
  `:endpoint`        — full URL including /v1/embeddings
  `:api-key`         — Bearer token. If empty ai service proxying is assumed and premium-embedding-token is
                       used for authentication
  `:model-name`      — model identifier sent in the request body
  `:texts`           — collection of input strings
  `:record-tokens?`  — true writes a `semantic_search_token_tracking` row, false skips it.
  `:snowplow?`       — optional; when true fires a Snowplow `token_usage` event
  `:extra-body`      — optional; merged into the request body (e.g. `{:dimensions 1024}`)
  `:type`            — optional; forwarded to the token-tracking row"
  [{:keys [provider endpoint api-key model-name texts record-tokens? extra-body snowplow?] :as opts}
   :- [:map
       [:provider       :string]
       [:endpoint       :string]
       [:api-key        {:optional true} [:maybe :string]]
       [:model-name     :string]
       [:texts          [:sequential :string]]
       [:record-tokens? :boolean]
       [:snowplow?      {:optional true} [:maybe :boolean]]
       [:extra-body     {:optional true} [:maybe :map]]]]
  (try
    (log/debug (str "Calling " provider " embeddings API")
               {:endpoint endpoint :documents (count texts) :tokens (count-tokens-batch texts)})
    (let [start-ms             (u/start-timer)
          {:keys [usage data]} (-> (http/post endpoint
                                              {:headers
                                               (merge {"Content-Type"  "application/json"}
                                                      (if (and (empty? api-key)
                                                               (= "ai-service" provider))
                                                        {"x-metabase-instance-token"
                                                         (u/prog1 (premium-features/premium-embedding-token)
                                                           (when (nil? <>)
                                                             (throw (ex-info "Premium embedding token not set"
                                                                             {:provider provider}))))}
                                                        {"Authorization" (str "Bearer " api-key)}))
                                               :body    (json/encode (merge {:model           model-name
                                                                             :input           texts
                                                                             :encoding_format "base64"}
                                                                            extra-body))})
                                   :body
                                   (json/decode true))
          total-tokens         (:total_tokens usage 0)
          prompt-tokens        (:prompt_tokens usage total-tokens)]
      (analytics/inc! :metabase-search/semantic-embedding-tokens
                      {:provider provider :model model-name}
                      total-tokens)
      (when snowplow?
        (analytics.core/track-token-usage!
         {:snowplow            true
          :prometheus          false    ; already tracked via inc! above
          :request-id          (analytics.core/uuid->ai-service-hex-uuid (random-uuid))
          :model-id            model-name
          :total-tokens        total-tokens
          :prompt-tokens       prompt-tokens
          :completion-tokens   0        ; embedding models don't produce completion tokens
          :estimated-costs-usd 0.0
          :duration-ms         (long (u/since-ms start-ms))
          :tag                 "embedding_generation"}))
      (when record-tokens?
        (semantic.models.token-tracking/record-tokens model-name (:type opts) total-tokens))
      (decode-embeddings data))
    (catch ConnectException e
      (log/error e (str "Failed to connect to " provider) {:endpoint endpoint})
      (throw (ex-info (str provider " unavailable (connection refused)")
                      {:status 502 :endpoint endpoint}
                      e)))
    (catch Exception e
      (log/error e (str provider " embeddings API call failed")
                 {:documents (count texts) :tokens (count-tokens-batch texts)})
      (throw e))))

;;;; Embedding-service provider

(defn- trim-trailing-slashes
  [s]
  (cond-> s
    (string? s) (-> (str/trim)
                    (str/replace #"/+$" ""))))

(defn- embedding-service-resolve-config!
  "Returns [endpoint api-key]. When api key is not set or when service url is not set but
  `llm.settings/ai-service-base-url` is set the ai service proxying is assumed. In that case premium-embedding-token
  is used for authentication. Throws if neither base URL is configured."
  []
  (cond (string? (not-empty (semantic-settings/ee-embedding-service-base-url)))
        [(str (trim-trailing-slashes (semantic-settings/ee-embedding-service-base-url)) "/v1/embeddings")
         (semantic-settings/ee-embedding-service-api-key)]

        (string? (not-empty (llm.settings/ai-service-base-url)))
        [(str (trim-trailing-slashes (llm.settings/ai-service-base-url)) "/v1/embeddings")
         nil]

        :else
        (throw (ex-info "Embedding service and ai service base URLs are not configured"
                        {:settings ["ee-embedding-service-base-url"
                                    "ai-service-base-url"]}))))

(defn- ai-service-get-embeddings-batch
  [{:keys [model-name]} texts {:keys [record-tokens? type]}]
  (let [[endpoint api-key] (embedding-service-resolve-config!)]
    (openai-compatible-get-embeddings-batch
     {:provider       "ai-service"
      :endpoint       endpoint
      :api-key        api-key
      :model-name     model-name
      :texts          texts
      :snowplow?      true
      :record-tokens? record-tokens?
      :type           type})))

;;;; OpenAI provider

(defn- openai-resolve-config!
  "Returns [endpoint api-key] or throws if not configured."
  []
  (let [api-key (semantic-settings/openai-api-key)]
    (when-not api-key
      (throw (ex-info "OpenAI API key not configured" {:setting "llm-openai-api-key"})))
    [(str (semantic-settings/openai-api-base-url) "/v1/embeddings") api-key]))

(defn- openai-get-embeddings-batch
  [embedding-model texts {:keys [record-tokens? type]}]
  (let [[endpoint api-key] (openai-resolve-config!)]
    (openai-compatible-get-embeddings-batch
     {:provider       "openai"
      :endpoint       endpoint
      :api-key        api-key
      :model-name     (:model-name embedding-model)
      :texts          texts
      :record-tokens? record-tokens?
      :extra-body     (when (supports-dimensions? embedding-model)
                        {:dimensions (:vector-dimensions embedding-model)})
      :type           type})))

(defn- register-built-in-providers!
  []
  (let [spi-version embeddings.provider/embedding-spi-version
        legacy      embeddings.provider/legacy-resolved-model]
    (embeddings.provider/register-provider!
     "ollama"
     {:embedding-spi-version spi-version
      :readiness             (constantly {:ready? true})
      :resolve-model         legacy
      :embed-texts           (fn [{:keys [model-name]} texts _opts]
                               (ollama-get-embeddings-batch model-name texts))
      :prepare!              (fn [{:keys [model-name]}]
                               (ollama-pull-model model-name))})
    (embeddings.provider/register-provider!
     "ai-service"
     {:embedding-spi-version spi-version
      :readiness             (fn [_]
                               {:ready? (boolean (or (not-empty (semantic-settings/ee-embedding-service-base-url))
                                                     (not-empty (llm.settings/ai-service-base-url))))})
      :resolve-model         legacy
      :embed-texts           ai-service-get-embeddings-batch})
    (embeddings.provider/register-provider!
     "openai"
     {:embedding-spi-version spi-version
      :readiness             (fn [_]
                               {:ready? (boolean (not-empty (semantic-settings/openai-api-key)))})
      :resolve-model         legacy
      :embed-texts           openai-get-embeddings-batch})))

(register-built-in-providers!)

;;;; Query prefixes for asymmetric retrieval models

(def ^:private model-family-query-prefixes
  "Query prefixes for embedding-model families trained for asymmetric retrieval.
  These models expect search queries — but not the indexed documents — to carry a fixed prefix."
  ;; Patterns must be mutually exclusive: lookup scans entries in unspecified order.
  ;; Keep patterns narrow: a false positive is unfixable without a code change, since the
  ;; `ee-embedding-query-prefix` setting can only replace a matched prefix, never suppress it.
  {#"(?i)snowflake-arctic-embed" "query: "})

(defn- default-query-prefix
  [model-name]
  (when model-name
    (some (fn [[pattern prefix]]
            (when (re-find pattern model-name)
              prefix))
          model-family-query-prefixes)))

(defn prefix-search-query
  "Prepend the query prefix expected by `embedding-model` to `search-string`.
  The `ee-embedding-query-prefix` setting overrides the per-model-family default and is prepended verbatim.
  Returns `search-string` unchanged when neither applies."
  [embedding-model search-string]
  (str (or (not-empty (semantic-settings/ee-embedding-query-prefix))
           (default-query-prefix (:model-name embedding-model)))
       search-string))

;;;; Global embedding model

(defn get-configured-model
  "Get the environments default embedding model according to the ee-embedding-provider / ee-embedding-model settings."
  []
  {:provider (semantic-settings/ee-embedding-provider)
   :model-name (semantic-settings/ee-embedding-model)
   :vector-dimensions (semantic-settings/ee-embedding-model-dimensions)})

(defn embedding-supported?
  "Whether the selected provider is installed and configured. This is not a remote liveness probe."
  [embedding-model]
  (embeddings.provider/ready? embedding-model))

(defn- calc-token-metrics
  [texts]
  (let [counts  (map count-tokens texts)
        avg-raw (/ (reduce + counts) (count counts))]
    {:n   (count texts)
     :min (apply min counts)
     :max (apply max counts)
     :sum (reduce + counts)
     :avg (parse-double (format "%.2f" (double avg-raw)))}))

(defn process-embeddings-streaming
  "Process texts in provider-appropriate batches, calling process-fn for each batch. process-fn will be called with
  a map from text to embedding for each batch."
  [embedding-model texts process-fn & {:as opts}]
  (when (seq texts)
    (let [{:keys [model-name provider vector-dimensions]} embedding-model]
      (tracing/with-span :search "search.semantic.embeddings-batch"
        {:search.semantic/provider   provider
         :search.semantic/model-name model-name
         :search.semantic/text-count (count texts)}
        (u/profile (str "Generating embeddings " {:model model-name
                                                  :dimensions vector-dimensions
                                                  :texts (calc-token-metrics texts)})
          (if (= "openai" provider)
            (let [max-tokens-per-batch (semantic-settings/openai-max-tokens-per-batch)
                  batches (create-batches max-tokens-per-batch count-tokens texts)

                  process-batch
                  (fn [batch-idx batch-texts]
                    (let [embeddings (u/profile (format "Embedding batch %d/%d %s"
                                                        (inc batch-idx) (count batches) (str (calc-token-metrics batch-texts)))
                                       (get-embeddings-batch embedding-model batch-texts opts))
                          text-embedding-map (zipmap batch-texts embeddings)]
                      (process-fn text-embedding-map)))]
              (transduce (map-indexed process-batch) (partial merge-with +) batches))
            (let [embeddings (get-embeddings-batch embedding-model texts opts)
                  text-embedding-map (zipmap texts embeddings)]
              (process-fn text-embedding-map))))))))

(comment
  ;; Configuration:
  ;; MB_EE_EMBEDDING_PROVIDER:  "ai-service" (default), "openai", "ollama", or "in-process"
  ;; MB_EE_EMBEDDING_MODEL: optional override (leave empty for provider defaults)
  ;;   - OpenAI default: "text-embedding-3-small"
  ;;   - Ollama default: "mxbai-embed-large"
  ;; MB_EE_EMBEDDING_SERVICE_BASE_URL: URL of the embedding service (for ai-service provider)
  ;; MB_EE_EMBEDDING_SERVICE_API_KEY: API key for the embedding service
  ;; MB_EE_OPENAI_API_KEY: your OpenAI API key (for openai provider)
  ;; MB_EE_EMBEDDING_MODEL_DIMENSIONS: defaults to 1024.

  (def embedding-model (get-configured-model))
  embedding-model
  (pull-model embedding-model)
  (get-embedding embedding-model "hello"))
