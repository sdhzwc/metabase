// Patches the page's `fetch` to record SDK→Metabase calls for the Queries tab.
// The sandboxed app can't reach the Metabase origin, so everything here is the SDK.

import { recordDevDiagnostic } from "../components/DevToolbar/diagnostics";

// Exact paths only: `/api/dataset/csv` etc. are exports, and buffering one to
// count rows would download the whole file before the caller sees the response.
const QUERY_ENDPOINT_RE = /^\/api\/(dataset|card\/\d+\/query)$/;

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
  // Belt and braces with the path check above.
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return undefined;
  }
  try {
    return readRowCount(await response.clone().json());
  } catch {
    return undefined;
  }
};

/** Aborts are routine — StrictMode remounts, superseded queries — not failures. */
const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

/**
 * Call before the SDK issues its first request. Idempotent; a missing
 * `metabaseUrl` is a no-op. The teardown restores the original `fetch`, so a
 * re-mounted harness can't wrap an already-wrapped fetch and double-record.
 */
export function installSdkCallCapture(
  metabaseUrl: string | undefined,
): () => void {
  if (installed || typeof window === "undefined" || !metabaseUrl) {
    return () => undefined;
  }

  let metabaseOrigin: string;
  let basePath: string;
  try {
    const parsed = new URL(metabaseUrl);
    metabaseOrigin = parsed.origin;
    // A sub-path deployment prefixes every path; strip it.
    basePath = parsed.pathname.replace(/\/+$/, "");
  } catch {
    return () => undefined;
  }
  installed = true;

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveUrl(input);
    if (
      url?.origin !== metabaseOrigin ||
      (basePath && !url.pathname.startsWith(basePath))
    ) {
      return realFetch(input, init);
    }

    const method = resolveMethod(input, init);
    const endpoint = url.pathname.slice(basePath.length) || "/";
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
      if (!isAbort(error)) {
        recordDevDiagnostic({
          kind: "sdk-call",
          method,
          endpoint,
          status: null,
          durationMs: durationMs(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  };

  return () => {
    window.fetch = realFetch;
    installed = false;
  };
}
