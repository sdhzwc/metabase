(ns metabase.metabot.self.openai-compatible
  "Shared adapter for direct OpenAI-compatible Chat Completions providers."
  (:require
   [clojure.string :as str]
   [metabase.metabot.self.core :as core]
   [metabase.metabot.self.debug :as debug]
   [metabase.metabot.self.openrouter :as openrouter]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.json :as json]
   [metabase.util.log :as log]
   [metabase.util.o11y :refer [with-span]]))

(set! *warn-on-reflection* true)

(defn- ai-proxy-unsupported-ex
  [provider-name]
  (ex-info (tru "AI proxy is not supported for {0}" provider-name)
           {:api-error  true
            :error-code :proxy-unsupported}))

(defn- api-error-msg
  [provider-name res]
  (let [status (long (:status res 0))]
    (case status
      401 (tru "{0} API key expired or invalid" provider-name)
      402 (tru "{0} account has insufficient credits" provider-name)
      403 (tru "{0} API key has insufficient permissions" provider-name)
      404 (tru "{0} API endpoint is unavailable" provider-name)
      429 (tru "{0} has rate limited us" provider-name)
      500 (tru "{0} returned an internal server error" provider-name)
      502 (tru "{0} upstream provider returned an error" provider-name)
      503 (tru "{0} service is unavailable" provider-name)
      (tru "{0} API error (HTTP {1})" provider-name status))))

(defn- auth
  [{:keys [provider provider-name api-base-url api-key credentials ai-proxy?]}]
  (when ai-proxy?
    (throw (ai-proxy-unsupported-ex provider-name)))
  (core/resolve-auth provider provider-name
                     (when-let [api-key (or (some-> credentials :api-key str/trim not-empty)
                                            (some-> (api-key) str/trim not-empty))]
                       {:url     (api-base-url)
                        :headers {"Authorization" (str "Bearer " api-key)}})
                     ai-proxy?))

(defn list-models
  "List supported models for an OpenAI-compatible provider.
  `config` must include `:provider`, `:provider-name`, `:api-base-url`, `:api-key`, and `:supported-models`."
  ([config]
   (list-models config {}))
  ([{:keys [provider supported-models models-url] :as config} opts]
   (try
     (let [auth (auth (merge config opts))
           res  (core/request auth {:method  :get
                                    :url     (or models-url "/models")
                                    :as      :json
                                    :headers {"Content-Type" "application/json"}})]
       {:models (->> (get-in res [:body :data])
                     (filter (fn [{:keys [id]}]
                               (contains? supported-models id)))
                     (sort-by :id)
                     (mapv (fn [{:keys [id name]}]
                             {:id id :display_name (or (supported-models id) name id)})))})
     (catch Exception e
       (core/rethrow-api-error! provider
                                (partial api-error-msg (:provider-name config))
                                e)))))

(defn raw
  "Perform a streaming Chat Completions request for an OpenAI-compatible provider."
  [{:keys [provider provider-name chat-completions-url] :as config}
   {:keys [model tools ai-proxy?] :as opts}]
  (when ai-proxy?
    (throw (ai-proxy-unsupported-ex provider-name)))
  (let [req (openrouter/openrouter-request-body opts)
        url (or chat-completions-url "/chat/completions")]
    (log/debug (str provider-name " request")
               {:model model :msg-count (count (:messages req)) :tools (count (or tools []))})
    (with-span :info {:name       (keyword "metabot" (str provider "/request"))
                      :model      model
                      :msg-count  (count (:messages req))
                      :tool-count (count (or tools []))}
      (try
        (let [response (core/request (auth (merge config opts))
                                     {:method  :post
                                      :url     url
                                      :as      :stream
                                      :headers {"Content-Type" "application/json"}
                                      :body    (json/encode req)})]
          (-> (core/sse-reducible (:body response))
              (debug/capture-stream {:provider provider
                                     :model    model
                                     :url      url
                                     :request  req})))
        (catch Exception e
          (core/rethrow-api-error! provider
                                   (partial api-error-msg provider-name)
                                   e))))))

(defn stream
  "Call an OpenAI-compatible Chat Completions provider, returning an AISDK stream."
  [config opts]
  (eduction (openrouter/openrouter->aisdk-chunks-xf) (raw config opts)))
