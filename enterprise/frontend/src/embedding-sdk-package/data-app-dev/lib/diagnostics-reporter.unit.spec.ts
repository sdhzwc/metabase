import {
  clearDevDiagnostics,
  recordDevDiagnostic,
} from "../components/DevToolbar/diagnostics";
import {
  DATA_APP_DIAGNOSTICS_EVENT,
  type DataAppDiagnosticsMessage,
} from "../diagnostics-channel";

import { installDiagnosticsReporter } from "./diagnostics-reporter";

const setup = () => {
  const sent: DataAppDiagnosticsMessage[] = [];
  const teardown = installDiagnosticsReporter({
    send: (_event, data) => {
      sent.push(data);
    },
  });
  return { sent, teardown };
};

beforeEach(() => {
  jest.useFakeTimers();
  clearDevDiagnostics();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("installDiagnosticsReporter", () => {
  it("reports immediately on install, so the server knows a client is alive", () => {
    const { sent, teardown } = setup();

    expect(sent).toHaveLength(1);
    expect(sent[0].entries).toEqual([]);

    teardown();
  });

  it("sends the toolbar's summary, detail and hint rather than raw fields", () => {
    const { sent, teardown } = setup();

    recordDevDiagnostic({
      kind: "csp-violation",
      directive: "connect-src",
      blockedUri: "https://api.example.com/v1",
    });
    jest.runOnlyPendingTimers();

    const [entry] = sent[sent.length - 1].entries;
    expect(entry.kind).toBe("csp-violation");
    expect(entry.alert).toBe(true);
    expect(entry.hint).toMatch(/allowed_hosts in data_app.yaml/);

    teardown();
  });

  it("splits a stack into summary and detail", () => {
    const { sent, teardown } = setup();

    recordDevDiagnostic({
      kind: "error",
      message: "TypeError: nope\n    at App (src/App.tsx:1:1)",
    });
    jest.runOnlyPendingTimers();

    const [entry] = sent[sent.length - 1].entries;
    expect(entry.summary).toBe("TypeError: nope");
    expect(entry.detail).toBe("    at App (src/App.tsx:1:1)");

    teardown();
  });

  it("marks a failed SDK call as an alert but not a successful one", () => {
    const { sent, teardown } = setup();

    recordDevDiagnostic({
      kind: "sdk-call",
      method: "POST",
      endpoint: "/api/dataset",
      status: 500,
      durationMs: 3,
    });
    recordDevDiagnostic({
      kind: "sdk-call",
      method: "GET",
      endpoint: "/api/card/1",
      status: 200,
      durationMs: 3,
    });
    jest.runOnlyPendingTimers();

    const { entries } = sent[sent.length - 1];
    expect(entries.map((entry) => entry.alert)).toEqual([true, false]);

    teardown();
  });

  it("batches a burst into one message and never re-sends an entry", () => {
    const { sent, teardown } = setup();

    recordDevDiagnostic({ kind: "error", message: "one" });
    recordDevDiagnostic({ kind: "error", message: "two" });
    jest.runOnlyPendingTimers();

    expect(sent).toHaveLength(2);
    expect(sent[1].entries.map((entry) => entry.summary)).toEqual([
      "one",
      "two",
    ]);

    recordDevDiagnostic({ kind: "error", message: "three" });
    jest.runOnlyPendingTimers();

    expect(sent[2].entries.map((entry) => entry.summary)).toEqual(["three"]);

    teardown();
  });

  it("does not resend earlier entries after the toolbar's Clear", () => {
    const { sent, teardown } = setup();

    recordDevDiagnostic({ kind: "error", message: "before clear" });
    jest.runOnlyPendingTimers();

    clearDevDiagnostics();
    recordDevDiagnostic({ kind: "error", message: "after clear" });
    jest.runOnlyPendingTimers();

    const summaries = sent.at(-1)?.entries.map((entry) => entry.summary);
    expect(summaries).toEqual(["after clear"]);

    teardown();
  });

  it("stops sending once torn down", () => {
    const { sent, teardown } = setup();
    teardown();

    recordDevDiagnostic({ kind: "error", message: "ignored" });
    jest.runOnlyPendingTimers();

    expect(sent).toHaveLength(1);
  });

  it("uses the agreed channel event name", () => {
    const events: string[] = [];
    const teardown = installDiagnosticsReporter({
      send: (event) => {
        events.push(event);
      },
    });

    expect(events).toEqual([DATA_APP_DIAGNOSTICS_EVENT]);

    teardown();
  });
});
