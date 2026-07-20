// Boot-time connection check for the data-app dev harness: is the configured
// Metabase reachable, is the API key valid, and which versions are talking.
// Results land in the diagnostics store (the toolbar's Connection tab) — the
// failure modes here (unset env vars, dead URL, revoked key) are otherwise
// silent and just make every SDK call fail.

import {
  type DevConnectionStatus,
  setDevConnectionStatus,
} from "../components/DevToolbar/diagnostics";

export interface DevConnectionCheckOptions {
  /** `DATA_APP_MB_URL` as provided — may be empty when `.env.local` is unset. */
  metabaseUrl: string | undefined;
  /** `DATA_APP_MB_API_KEY` as provided — may be empty. */
  apiKey: string | undefined;
  /** The installed `@metabase/embedding-sdk-react` version, when resolvable. */
  sdkVersion: string | null;
  /**
   * Fetch to probe with. Pass the page's fetch captured *before*
   * `installSdkCallCapture` patches it, so these probes don't show up as SDK
   * calls in the Queries tab.
   */
  fetchFn?: typeof fetch;
}

const readVersionTag = (body: unknown): string | null => {
  if (typeof body !== "object" || body === null || !("version" in body)) {
    return null;
  }
  const { version } = body;
  if (typeof version !== "object" || version === null || !("tag" in version)) {
    return null;
  }
  return typeof version.tag === "string" ? version.tag : null;
};

const describeFailure = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The URL without any `user:pass@`. The status is served over the diagnostics
 * feed and rendered in the toolbar, so credentials in `DATA_APP_MB_URL` must not
 * ride along — probes still use the original.
 */
const withoutCredentials = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) {
      return url;
    }
    parsed.username = "";
    parsed.password = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return url;
  }
};

export async function runDevConnectionCheck({
  metabaseUrl,
  apiKey,
  sdkVersion,
  fetchFn = fetch,
}: DevConnectionCheckOptions): Promise<void> {
  const base = (metabaseUrl ?? "").replace(/\/+$/, "");
  const status: DevConnectionStatus = {
    checkedAt: Date.now(),
    metabaseUrl: withoutCredentials(base),
    reachable: false,
    apiKeyValid: null,
    metabaseVersion: null,
    sdkVersion,
  };

  if (!base) {
    status.error =
      "DATA_APP_MB_URL is not set — fill it in the repo-root .env.local and restart the dev server.";
    setDevConnectionStatus(status);
    return;
  }

  try {
    const health = await fetchFn(`${base}/api/health`);
    status.reachable = health.ok;
    if (!health.ok) {
      // Stop here rather than fall through to the key check: an unreachable
      // instance rejects every request, so continuing would overwrite this with
      // "the API key was rejected" and send the author to fix a fine .env.local.
      status.error = `${status.metabaseUrl}/api/health responded with ${health.status}.`;
      setDevConnectionStatus(status);
      return;
    }
  } catch (error) {
    status.error = `Could not reach ${status.metabaseUrl}: ${describeFailure(error)}`;
    setDevConnectionStatus(status);
    return;
  }

  if (!apiKey) {
    status.apiKeyValid = false;
    status.error =
      "DATA_APP_MB_API_KEY is not set — fill it in the repo-root .env.local and restart the dev server.";
  } else {
    try {
      const user = await fetchFn(`${base}/api/user/current`, {
        headers: { "x-api-key": apiKey },
      });
      status.apiKeyValid = user.ok;
      if (!user.ok) {
        status.error = `The API key was rejected (${user.status}) — check DATA_APP_MB_API_KEY in the repo-root .env.local.`;
      }
    } catch (error) {
      status.error = `Could not validate the API key: ${describeFailure(error)}`;
    }
  }

  try {
    const properties = await fetchFn(`${base}/api/session/properties`, {
      headers: apiKey ? { "x-api-key": apiKey } : undefined,
    });
    if (properties.ok) {
      status.metabaseVersion = readVersionTag(await properties.json());
    }
  } catch {
    // Reachability/key results still stand; the version just stays unknown.
  }

  setDevConnectionStatus(status);
}
