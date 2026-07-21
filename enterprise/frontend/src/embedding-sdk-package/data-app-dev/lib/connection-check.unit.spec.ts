import {
  clearDevDiagnostics,
  getDevConnectionStatus,
} from "../components/DevToolbar/diagnostics";

import { runDevConnectionCheck } from "./connection-check";

const METABASE_URL = "http://localhost:3000";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => clearDevDiagnostics());

describe("runDevConnectionCheck", () => {
  it("reports a down instance without blaming the API key", async () => {
    const fetchFn = jest.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/api/health")
        ? new Response("bad gateway", { status: 502 })
        : json({}),
    );

    await runDevConnectionCheck({
      metabaseUrl: METABASE_URL,
      apiKey: "mb_key",
      sdkVersion: "0.64.0",
      fetchFn,
    });

    const status = getDevConnectionStatus();
    expect(status).toMatchObject({ reachable: false, apiKeyValid: null });
    expect(status?.error).toContain("/api/health responded with 502");
    expect(status?.error).not.toContain("API key");
  });

  it("reports a rejected key when the instance is up", async () => {
    const fetchFn = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/health")) {
        return new Response("ok", { status: 200 });
      }

      if (url.endsWith("/api/user/current")) {
        return new Response("nope", { status: 401 });
      }

      return json({ version: { tag: "v1.56.0" } });
    });

    await runDevConnectionCheck({
      metabaseUrl: METABASE_URL,
      apiKey: "bad",
      sdkVersion: "0.64.0",
      fetchFn,
    });

    const status = getDevConnectionStatus();
    expect(status).toMatchObject({ reachable: true, apiKeyValid: false });
    expect(status?.error).toContain("API key was rejected (401)");
  });

  it("reports the instance version and a missing key on a healthy instance", async () => {
    const fetchFn = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/api/health")) {
        return new Response("ok", { status: 200 });
      }

      return json({ version: { tag: "v1.56.0" } });
    });

    await runDevConnectionCheck({
      metabaseUrl: METABASE_URL,
      apiKey: undefined,
      sdkVersion: "0.64.0",
      fetchFn,
    });

    const status = getDevConnectionStatus();
    expect(status).toMatchObject({
      reachable: true,
      apiKeyValid: false,
      metabaseVersion: "v1.56.0",
    });
    expect(status?.error).toContain("DATA_APP_MB_API_KEY is not set");
  });

  it("reports an unset URL without probing anything", async () => {
    const fetchFn = jest.fn();

    await runDevConnectionCheck({
      metabaseUrl: undefined,
      apiKey: undefined,
      sdkVersion: null,
      fetchFn,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(getDevConnectionStatus()?.error).toContain(
      "DATA_APP_MB_URL is not set",
    );
  });

  it("keeps credentials out of the feed while still probing with them", async () => {
    const seen: string[] = [];
    const fetchFn = jest.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input));

      return new Response("nope", { status: 503 });
    });

    await runDevConnectionCheck({
      metabaseUrl: "https://user:secret@mb.example.com",
      apiKey: "mb_key",
      sdkVersion: null,
      fetchFn,
    });

    const status = getDevConnectionStatus();
    // The status is served over the diagnostics feed and rendered in the toolbar.
    expect(status?.metabaseUrl).toBe("https://mb.example.com");
    expect(JSON.stringify(status)).not.toContain("secret");
    // ...but the probe itself still carries them.
    expect(seen[0]).toContain("user:secret@");
  });
});
