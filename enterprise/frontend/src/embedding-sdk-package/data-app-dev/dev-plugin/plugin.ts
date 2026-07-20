import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type Plugin, type Rollup, build } from "vite";

// Build-time string constants shared with the rspack config; bundled as values,
// so this references no app runtime code (cf. `use-load-sdk-bundle.ts`). A
// namespace import stays single-line so the disable covers the reported line.
// eslint-disable-next-line metabase/no-external-references-for-sdk-package-code
import * as dataAppVirtualModules from "build-configs/embedding-sdk/constants/data-app-virtual-modules";

import { DATA_APP_BUNDLE_URL, DATA_APP_REBUILT_EVENT } from "../bundle";
import { dataAppBuildPlugins, dataAppLibBuild } from "../config/build-config";
import { getDataAppDefine } from "../config/define";
import { validateDataAppManifest } from "../config/validate-manifest";
import {
  DATA_APP_DIAGNOSTICS_EVENT,
  DATA_APP_DIAGNOSTICS_LIMIT,
  DATA_APP_DIAGNOSTICS_URL,
  type DataAppDiagnosticPayload,
  type DataAppDiagnosticsMessage,
  type DataAppDiagnosticsReport,
  truncateDiagnosticText,
} from "../diagnostics-channel";
import { DATA_APP_MANIFEST_EVENT } from "../manifest-status";

// Virtual modules the dev server provides. The dev server serves a synthetic
// `index.html` (below) that imports the dev entry; the dev entry imports the
// config (the app's allowed hosts + the bundle URL/event). The dev entry is the
// prebuilt `data-app-dev-entry.js` (bundled by the SDK's browser build, shipped
// next to this bundle in `dist`); it keeps React + `@metabase/embedding-sdk-react`
// external so the consumer's Vite resolves them to its single instance.
const { DATA_APP_DEV_CONFIG_VIRTUAL_ID, DATA_APP_DEV_ENTRY_VIRTUAL_ID } =
  dataAppVirtualModules;

const DEV_ENTRY_SOURCE_PATH = fileURLToPath(
  new URL("data-app-dev-entry.js", import.meta.url),
);

// The dev server's HTML shell, served synthetically so the app scaffold needs no
// `index.html`. It just boots the dev entry (resolved + served as a virtual
// module below), which injects the baseline reset CSS itself (the same file the
// production iframe loads).
const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Data App Dev Preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">
      import ${JSON.stringify(DATA_APP_DEV_ENTRY_VIRTUAL_ID)};
    </script>
  </body>
