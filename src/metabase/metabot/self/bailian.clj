(ns metabase.metabot.self.bailian
  "Alibaba Cloud Bailian Chat Completions adapter."
  (:require
   [metabase.llm.settings :as llm]
   [metabase.metabot.self.openai-compatible :as openai-compatible]))

(def ^:private config
  {:provider             "bailian"
   :provider-name        "Alibaba Cloud Bailian"
   :api-base-url         llm/llm-bailian-api-base-url
   :api-key              llm/llm-bailian-api-key
   :models-url           "/models"
   :chat-completions-url "/chat/completions"
   :supported-models     {"qwen-flash" "Qwen Flash"
                          "qwen-plus"  "Qwen Plus"}})

(defn list-models
  ([] (list-models {}))
  ([opts]
   (openai-compatible/list-models config opts)))

(defn bailian
  [& args]
  (openai-compatible/stream config (first args)))
