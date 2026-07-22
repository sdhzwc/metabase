(ns metabase.metabot.self.xiaomi
  "Xiaomi MiMo Chat Completions adapter."
  (:require
   [metabase.llm.settings :as llm]
   [metabase.metabot.self.openai-compatible :as openai-compatible]))

(def ^:private config
  {:provider             "xiaomi"
   :provider-name        "Xiaomi MiMo"
   :api-base-url         llm/llm-xiaomi-api-base-url
   :api-key              llm/llm-xiaomi-api-key
   :models-url           "/models"
   :chat-completions-url "/chat/completions"
   :supported-models     {"mimo-v2.5"     "MiMo v2.5"
                          "mimo-v2.5-pro" "MiMo v2.5 Pro"}})

(defn list-models
  ([] (list-models {}))
  ([opts]
   (openai-compatible/list-models config opts)))

(defn xiaomi
  [& args]
  (openai-compatible/stream config (first args)))
