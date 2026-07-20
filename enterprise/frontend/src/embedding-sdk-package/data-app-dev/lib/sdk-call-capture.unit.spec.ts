import {
  clearDevDiagnostics,
  getDevDiagnostics,
} from "../components/DevToolbar/diagnostics";

import { installSdkCallCapture } from "./sdk-call-capture";

const METABASE_URL = "http://localhost:3000";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

let realFetch: jest.Mock;
let teardown: () => void;

const install = (metabaseUrl: string = METABASE_URL) => {
  realFetch = jest.fn().mockResolvedValue(jsonResponse({}));
  // A jest.fn() can't satisfy fetch's full overloaded signature; the code under
  // test only ever calls it as (input, init).
  window.fetch = realFetch as unknown as typeof fetch;
  teardown = installSdkCallCapture(metabaseUrl);
};

beforeEach(() => clearDevDiagnostics());
afterEach(() => teardown?.());

const calls = () =>
  getDevDiagnostics().filter((entry) => entry.kind === "sdk-call");

describe("installSdkCallCapture", () => {
  it("records a Metabase call and ignores everything else", async () => {
    install();

    await window.fetch(`${METABASE_URL}/api/card/1`);
    await window.fetch("https://example.com/thing");

    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatchObject({ endpoint: "/api/card/1", status: 200 });
  });

  it("does not buffer an export body to count rows", async () => {
    install();
    const csv = new Response("a,b\n1,2", {
      status: 200,
      headers: { "Content-Type": "text/csv" },
    });
    const clone = jest.spyOn(csv, "clone");
    realFetch.mockResolvedValue(csv);

    // `/api/dataset/csv` used to match the query-endpoint pattern, so the whole
    // export was cloned, downloaded and JSON-parsed before the caller saw it.
    await window.fetch(`${METABASE_URL}/api/dataset/csv`);

    expect(clone).not.toHaveBeenCalled();
    expect(calls()[0].endpoint).toBe("/api/dataset/csv");
  });

  it("does not buffer a JSON export, which content-type alone can't rule out", async () => {
    install();
    // `/api/dataset/json` is an export that really does return application/json,
    // so only the exact-path match keeps a large one from being downloaded twice.
    const exported = jsonResponse([{ a: 1 }]);
    const clone = jest.spyOn(exported, "clone");
    realFetch.mockResolvedValue(exported);

    await window.fetch(`${METABASE_URL}/api/dataset/json`);

    expect(clone).not.toHaveBeenCalled();
  });

  it("counts rows for a real query result", async () => {
    install();
    realFetch.mockResolvedValue(jsonResponse({ data: { rows: [1, 2, 3] } }));

    await window.fetch(`${METABASE_URL}/api/dataset`);

    expect(calls()[0]).toMatchObject({ rowCount: 3 });
  });

  it("ignores an aborted request rather than reporting a failure", async () => {
    install();
    realFetch.mockRejectedValue(
      new DOMException("The user aborted a request.", "AbortError"),
    );

    await expect(window.fetch(`${METABASE_URL}/api/dataset`)).rejects.toThrow();

    // StrictMode remounts and superseded queries abort routinely; badging those
    // as errors trains the author to ignore the badge.
    expect(calls()).toHaveLength(0);
  });

  it("still reports a genuine transport failure", async () => {
    install();
    realFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(window.fetch(`${METABASE_URL}/api/dataset`)).rejects.toThrow();

    expect(calls()[0]).toMatchObject({
      status: null,
      error: "Failed to fetch",
    });
  });

  it("strips the base path of a sub-path deployment", async () => {
    install("https://acme.com/metabase");
    realFetch.mockResolvedValue(jsonResponse({ data: { rows: [1] } }));

    await window.fetch("https://acme.com/metabase/api/dataset");

    // Without stripping, the endpoint reads `/metabase/api/dataset` and never
    // matches the query pattern, so row counts silently vanish.
    expect(calls()[0]).toMatchObject({
      endpoint: "/api/dataset",
      rowCount: 1,
    });
  });

  it("stops recording once torn down, and can be reinstalled without double-counting", async () => {
    install();
    teardown();

    await window.fetch(`${METABASE_URL}/api/card/1`);
    expect(calls()).toHaveLength(0);

    // Reinstalling wraps the restored fetch, not the previous wrapper — without
    // the teardown resetting `installed`, a remount would record every call twice.
    teardown = installSdkCallCapture(METABASE_URL);
    await window.fetch(`${METABASE_URL}/api/card/1`);

    expect(calls()).toHaveLength(1);
  });
});
