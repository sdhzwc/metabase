import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type Plugin, type Rollup, build } from "vite";

// A namespace import stays single-line so the disable covers the reported line.
// eslint-disable-next-line metabase/no-external-references-for-sdk-package-code
import * as dataAppVirtualModules from "build-configs/embedding-sdk/constants/data-app-virtual-modules";

import { DATA_APP_BUNDLE_URL, DATA_APP_REBUILT_EVENT } from "../bundle";
import { dataAppBuildPlugins, dataAppLibBuild } from "../config/build-config";
import { getDataAppDefine } from "../config/define";
import { validateDataAppManifest } from "../config/validate-manifest";
import {
  DATA_APP_DIAGNOSTICS_EVENT,
  DATA_APP_DIAGNOSTICS_URL,
  type DataAppDiagnosticPayload,
  type DataAppDiagnosticsMessage,
  type DataAppDiagnosticsReport,
  type DevConnectionStatus,
  capDiagnosticEntries,
  truncateDiagnosticText,
} from "../diagnostics-channel";

const { DATA_APP_DEV_CONFIG_VIRTUAL_ID, DATA_APP_DEV_ENTRY_VIRTUAL_ID } =
  dataAppVirtualModules;

const DEV_ENTRY_SOURCE_PATH = fileURLToPath(
  new URL("data-app-dev-entry.js", import.meta.url),
);

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

// Rollup's virtual-module marker: a leading NUL tells plugins the id is synthetic.
const RESOLVED_PREFIX = "\0";

export function dataAppSandboxDevPlugin(
  appSlug: string,
  allowedHosts: string[],
): Plugin {
  let bundleCode = "";

  let diagnosticEntries: DataAppDiagnosticPayload[] = [];
  let diagnosticConnection: DevConnectionStatus | null = null;
  let manifestStatus: ReturnType<typeof validateDataAppManifest> | null = null;
  let lastReportAt: number | null = null;
  let lastRebuildAt: number | null = null;
  let currentSession: string | null = null;
  // Re-stamped server-side: the page's counter restarts at 1 on every reload, so
  // trusting it would make fresh events sort before a poller's cursor.
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
        // Inline: only `chunk.code` is kept, so a sibling `.map` has nothing to
        // resolve against.
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

      server.ws.on(
        DATA_APP_DIAGNOSTICS_EVENT,
        (message: DataAppDiagnosticsMessage) => {
          lastReportAt = Date.now();
          diagnosticConnection = message?.connection ?? diagnosticConnection;

          // A new page: drop the previous one's events, but keep `nextEventId`
          // climbing so an existing poller's cursor stays valid.
          if (message?.session && message.session !== currentSession) {
            if (currentSession !== null) {
              diagnosticEntries = [];
            }
            currentSession = message.session;
          }

          if (Array.isArray(message?.entries) && message.entries.length > 0) {
            // Re-capped: the socket is only as trustworthy as any local process.
            const stamped = message.entries.map((entry) => ({
              ...entry,
              summary: truncateDiagnosticText(String(entry.summary ?? "")),
              detail:
                entry.detail == null
                  ? null
                  : truncateDiagnosticText(String(entry.detail)),
              eventId: nextEventId++,
            }));

            diagnosticEntries = capDiagnosticEntries([
              ...diagnosticEntries,
              ...stamped,
            ]);
          }
        },
      );

      server.middlewares.use((req, res, next) => {
        const [pathname, query] = (req.url ?? "").split("?");
        if (pathname !== DATA_APP_DIAGNOSTICS_URL) {
          next();

          return;
        }

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
          clients: server.ws.clients.size,
          lastReportAt,
          lastRebuildAt,
          nextEventId: (diagnosticEntries.at(-1)?.eventId ?? 0) + 1,
          session: currentSession,
        };

        res.setHeader("Content-Type", "application/json");
        // Repeated reads hit the same URL, so a cached response would freeze the
        // toolbar on stale data.
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(report, null, 2));
      });

      const srcDir = `${path.sep}src${path.sep}`;

      server.watcher.on("change", async (file) => {
        if (file.includes(srcDir)) {
          await rebuildAndNotify();
        }
      });

      const refreshManifestStatus = () => {
        manifestStatus = validateDataAppManifest(root, allowedHosts);
      };

      refreshManifestStatus();

      server.watcher.on("all", (_event, file) => {
        if (path.basename(file) === "data_app.yaml") {
          refreshManifestStatus();
        }
      });

      // Registered after Vite's own middlewares so it only catches navigations,
      // not module/asset fetches.
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
