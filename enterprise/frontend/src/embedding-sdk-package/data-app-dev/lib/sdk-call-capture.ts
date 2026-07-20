// Captures the harness page's requests to the connected Metabase (the SDK's
// sanctioned channel) into the diagnostics store — the toolbar's Queries tab.
// Dev-only: patches the page's `fetch`, records method/endpoint/status/duration,
// and the row count for query endpoints. The sandboxed app can't reach the
// Metabase origin itself, so everything captured here went through the SDK.

import { recordDevDiagnostic } from "../components/DevToolbar/diagnostics";

const QUERY_ENDPOINT_RE = /^\/api\/(dataset($|\/)|card\/\d+\/query)/;

let installed = false;

const resolveUrl = (input: RequestInfo | URL): URL | null => {
  try {
    if (typeof input === "string" || input instanceof URL) {
      return new URL(String(input), window.location.href);
    }
    return new URL(input.url, window.location.href);
  } catch {
    return null;
  }
};

const resolveMethod = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): string => {
  const method =
    init?.method ?? (input instanceof Request ? input.method : "GET");
  return method.toUpperCase();
};

const readRowCount = (body: unknown): number | undefined => {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    return undefined;
  }
  const { data } = body;
  if (typeof data !== "object" || data === null || !("rows" in data)) {
    return undefined;
  }
  return Array.isArray(data.rows) ? data.rows.length : undefined;
};

const captureRowCount = async (
  endpoint: string,
  response: Response,
): Promise<number | undefined> => {
  if (!response.ok || !QUERY_ENDPOINT_RE.test(endpoint)) {
    return undefined;
  }
  try {
    return readRowCount(await response.clone().json());
  } catch {
    return undefined;
  }
};

/**
 * Start capturing SDK→Metabase calls. Call before the SDK issues its first
 * request. Idempotent; a missing `metabaseUrl` (unset `.env.local`) is a no-op —
 * the Connection tab reports that case.
 */
export function installSdkCallCapture(metabaseUrl: string | undefined): void {
  if (installed || typeof window === "undefined" || !metabaseUrl) {
    return;
  }

  let metabaseOrigin: string;
  try {
    metabaseOrigin = new URL(metabaseUrl).origin;
  } catch {
    return;
  }
  installed = true;

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveUrl(input);
    if (url?.origin !== metabaseOrigin) {
      return realFetch(input, init);
    }

    const method = resolveMethod(input, init);
    const endpoint = url.pathname;
    const startedAt = performance.now();
    const durationMs = () => Math.round(performance.now() - startedAt);

    try {
      const response = await realFetch(input, init);
      recordDevDiagnostic({
        kind: "sdk-call",
        method,
        endpoint,
        status: response.status,
        durationMs: durationMs(),
        rowCount: await captureRowCount(endpoint, response),
      });
      return response;
    } catch (error) {
      recordDevDiagnostic({
        kind: "sdk-call",
        method,
        endpoint,
        status: null,
        durationMs: durationMs(),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}
