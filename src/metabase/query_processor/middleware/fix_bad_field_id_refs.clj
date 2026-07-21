(ns metabase.query-processor.middleware.fix-bad-field-id-refs
  "Middleware that adds `:join-alias` info to `:field` clauses where needed."
  (:refer-clojure :exclude [get-in])
  (:require
   [clojure.string :as str]
   [metabase.lib.core :as lib]
   [metabase.lib.field.resolution :as lib.field.resolution]
   [metabase.lib.metadata :as lib.metadata]
   [metabase.lib.schema :as lib.schema]
   [metabase.lib.walk :as lib.walk]
   [metabase.util.malli :as mu]
   [metabase.util.match :as match]
   [metabase.util.performance :refer [get-in]]))

(defn- middleware-options
  "Qualified options added to a ref by QP middleware to track its work -- e.g. the remap markers added
  by [[metabase.query-processor.middleware.add-remaps]]. These get propagated into result-column metadata
  by [[metabase.lib.field.resolution/opts-fn-options]] (which uses the same predicate as this function), so they need
  to survive when we rewrite a ref -- dropping them breaks things like FK remapping for questions whose source table
  was swapped out for a sandbox subquery (#78187)."
  [opts]
  (not-empty
   (into {}
         (filter (fn [[k _v]]
                   (and (qualified-keyword? k)
                        (not= (namespace k) "lib")
                        (not (str/starts-with? (namespace k) "metabase.lib")))))
         opts)))

(mu/defn- fix-bad-field-id-refs-in-stage :- [:maybe ::lib.schema/stage]
  [query :- ::lib.schema/query
   path  :- ::lib.walk/path
   stage :- ::lib.schema/stage]
  (let [first-stage-path (conj (pop (vec path)) 0)
        source-table     (:source-table (get-in query first-stage-path))
        update-fields    (fn update-fields [form]
                           (match/replace form
                             ;; don't recurse into joins. But should we update conditions tho.
                             {:lib/type :mbql/join}
                             (update &match :conditions update-fields)

                             [:field (opts :guard (not (:join-alias opts))) (id :guard pos-int?)]
                             (or (when-let [col (lib.metadata/field query id)]
                                   (when-not (= (:table-id col) source-table)
                                     (when-let [resolved (lib.walk/apply-f-for-stage-at-path
                                                          lib.field.resolution/resolve-field-ref
                                                          query path &match)]
                                       (let [mw-opts (middleware-options opts)]
                                         (cond-> (lib/ref resolved)
                                           (:lib/expression-name opts)
                                           (lib/update-options assoc :lib/expression-name (:lib/expression-name opts))

                                           mw-opts
                                           (lib/update-options merge mw-opts))))))
                                 &match)))
        stage' (update-fields stage)]
    (when-not (= stage' stage)
      ;; normalizing the stage will remove any duplicate `:fields` or `:breakouts`
      (lib/normalize ::lib.schema/stage stage'))))

(mu/defn fix-bad-field-id-refs :- ::lib.schema/query
  "Fix any `:field` refs using an integer Field ID that in a stage where that Field's Table is not the
  `:source-table`. Convert them to Field name refs and add info like `:join-alias` as needed."
  [query :- ::lib.schema/query]
  (lib.walk/walk-stages query fix-bad-field-id-refs-in-stage))
