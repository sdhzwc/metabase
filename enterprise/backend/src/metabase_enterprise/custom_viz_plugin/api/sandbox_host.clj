(ns metabase-enterprise.custom-viz-plugin.api.sandbox-host
  "Unauthed donor endpoint for the near-membrane custom-viz sandbox.

  The donor is loaded as an iframe `src`, which carries no headers and, in EAJS (iframe) embedding,
  no first-party cookies either, so it cannot be session-authed. The document is inert: no scripts,
  no data. The only capability it grants is `'unsafe-eval'` confined to its own realm.

  Because it is unauthed it must stay inert: never add content, data, or parameters to this endpoint.
  The response body and headers are pinned exactly by a test to make that hard to do by accident.

  `frame-ancestors` is `*` rather than an allowlist: EAJS has no embedding-origin allowlist to check
  against (the embed page itself is served with `frame-ancestors *`), and the customer page must be
  an allowed ancestor of the donor iframe.

  Fetch-metadata gate: browsers attach `Sec-Fetch-*` headers that page JS cannot forge, so the
  endpoint 404s any browser-attested load that is not a same-origin iframe navigation. That keeps
  this from being a reusable public utility (no hotlinking, no top-level tabs, no cross-site
  framing of the donor URL itself); it is resource isolation, not authentication. A session-authed
  request skips the gate: the gate only guards the unauthed path."
  (:require
   [metabase-enterprise.custom-viz-plugin.settings :as custom-viz.settings]
   [metabase.api.macros :as api.macros]))

(set! *warn-on-reflection* true)

(def ^:private sandbox-host-html
  "Minimal HTML doc that the patched `@locker/near-membrane-dom` loads as the iframe document
   so plugin code can be `eval`'d under a relaxed, per-iframe CSP."
  "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>")

(def ^:private sandbox-host-csp
  "CSP applied ONLY to the sandbox iframe document.
   - `'unsafe-eval'` required by near-membrane to evaluate plugin code inside the realm.
   - `frame-ancestors *` instead of `X-Frame-Options`, so EAJS customer pages can frame it too."
  "default-src 'none'; script-src 'unsafe-eval'; frame-ancestors *;")

(defn- sec-fetch-allowed?
  "Fetch-metadata resource isolation. Browsers set `Sec-Fetch-*` on every request and page JS
   cannot forge them, so reject any browser-attested load that is not a same-origin iframe
   navigation. Absent headers (older browsers, non-browser clients) are allowed: this is
   isolation, not authentication, and a non-browser client only gets the inert document anyway."
  [{:keys [headers]}]
  (let [site (get headers "sec-fetch-site")
        dest (get headers "sec-fetch-dest")]
    (and (or (nil? site) (= site "same-origin"))
         (or (nil? dest) (= dest "iframe")))))

(api.macros/defendpoint :get "/sandbox-host" :- :any
  "Serve a minimal HTML document used as the iframe `src` for the near-membrane custom-viz
   sandbox. The response carries a per-document `Content-Security-Policy` that permits
   `'unsafe-eval'` only inside this iframe, so the main Metabase document keeps its strict
   nonce-based CSP. 404s unless the custom-viz kill switch is on and the request is either
   session-authed or passes the fetch-metadata gate (see [[sec-fetch-allowed?]])."
  [_route-params _query-params _body request]
  (if-not (and (custom-viz.settings/enable-custom-viz?)
               (or (:metabase-user-id request)
                   (sec-fetch-allowed? request)))
    {:status  404
     :headers {"Content-Type"  "text/plain; charset=utf-8"
               "Cache-Control" "no-store"}
     :body    "Not found"}
    {:status  200
     :headers {"Content-Type"                 "text/html; charset=utf-8"
               "Content-Security-Policy"      sandbox-host-csp
               ;; nil drops the header: the global security middleware would otherwise inject
               ;; X-Frame-Options: DENY, which blocks the cross-origin framing EAJS needs.
               "X-Frame-Options"              nil
               "X-Content-Type-Options"       "nosniff"
               "Cross-Origin-Resource-Policy" "same-origin"
               "Referrer-Policy"              "no-referrer"
               "Cache-Control"                "public, max-age=60"}
     :body    sandbox-host-html}))

(def ^{:arglists '([request respond raise])} routes
  "Unauthed `/api/ee/custom-viz-plugin/sandbox-host` donor route, mounted alongside the
   session-authed custom-viz-plugin routes."
  (api.macros/ns-handler *ns*))
