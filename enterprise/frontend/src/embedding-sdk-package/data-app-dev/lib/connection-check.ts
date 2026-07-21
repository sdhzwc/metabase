import { setDevConnectionStatus } from "../components/DevToolbar/diagnostics";
import type { DevConnectionStatus } from "../diagnostics-channel";

export interface DevConnectionCheckOptions {
  metabaseUrl: string | undefined;
  apiKey: string | undefined;
  sdkVersion: string | null;
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

const MB_URL_ENV = "DATA_APP_MB_URL";
const MB_API_KEY_ENV = "DATA_APP_MB_API_KEY";

const notSetMessage = (envVar: string): string =>
  `${envVar} is not set — fill it in the repo-root .env.local and restart the dev server.`;

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
    status.error = notSetMessage(MB_URL_ENV);
    setDevConnectionStatus(status);

    return;
  }

  try {
    const health = await fetchFn(`${base}/api/health`);
    status.reachable = health.ok;

    if (!health.ok) {
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
    status.error = notSetMessage(MB_API_KEY_ENV);
  } else {
    try {
      const user = await fetchFn(`${base}/api/user/current`, {
        headers: { "x-api-key": apiKey },
      });

      status.apiKeyValid = user.ok;

      if (!user.ok) {
        status.error = `The API key was rejected (${user.status}) — check ${MB_API_KEY_ENV} in the repo-root .env.local.`;
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
  } catch {}

  setDevConnectionStatus(status);
}
