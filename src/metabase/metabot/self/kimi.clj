(ns metabase.metabot.self.kimi
  "Kimi Chat Completions adapter."
  (:require
   [metabase.llm.settings :as llm]
   [metabase.metabot.self.openai-compatible :as openai-compatible]))

(def ^:private config
  {:provider             "kimi"
   :provider-name        "Kimi"
   :api-base-url         llm/llm-kimi-api-base-url
   :api-key              llm/llm-kimi-api-key
   :models-url           "/models"
   :chat-completions-url "/chat/completions"
   :supported-models     {"kimi-k2.6" "Kimi K2.6"
                          "kimi-k3"   "Kimi K3"}})

(defn list-models
  ([] (list-models {}))
  ([opts]
   (openai-compatible/list-models config opts)))

(defn kimi
  [& args]
  (openai-compatible/stream config (first args)))
