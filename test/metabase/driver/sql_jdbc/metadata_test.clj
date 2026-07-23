(ns metabase.driver.sql-jdbc.metadata-test
  {:clj-kondo/config '{:linters {:deprecated-var {:exclude {metabase.test.data/mbql-query {:namespaces [metabase.driver.sql-jdbc.metadata-test]}}}}}}
  (:require
   [clojure.test :refer :all]
   [metabase.driver.sql-jdbc.execute :as sql-jdbc.execute]
   [metabase.driver.sql-jdbc.metadata :as sql-jdbc.metadata]
   [metabase.test :as mt])
  (:import
   (java.sql PreparedStatement ResultSet ResultSetMetaData)))

(deftest ^:parallel native-query-metadata-test
  (testing "Should be able to get metadata without actually running the query (#28195)"
    (is (=? [{:lib/type      :metadata/column
              :name          "ID"
              :database-type "BIGINT"
              :base-type     :type/BigInteger}
             {:lib/type      :metadata/column
              :name          "NAME"
              :database-type "CHARACTER VARYING"
              :base-type     :type/Text}
             {:lib/type      :metadata/column
              :name          "CATEGORY_ID"
              :database-type "INTEGER"
              :base-type     :type/Integer}
             {:lib/type      :metadata/column
              :name          "LATITUDE"
              :database-type "DOUBLE PRECISION"
              :base-type     :type/Float}
             {:lib/type      :metadata/column
              :name          "LONGITUDE"
              :database-type "DOUBLE PRECISION"
              :base-type     :type/Float}
             {:lib/type      :metadata/column
              :name          "PRICE"
              :database-type "INTEGER"
              :base-type     :type/Integer}]
            (sql-jdbc.metadata/query-result-metadata
             :h2
             (mt/native-query {:query "SELECT * FROM venues WHERE id = ?;", :params [1]}))))))

(deftest native-query-metadata-falls-back-to-result-set-test
  (testing "Fall back to executing the prepared statement when the driver cannot return metadata before execution"
    (let [rsmeta (proxy [ResultSetMetaData] []
                   (getColumnCount [] 1)
                   (getColumnLabel [_] "ID")
                   (getColumnTypeName [_] "INTEGER"))
          rs     (proxy [ResultSet] []
                   (getMetaData [] rsmeta)
                   (close [] nil))
          stmt   (proxy [PreparedStatement] []
                   (getMetaData [] nil)
                   (executeQuery [] rs)
                   (close [] nil))
          db     (assoc (mt/db) :lib/type :metadata/database)]
      (with-redefs [sql-jdbc.execute/do-with-connection-with-options (fn [_driver _database _options f]
                                                                       (f nil))
                    sql-jdbc.execute/prepared-statement                (fn [_driver _conn _sql _params]
                                                                         stmt)]
        (is (=? [{:lib/type      :metadata/column
                  :name          "ID"
                  :database-type "INTEGER"
                  :base-type     :type/Integer}]
                (sql-jdbc.metadata/query-result-metadata
                 :h2
                 db
                 "SELECT id FROM venues"
                 nil)))))))
