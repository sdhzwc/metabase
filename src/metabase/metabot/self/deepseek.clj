(ns metabase.metabot.self.deepseek
  "DeepSeek Chat Completions adapter."
  (:require
   [metabase.llm.settings :as llm]
   [metabase.metabot.self.openai-compatible :as openai-compatible]))

(def ^:private config
  {:provider             "deepseek"
   :provider-name        "DeepSeek"
   :api-base-url         llm/llm-deepseek-api-base-url
   :api-key              llm/llm-deepseek-api-key
   :models-url           "/models"
   :chat-completions-url "/chat/completions"
   :supported-models     {"deepseek-v4-flash" "DeepSeek V4 Flash"
                          "deepseek-v4-pro"   "DeepSeek V4 Pro"}})

(defn list-models
  ([] (list-models {}))
  ([opts]
   (openai-compatible/list-models config opts)))

(defn deepseek
  [& args]
  (openai-compatible/stream config (first args)))