</html>
`;

/**
 * The `@metabase/embedding-sdk-react` version installed in the app, resolved
 * from the app's own dependency tree (the package exports `./package.json`).
 * `null` when it can't be resolved — the toolbar shows "unknown".
 */
function readInstalledSdkVersion(appRoot: string): string | null {
  try {
    const requireFromApp = createRequire(path.join(appRoot, "package.json"));
    const pkg: unknown = requireFromApp(
      "@metabase/embedding-sdk-react/package.json",
    );
    return typeof pkg === "object" &&
      pkg !== null &&
      "version" in pkg &&
      typeof pkg.version === "string"
      ? pkg.version
      : null;
  } catch {
    return null;
  }
}

// Rollup/Vite's virtual-module marker: a leading NUL byte tells Rollup core and
// other plugins that an id is synthetic, so they don't try to resolve/load it
// from disk. It's a convention (not a public export), so we spell it out; Vite
// encodes it as `__x00__` in dev URLs.
const RESOLVED_PREFIX = "\0";

/**
 * Makes `npm run dev` run the app through the real Near-Membrane sandbox instead
 * of mounting it un-sandboxed, so dev behaves like production — including for
 * third-party libraries the app bundles.
 *
 * The membrane evaluates a code string, not Vite's module graph, so the app is
 * built in-memory as the production IIFE on server start and on every `src/`
 * change, served at `DATA_APP_BUNDLE_URL`. Instead of a full page reload it emits
 * `DATA_APP_REBUILT_EVENT`, and the dev entry re-evaluates the new bundle in the
 * live sandbox and re-renders in place — preserving the loaded SDK + auth (a
 * soft reload; component state still resets, since the app is an opaque bundle).
 */
export function dataAppSandboxDevPlugin(
  appSlug: string,
  allowedHosts: string[],
): Plugin {
  let bundleCode = "";

  // Mirror of the page's diagnostics, so tools without a browser can read it.
  let diagnosticEntries: DataAppDiagnosticPayload[] = [];
  let diagnosticConnection: unknown = null;
  // Validated here, not reported by the page: the dev server is what reads
  // `data_app.yaml`, so round-tripping it through the client only added a race
  // where the feed could report "not validated yet" for a perfectly valid file.
  let manifestStatus: ReturnType<typeof validateDataAppManifest> | null = null;
  let lastReportAt: number | null = null;
  let lastRebuildAt: number | null = null;
  // Ids are re-stamped server-side: the page's counter restarts at 1 on every
  // reload, so trusting it would make fresh events sort *before* a poller's
  // cursor and silently disappear.
  let nextEventId = 1;

  const rebuild = async (root: string, mode: string) => {
    const result = await build({
      root,
      mode,
      configFile: false,
      define: getDataAppDefine(mode),
      logLevel: "warn",
      plugins: dataAppBuildPlugins(),
      build: {
        write: false,
        minify: mode === "production",
        // Inline, not a sibling `.map`: only `chunk.code` is kept below and the
        // result is handed to the sandbox as a string, so a file reference has
        // nothing to resolve against. This is what lets DevTools show the
        // original `src/` files in stacks and breakpoints.
        sourcemap: "inline",
        ...dataAppLibBuild("data-app-bundle.js"),
      },
    });

    const outputs = Array.isArray(result) ? result : [result];

    bundleCode =
      outputs
        .flatMap((output) => ("output" in output ? output.output : []))
        .find((chunk): chunk is Rollup.OutputChunk => chunk.type === "chunk")
        ?.code ?? "";

    lastRebuildAt = Date.now();
  };

  return {
    name: "metabase-data-app-dev",
    apply: "serve",

    resolveId(id) {
      if (
        id === DATA_APP_DEV_ENTRY_VIRTUAL_ID ||
        id === DATA_APP_DEV_CONFIG_VIRTUAL_ID
      ) {
        return RESOLVED_PREFIX + id;
      }
    },

    load(id) {
      if (id === RESOLVED_PREFIX + DATA_APP_DEV_ENTRY_VIRTUAL_ID) {
        return fs.readFileSync(DEV_ENTRY_SOURCE_PATH, "utf8");
      }

      if (id === RESOLVED_PREFIX + DATA_APP_DEV_CONFIG_VIRTUAL_ID) {
        return [
          `export const allowedHosts = ${JSON.stringify(allowedHosts)};`,
          `export const appSlug = ${JSON.stringify(appSlug)};`,
          `export const bundleUrl = ${JSON.stringify(DATA_APP_BUNDLE_URL)};`,
          `export const rebuiltEvent = ${JSON.stringify(DATA_APP_REBUILT_EVENT)};`,
          `export const manifestEvent = ${JSON.stringify(DATA_APP_MANIFEST_EVENT)};`,
          `export const sdkVersion = ${JSON.stringify(readInstalledSdkVersion(process.cwd()))};`,
        ].join("\n");
      }
    },

    async configureServer(server) {
      const { root, mode } = server.config;

      const safeRebuild = async (): Promise<boolean> => {
        try {
          await rebuild(root, mode);

          return true;
        } catch (error) {
          server.config.logger.error(
            `[data-app-dev] failed to build the app bundle: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );

          return false;
        }
      };

      // Coalesce rebuilds: at most one Vite build runs at a time, and changes
      // that arrive mid-build collapse into a single follow-up — so a burst of
      // saves can't back up a queue of full rebuilds (or fire a soft reload each).
      let building = false;
      let pending = false;
      const rebuildAndNotify = async () => {
        if (building) {
          pending = true;
          return;
        }

        building = true;
        try {
          let built = false;
          do {
            pending = false;
            built = await safeRebuild();
          } while (pending);

          if (built) {
            server.ws.send({ type: "custom", event: DATA_APP_REBUILT_EVENT });
          }
        } finally {
          building = false;
        }
      };

      // Initial build; no client is connected yet, so nothing to notify.
      await safeRebuild();

      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== DATA_APP_BUNDLE_URL) {
          next();

          return;
        }

        if (!bundleCode) {
          res.statusCode = 503;
          res.setHeader("Content-Type", "text/plain");
          res.end("data-app bundle is not built — see the dev server logs.");

          return;
        }

        res.setHeader("Content-Type", "text/javascript");
        res.end(bundleCode);
      });

      // The page mirrors its diagnostics store up the socket; we buffer it and
      // re-serve it as JSON below, so an agent with only a shell reads exactly
      // what a human reads in the toolbar.
      server.ws.on(
        DATA_APP_DIAGNOSTICS_EVENT,
        (message: DataAppDiagnosticsMessage) => {
          lastReportAt = Date.now();
          // Only the connection status is the page's to report — it's the page
          // that reaches Metabase. The manifest is validated here (below), so it
          // is never taken from the client.
          diagnosticConnection = message?.connection ?? diagnosticConnection;

          if (Array.isArray(message?.entries) && message.entries.length > 0) {
            // Re-capped server-side: the socket is only as trustworthy as any
            // local process, and this buffer is re-serialized on every poll.
            const stamped = message.entries.map((entry) => ({
              ...entry,
              summary: truncateDiagnosticText(String(entry.summary ?? "")),
              detail:
                entry.detail == null
                  ? null
                  : truncateDiagnosticText(String(entry.detail)),
              eventId: nextEventId++,
            }));

            diagnosticEntries = [...diagnosticEntries, ...stamped].slice(
              -DATA_APP_DIAGNOSTICS_LIMIT,
            );
          }
        },
      );

      server.middlewares.use((req, res, next) => {
        const [pathname, query] = (req.url ?? "").split("?");
        if (pathname !== DATA_APP_DIAGNOSTICS_URL) {
          next();

          return;
        }

        // The toolbar's Clear button. Clears for every reader, since the buffer
        // is the one source both the panel and any external poller read.
        if (req.method === "DELETE") {
          diagnosticEntries = [];
          res.statusCode = 204;
          res.end();

          return;
        }

        const startEventId = Number(
          new URLSearchParams(query).get("startEventId"),
        );
        const entries = Number.isFinite(startEventId)
          ? diagnosticEntries.filter((entry) => entry.eventId >= startEventId)
          : diagnosticEntries;

        const report: DataAppDiagnosticsReport = {
          entries,
          connection: diagnosticConnection,
          manifest: manifestStatus,
          // Zero clients means nothing has run: an empty `entries` then says
          // nothing about the app's health.
          clients: server.ws.clients.size,
          lastReportAt,
          lastRebuildAt,
          nextEventId: (diagnosticEntries.at(-1)?.eventId ?? 0) + 1,
        };

        res.setHeader("Content-Type", "application/json");
        // Repeated reads hit the same URL whenever no new events arrive, and a
        // heuristically cached response would freeze the toolbar on stale data.
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(report, null, 2));
      });

      const srcDir = `${path.sep}src${path.sep}`;

      server.watcher.on("change", async (file) => {
        if (file.includes(srcDir)) {
          await rebuildAndNotify();
        }
      });

      // Manifest validation for the toolbar's Manifest tab: push the current
      // status to each client as it connects, and re-validate + push on every
      // `data_app.yaml` change (including create/delete — hence "all").
      // `allowedHosts` stays what the server booted with, so the validator can
      // flag a drifted allowlist as restart-required.
      const sendManifestStatus = () => {
        manifestStatus = validateDataAppManifest(root, allowedHosts);
        server.ws.send({
          type: "custom",
          event: DATA_APP_MANIFEST_EVENT,
          data: manifestStatus,
        });
      };

      // Validate up front so the feed carries a status before any client
      // connects — an agent polling before the preview is open still gets it.
      manifestStatus = validateDataAppManifest(root, allowedHosts);

      server.ws.on("connection", sendManifestStatus);

      server.watcher.on("all", (_event, file) => {
        if (path.basename(file) === "data_app.yaml") {
          sendManifestStatus();
        }
      });

      // Serve the synthetic index.html as a POST middleware (after Vite's
      // transform/asset middlewares) so it only catches navigation requests —
      // the initial load and any deep link / SPA route, not module/asset fetches.
      // `transformIndexHtml` injects the HMR client + resolves the entry import.
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (
            req.method !== "GET" ||
            !req.headers.accept?.includes("text/html")
          ) {
            next();

            return;
          }

          try {
            const html = await server.transformIndexHtml(
              req.url ?? "/",
              INDEX_HTML,
            );

            res.statusCode = 200;

            // Apply the configured `server.headers` (our CSP) to this document.
            const configuredHeaders = server.config.server.headers;
            if (configuredHeaders) {
              for (const [name, value] of Object.entries(configuredHeaders)) {
                if (value != null) {
                  res.setHeader(name, value);
                }
              }
            }

            res.setHeader("Content-Type", "text/html");
            res.end(html);
          } catch (error) {
            next(error);
          }
        });
      };
    },
  };
}
