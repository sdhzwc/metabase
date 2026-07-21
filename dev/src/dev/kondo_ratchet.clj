(ns dev.kondo-ratchet
  "Ratchet on inline kondo ignore forms.

  Per-linter budgets live in `.clj-kondo/ratchets.edn`, along with the set of linters whose ignores don't
  need a justification comment.
  `metabase.core.kondo-ratchet-test` fails when either drifts from the tree;
  `./bin/mage fix-kondo-ratchets` lowers budgets and drops stale exemptions, never the reverse.
  Loaded by both the bb task and the JVM test, so keep it dependency-free."
  {:clj-kondo/config '{:linters {:discouraged-var {clojure.core/println {:level :off}}}}}
  (:require
   [clojure.edn :as edn]
   [clojure.java.io :as io]
   [clojure.string :as str]))

(set! *warn-on-reflection* true)

(def ratchets-file
  "The budgets file, relative to the repo root."
  ".clj-kondo/ratchets.edn")

(def ^:private source-roots
  ["src" "test" "enterprise" "modules/drivers" "dev" "bin" "mage"])

(def ^:private source-extensions
  [".clj" ".cljc" ".cljs"])

;; Concatenated so this file never contains a literal ignore marker.
(def ^:private ignore-marker
  (str ":clj-kondo" "/ignore"))

;; `#_{... [:some-linter]}`, `^{... [:some-linter]}`, and the prefix-less attr-map form
;; `(ns foo {... [:some-linter]})`; the vector may span lines. The lazy tail after the vector runs to the
;; map's own closing brace, so extra keys still count and removal spans the whole form; a nested-brace
;; value stops the match at the vector instead.
(def ^:private vector-form-re
  (re-pattern (str "(?:(?:#_|\\^)\\s*)?\\{\\s*" ignore-marker "\\s*\\[([^\\]]*)\\](?:[^{}]*?\\})?")))

;; Bare `#_kw` / `^kw` with no linter vector: suppresses every linter on the next form.
(def ^:private bare-form-re
  (re-pattern (str "(?:#_\\s*|\\^)" ignore-marker "(?![\\w./-])")))

;; The ignore key with its linter vector, wherever it appears. On its own this says nothing about
;; whether the key is a real ignore or just data that happens to look like one -- see
;; [[embedded-matches]], which decides that by looking at what encloses it.
(def ^:private ignore-key-re
  (re-pattern (str ignore-marker "\\s*\\[([^\\]]*)\\]")))

(defn mask-strings-and-comments
  "`content` with string-literal and line-comment interiors replaced by spaces, newlines kept.
  Same length as the input, so offsets and line numbers carry over.
  Ignore forms inside strings (test fixtures) or commented-out code must not count.
  The `;` that starts a comment survives, and no other `;` does, so [[justified?]] can locate real
  trailing comments."
  [content]
  (let [sb (StringBuilder. ^String content)
        n  (count content)]
    (loop [i 0, state :code]
      (if (>= i n)
        (str sb)
        (let [c (.charAt sb i)]
          (case state
            :code    (case c
                       \" (recur (inc i) :string)
                       \; (recur (inc i) :comment)
                       ;; char literal: mask the next char so it can't open a string or start a comment
                       \\ (do (when (< (inc i) n)
                                (when-not (= (.charAt sb (inc i)) \newline)
                                  (.setCharAt sb (inc i) \space)))
                              (recur (+ i 2) :code))
                       (recur (inc i) :code))
            :string  (case c
                       \" (recur (inc i) :code)
                       \\ (do (.setCharAt sb i \space)
                              (when (< (inc i) n)
                                (when-not (= (.charAt sb (inc i)) \newline)
                                  (.setCharAt sb (inc i) \space)))
                              (recur (+ i 2) :string))
                       \newline (recur (inc i) :string)
                       (do (.setCharAt sb i \space)
                           (recur (inc i) :string)))
            :comment (if (= c \newline)
                       (recur (inc i) :code)
                       (do (.setCharAt sb i \space)
                           (recur (inc i) :comment)))))))))

(defn- linter-keywords
  [vector-contents]
  (map (comp keyword #(subs % 1))
       (re-seq #":[A-Za-z][A-Za-z0-9*+!?<>=._/-]*" vector-contents)))

(defn- offset->line
  "1-based line number of character offset `i` in `content`."
  [content i]
  (inc (count (filter #(= % \newline) (subs content 0 i)))))

(defn- matches-with-offsets
  "Like re-seq, but returns `{:start _, :end _, :linters [...]}` for each match of `re` in `masked`."
  [re masked bare?]
  (let [m (re-matcher re masked)]
    (loop [acc []]
      (if (.find m)
        (recur (conj acc {:start   (.start m)
                          :end     (.end m)
                          :linters (if bare? [:all] (vec (linter-keywords (.group m 1))))}))
        acc))))

;; A justifying comment has a letter somewhere in it; a bare `;;` or a `;; ----` section divider does not.
;; Deliberately does not require the letter in the *first* token: `;; -- why this is needed` and
;; `;; 0.57.0 deprecation, no replacement yet` are perfectly good justifications.
(def ^:private substantive-comment-re
  #";+.*[A-Za-z].*")

(defn- justified?
  "Does the ignore starting at `start`/ending at `end` in `content` have an explanatory comment?
  Counts a substantive trailing comment on the same line, or a comment *line* directly above -- the
  nearest preceding non-blank line, with nothing but the comment on it. A trailing comment belongs to
  the code it sits after, so `(f) ; note about f` above an ignore is not a justification for it.
  Comment openers are located in `masked`, where the `;` starting a real comment survives but any `;`
  inside a string literal is blanked out; the comment *text* is then read from `content`, since masking
  blanks a comment's interior. So neither a `;;`-looking line inside a multi-line string nor a literal
  `;` earlier on the line can pose as -- or hide -- a justification."
  [content masked start end]
  (let [line-num    (offset->line content start)
        line-end    (or (str/index-of content "\n" end) (count content))
        raw-lines   (vec (str/split-lines content))
        mask-lines  (vec (str/split-lines masked))
        comment-at  (fn [i]
                      ;; find the opener in the masked line, then read the text from the raw one
                      (when-let [raw (get raw-lines i)]
                        (when-let [c (str/index-of (get mask-lines i "") ";")]
                          {:code (subs raw 0 c), :comment (subs raw c)})))
        prev-idx    (->> (range (- line-num 2) -1 -1)
                         (drop-while #(str/blank? (get raw-lines % "")))
                         first)]
    (boolean (or (when-let [i (str/index-of masked ";" end)]
                   (when (< i line-end)
                     (re-matches substantive-comment-re (str/trim (subs content i line-end)))))
                 (when-let [{:keys [code comment]} (some-> prev-idx comment-at)]
                   (and (str/blank? code)
                        (re-matches substantive-comment-re (str/trim comment))))))))

(defn- enclosing-opener
  "Index of the delimiter directly enclosing `i` in `s`, or nil if `i` is at top level. Walks backwards
  balancing `)]}` against `([{`, so nested forms are skipped rather than mistaken for the enclosure."
  ^Long [^String s ^long i]
  (loop [j (dec i), depth 0]
    (when (>= j 0)
      (let [c (.charAt s j)]
        (cond
          (or (= c \)) (= c \]) (= c \})) (recur (dec j) (inc depth))
          (or (= c \() (= c \[) (= c \{)) (if (zero? depth) j (recur (dec j) (dec depth)))
          :else                              (recur (dec j) depth))))))

(defn- skip-blanks
  "Index of the first thing at or after `i` in masked source `s` that could start a form. Whitespace,
  commas and comments are not forms; masking blanks a comment's interior but leaves its `;`, so a
  comment is skipped by running to the end of its line."
  ^long [^String s ^long i]
  (let [n (count s)]
    (loop [j i]
      (if (>= j n)
        n
        (let [c (.charAt s j)]
          (cond
            (or (Character/isWhitespace c) (= \, c)) (recur (inc j))
            (= \; c)                                 (recur (long (or (str/index-of s "\n" j) n)))
            :else                                    j))))))

(defn- discard-at?
  "Is there a `#_` -- which drops the form after it -- at `i` in `s`?"
  [^String s ^long i]
  (and (= \# (.charAt s i))
       (< (inc i) (count s))
       (= \_ (.charAt s (inc i)))))

(defn- form-end
  "Index just past the whole form starting at `i` in masked source `s`. Bracketed forms are skipped
  whole and a string runs to its closing quote (masking leaves both quotes in place). A reader prefix
  reads as one form with what follows it, so `^String x`, `#inst \"...\"`, `'sym` and `#_ dropped` each
  end where that trailing form does. Anything else is a token running to the next delimiter or space."
  ^long [^String s ^long i]
  (let [n (count s)]
    (if (>= i n)
      n
      (let [c (.charAt s i)]
        (cond
          (contains? #{\( \[ \{} c)
          (loop [j (inc i), depth 1]
            (if (>= j n)
              j
              (case (.charAt s j)
                (\( \[ \{) (recur (inc j) (inc depth))
                (\) \] \}) (if (= depth 1) (inc j) (recur (inc j) (dec depth)))
                (recur (inc j) depth))))

          (= \" c)
          (if-let [k (str/index-of s "\"" (inc i))] (inc (long k)) n)

          ;; `^meta value` reads as one form, and so does `#tag value` -- but `##Inf` and friends are
          ;; symbolic values that stand alone, so they fall through to the token scan below
          (or (= \^ c)
              (and (= \# c) (not (contains? #{\_ \{ \( \" \' \#} (get s (inc i))))))
          (let [decoration-end (form-end s (skip-blanks s (inc i)))]
            (form-end s (skip-blanks s decoration-end)))

          ;; a quote, a deref, an unquote, `#_`, and the dispatch forms `#{} #() #"" #'` each take a
          ;; single form after them -- but `##Inf`, `##-Inf` and `##NaN` are whole forms in themselves
          (and (contains? #{\# \' \@ \~ \`} c)
               (not= \# (get s (inc i))))
          (form-end s (skip-blanks s (+ i (if (discard-at? s i) 2 1))))

          :else
          (loop [j i]
            (if (or (>= j n)
                    (Character/isWhitespace (.charAt s j))
                    (contains? #{\( \) \[ \] \{ \} \" \, \;} (.charAt s j)))
              j
              (recur (inc j)))))))))

(defn- key-position?
  "Is the form at `i` in masked source `s` a key of the map opening at `opener`? Counts the forms in
  between -- an even count means `i` is a key, an odd one a value -- reading each the way the reader
  would, so metadata, tags and quotes stay attached to what they decorate and a `#_` form drops out
  entirely. This is what tells the suppression `{:a 1 :clj-kondo/ignore [:x]}` from the data
  `{:label :clj-kondo/ignore [:x]}`, where the marker is a value."
  [^String s ^long opener ^long i]
  (loop [j (skip-blanks s (inc opener)), forms 0]
    (if (>= j i)
      (and (= j i) (even? forms))
      (let [discard? (discard-at? s j)
            ;; never stand still, whatever the source looks like: a scanner that can't advance would
            ;; hang the whole ratchet
            end      (max (inc j) (form-end s j))]
        (recur (skip-blanks s end) (if discard? forms (inc forms)))))))

(defn- prefixed-form?
  "Does the form opening at `i` in `s` carry a `#_` or `^` prefix?"
  [^String s ^long i]
  (let [before (str/trimr (subs s 0 i))]
    (or (str/ends-with? before "#_")
        (str/ends-with? before "^"))))

(defn- forms-in
  "The forms of the list opening at `list-open` in masked source `s`, as `{:start _, :end _}` maps, up to
  and including the one starting at `until` (or all of them, when it isn't one of them)."
  [^String s ^long list-open ^long until]
  (loop [j (skip-blanks s (inc list-open)), acc []]
    (let [c (get s j)]
      (if (or (nil? c) (= \) c) (> j until))
        acc
        (let [end (max (inc j) (form-end s j))
              acc (conj acc {:start j, :end end})]
          (if (= j until)
            acc
            (recur (skip-blanks s end) acc)))))))

(defn- vector-form?
  "Does the form at `i` in masked source `s` read as a vector? Metadata is stepped over, so `^:tag [x]`
  counts, and a reader conditional is taken as one too -- it may well expand to the argument vector, and
  the only thing that costs us is counting an ignore we could have ruled out."
  [^String s ^long i]
  (loop [j i]
    (let [c (get s j)]
      (cond
        (= \[ c)                         true
        (and (= \# c) (= \? (get s (inc j)))) true
        (= \^ c)                         (recur (skip-blanks s (form-end s (skip-blanks s (inc j)))))
        :else                            false))))

(defn- attr-map-context?
  "Is the map opening at `opener` in masked source `s` somewhere an ignore key would suppress anything,
  rather than plain data that happens to contain the marker? A `#_` or `^` prefix settles it. Failing
  that it has to be a real attr map: kondo reads one in `(ns ...)`, and in a `def...` form in the slot
  before the argument vector -- so `(defn f {...} [x] ...)` is one, while `(def x {...})`, where the map
  is the value, and `(defn f [x] {...} nil)`, where it is a body form, are not. `defmethod` is the
  def-form whose second argument is legitimately a map -- the dispatch value -- so it is excluded.

  Deliberately a blocklist rather than a list of known def-forms: the project defines plenty of its own
  `def...` macros, and failing to recognise one of those would silently stop counting a real ignore,
  where a data map wrongly counted only costs a budget entry and a justification comment."
  [^String s ^long opener]
  (or (prefixed-form? s opener)
      (when-let [list-open (enclosing-opener s opener)]
        (when (= \( (.charAt s (long list-open)))
          (let [forms (forms-in s list-open opener)
                head  (when-let [{:keys [start end]} (first forms)] (subs s start end))
                after (skip-blanks s (form-end s opener))]
            (or (= "ns" head)
                (and head
                     (str/starts-with? head "def")
                     (not= "defmethod" head)
                     ;; the argument vector comes after the attr map, never before it
                     (not-any? #(vector-form? s (:start %)) (butlast (rest forms)))
                     (< after (count s))
                     (not= \) (.charAt s after)))))))))

(defn- embedded-matches
  "Ignore keys sitting behind other keys in a metadata/attr map, e.g. `^{:added \"x\" :clj-kondo/ignore
  [:y]}`. These count and need justification like any ignore, but removal tooling must skip them --
  excising one would take the map's other keys along. `:form-start` is the enclosing map's `{`: the
  ignore is part of that form, so that is the line it belongs to and the line a justification sits above.

  Structural on purpose, not regex-bounded. The key counts only when a `{` directly encloses it, it sits
  in key position, and that map is somewhere a suppression can live -- so `^{:doc [:clj-kondo/ignore
  [:x]]}`, `{:label :clj-kondo/ignore [:x]}` and `(def x {:a 1 :clj-kondo/ignore [:x]})` are all data,
  while `^{:opts {:a 1} :clj-kondo/ignore [:x]}` counts despite the nested map in front of it. A regex
  bounded by `[^{}]` gets all of those backwards."
  [^String masked]
  (let [m (re-matcher ignore-key-re masked)]
    (loop [acc []]
      (if (.find m)
        (let [opener (enclosing-opener masked (.start m))]
          (recur (if (and opener
                          (= \{ (.charAt masked (long opener)))
                          (key-position? masked opener (.start m))
                          (attr-map-context? masked opener))
                   (conj acc {:start      (.start m)
                              :end        (.end m)
                              :form-start opener
                              :linters    (vec (linter-keywords (.group m 1)))})
                   acc)))
        acc))))

(defn ignore-matches
  "Inline ignore matches in `content`, in file order:
  `{:start _, :end _, :line _, :linters [...], :justified? _}` with character offsets and a 1-based line.
  An ignore key buried behind other attr-map keys is included too, tagged `:embedded? true` -- it
  counts and needs justification, but removal tooling must skip it (excising it would take the map's
  other keys along). Matches inside string literals or line comments are excluded.

  The line and the justification are those of the *form*, which for an embedded key is the attr map it
  sits in rather than the key itself. In a multi-line attr map those differ, and the comment a reader
  writes above the form is the one that justifies it."
  [content]
  (let [masked   (mask-strings-and-comments content)
        ;; an unprefixed `{...}` match is only a suppression where an attr map would be read -- the same
        ;; test the embedded keys get, since `{:clj-kondo/ignore [:x] :a 1}` in data is no different
        suppressing? (fn [{:keys [start]}]
                       (or (not= \{ (.charAt ^String masked (long start)))
                           (attr-map-context? masked start)))
        primary  (concat (filter suppressing? (matches-with-offsets vector-form-re masked false))
                         (matches-with-offsets bare-form-re masked true))
        covered? (fn [{:keys [start end]}]
                   (some #(and (< start (:end %)) (< (:start %) end)) primary))
        embedded (->> (embedded-matches masked)
                      (remove covered?)
                      (map #(assoc % :embedded? true)))]
    (->> (concat primary embedded)
         (sort-by :start)
         (map (fn [{:keys [start end form-start] :as match}]
                (let [anchor (or form-start start)]
                  (-> match
                      (dissoc :form-start)
                      (assoc :line       (offset->line masked anchor)
                             :justified? (justified? content masked anchor end)))))))))

(defn line-linters
  "Linter keywords suppressed by inline ignore forms on `line`.
  The bare vector-less form counts as `:all`.
  Like [[scan]], ignore forms inside string literals or line comments don't count."
  [line]
  (mapcat :linters (ignore-matches line)))

(defn scan
  "Occurrences of inline ignore forms under `roots` (relative to the repo root).
  Returns `{:file \"src/...\", :line 42, :linters [...], :justified? boolean}` maps.
  Forms inside string literals or line comments don't count."
  ([]
   (scan source-roots))
  ([roots]
   (for [root  roots
         ^java.io.File f (file-seq (io/file root))
         :when (and (.isFile f)
                    (some #(str/ends-with? (.getPath f) %) source-extensions))
         :let  [content (slurp f)]
         :when (str/includes? content ignore-marker)
         m     (ignore-matches content)]
     (cond-> {:file       (.getPath f)
              :line       (:line m)
              :linters    (:linters m)
              :justified? (:justified? m)}
       (:embedded? m) (assoc :embedded? true)))))

(defn actual-counts
  "Per-linter occurrence counts for `occurrences`, as returned by [[scan]]."
  [occurrences]
  (frequencies (mapcat :linters occurrences)))

(defn- sorted-by-str
  [kvs]
  (into (sorted-map-by #(compare (str %1) (str %2))) kvs))

(defn drift
  "Linters whose count in `occurrences` differs from its budget in `recorded` (absent = 0, either side).
  Returns `{linter {:recorded _, :actual _}}`, plus `:examples` (up to 5 `file:line`) when over budget."
  [recorded occurrences]
  (let [actual (actual-counts occurrences)]
    (sorted-by-str
     (for [linter (into (set (keys actual)) (keys recorded))
           :let   [budget (get recorded linter 0)
                   n      (get actual linter 0)]
           :when  (not= budget n)]
       [linter (cond-> {:recorded budget, :actual n}
                 (> n budget)
                 (assoc :examples (->> occurrences
                                       (filter #(some #{linter} (:linters %)))
                                       (map #(str (:file %) ":" (:line %)))
                                       (take 5)
                                       vec)))]))))

(defn unjustified
  "Occurrences that need a justification comment but lack one: not [[justified?]], and suppressing at
  least one linter outside the `exempt` set."
  [exempt occurrences]
  (for [{:keys [linters justified?] :as occurrence} occurrences
        :when (and (not justified?)
                   (seq (remove exempt linters)))]
    occurrence))

(defn stale-exemptions
  "Linters in `exempt` that no longer have any unjustified ignore, so the exemption can go."
  [exempt occurrences]
  (let [still-needed (set (mapcat :linters (unjustified #{} occurrences)))]
    (into (sorted-set-by #(compare (str %1) (str %2)))
          (remove still-needed)
          exempt)))

(defn read-ratchets
  "Parsed contents of [[ratchets-file]], with empty defaults when the file doesn't exist."
  []
  (merge {:ignore-counts {}, :comment-exempt #{}}
         (when (.exists (io/file ratchets-file))
           (edn/read-string (slurp ratchets-file)))))

(def ^:private header
  (str ";; Per-linter budgets for inline `" ignore-marker "` forms.\n"
       ";; metabase.core.kondo-ratchet-test fails when the budgets drift from the actual counts, or when a\n"
       ";; linter outside :comment-exempt has an ignore with no explanatory comment above (or trailing) it.\n"
       ";; `./bin/mage fix-kondo-ratchets` lowers budgets and drops stale exemptions; local test runs do it\n"
       ";; automatically. Raising a budget, adding one for a new linter (`--seed`), or widening the\n"
       ";; exemptions is a hand edit to defend in your PR.\n"
       ";; :all is the vector-less ignore form, which suppresses every linter on the next form.\n"))

(defn render
  "Text of the ratchets file for the `{:ignore-counts _, :comment-exempt _}` map `ratchets`.
  Byte-stable: [[fix!]] idempotency and the file-hygiene test depend on it."
  [{:keys [ignore-counts comment-exempt]}]
  (let [counts-indent (apply str (repeat (count "{:ignore-counts  {") \space))
        exempt-indent (apply str (repeat (count " :comment-exempt #{") \space))]
    (str header
         "{:ignore-counts  "
         (if (empty? ignore-counts)
           "{}"
           (let [entries (sort-by (comp str first) ignore-counts)
                 width   (apply max (map (comp count str first) entries))]
             (str "{"
                  (str/join (str "\n" counts-indent)
                            (for [[linter n] entries]
                              (format (str "%-" width "s %d") (str linter) n)))
                  "}")))
         "\n :comment-exempt "
         (if (empty? comment-exempt)
           "#{}"
           (str "#{"
                (str/join (str "\n" exempt-indent)
                          (sort-by str comment-exempt))
                "}"))
         "}\n")))

(defn lowered-counts
  "`recorded` with each budget lowered to its actual count; entries with no ignores left are dropped.
  Linters in `seeded` get their budget set to the actual count outright — the explicit escape hatch for
  landing a new linter. Otherwise never raises a budget, never adds one."
  [recorded actual seeded]
  (into (sorted-by-str
         (for [linter seeded
               :when  (pos? (get actual linter 0))]
           [linter (get actual linter)]))
        (keep (fn [[linter budget]]
                (let [n (get actual linter 0)]
                  (cond
                    (contains? (set seeded) linter) nil
                    (zero? n)                       nil
                    (< n budget)                    [linter n]
                    :else                           [linter budget]))))
        recorded))

(defn change-report
  "The lines [[fix!]] prints: lowered/dropped/seeded budgets, dropped exemptions, plus warnings for
  anything over budget."
  [{:keys [ignore-counts comment-exempt]} occurrences seeded]
  (let [actual (actual-counts occurrences)]
    (concat
     (for [linter seeded
           :let   [n (get actual linter 0)]]
       (if (pos? n)
         (format "seeded %s at %d" linter n)
         (format "WARNING: %s has no inline ignores -- nothing to seed" linter)))
     (for [[linter budget] (sort-by (comp str first) (apply dissoc ignore-counts seeded))
           :let            [n (get actual linter 0)]
           :when           (not= n budget)]
       (cond
         (zero? n)    (format "dropped %s (no ignores left)" linter)
         (< n budget) (format "lowered %s %d -> %d" linter budget n)
         :else        (format "WARNING: %s is over budget (%d recorded, %d actual) -- remove ignores, or accept them all with `--seed %s`"
                              linter budget n linter)))
     (for [[linter n] (sort-by (comp str first) (apply dissoc actual (concat seeded (keys ignore-counts))))]
       (format "WARNING: %s has %d ignores but no budget entry -- seed one with `./bin/mage fix-kondo-ratchets --seed %s`"
               linter n linter))
     (for [linter (stale-exemptions comment-exempt occurrences)]
       (format "unexempted %s (all its ignores are justified now)" linter)))))

(defn fix!
  "Rewrite [[ratchets-file]]: lower budgets, drop stale comment exemptions, normalize formatting.
  `--seed LINTER` (`{:seed \"...\"}` here) sets that budget to the actual count, adding or raising it.
  Prints the [[change-report]], or `unchanged` on a no-op."
  ([]
   (fix! nil))
  ([{:keys [seed]}]
   (let [{:keys [ignore-counts comment-exempt] :as ratchets} (read-ratchets)
         occurrences (scan)
         seeded      (if seed [(keyword (str/replace-first seed #"^:" ""))] [])
         actual      (actual-counts occurrences)
         text        (render {:ignore-counts  (lowered-counts ignore-counts actual seeded)
                              :comment-exempt (reduce disj comment-exempt (stale-exemptions comment-exempt occurrences))})
         file        (io/file ratchets-file)
         old         (when (.exists file) (slurp file))]
     (run! println (change-report ratchets occurrences seeded))
     (if (= old text)
       (println "unchanged")
       (do (spit file text)
           (println (str "wrote " ratchets-file)))))))
