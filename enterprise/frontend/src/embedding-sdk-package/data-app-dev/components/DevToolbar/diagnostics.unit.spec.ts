import { DATA_APP_DIAGNOSTIC_MAX_CHARS } from "../../diagnostics-channel";
// `formatDevDiagnostic` is a lens onto captured entries — the projection lives
// in the payload module now, this spec only uses it to read what was captured.
import { formatDevDiagnostic } from "../../lib/diagnostics-payload";

import {
  type DevDiagnosticEntry,
  clearDevDiagnostics,
  getDevConnectionStatus,
  getDevDiagnostics,
  installDevDiagnostics,
  recordDevDiagnostic,
  recordSandboxBlockedEvent,
  setDevConnectionStatus,
  subscribeDevDiagnostics,
} from "./diagnostics";

const last = (entries: readonly DevDiagnosticEntry[]) =>
  entries[entries.length - 1];

let forwarded: unknown[][] = [];
let originalConsoleError: typeof console.error;
/** The active capture's teardown, so a test can uninstall and reinstall. */
let uninstall: () => void;

beforeAll(() => {
  originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    forwarded.push(args);
  };
  uninstall = installDevDiagnostics();
});

afterAll(() => {
  console.error = originalConsoleError;
});

beforeEach(() => {
  clearDevDiagnostics();
  forwarded = [];
});

describe("dev diagnostics store", () => {
  it("starts empty", () => {
    expect(getDevDiagnostics()).toEqual([]);
  });

  it("records console.error calls as error entries with id/time/message", () => {
    console.error("boom", { code: 1 });

    const entries = getDevDiagnostics();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "error",
      message: 'boom {"code":1}',
    });
    expect(typeof entries[0].id).toBe("number");
    expect(typeof entries[0].time).toBe("number");
  });

  it("still forwards to the original console.error", () => {
    console.error("passed through");

    expect(forwarded).toContainEqual(["passed through"]);
  });

  it("formats Error arguments using their message", () => {
    console.error(new Error("kaboom"));

    expect(formatDevDiagnostic(last(getDevDiagnostics()))).toContain("kaboom");
  });

  it("captures uncaught window errors", () => {
    const event = Object.assign(new Event("error"), {
      message: "window blew up",
    });
    window.dispatchEvent(event);

    expect(formatDevDiagnostic(last(getDevDiagnostics()))).toContain(
      "window blew up",
    );
  });

  it("captures unhandled promise rejections", () => {
    const event = Object.assign(new Event("unhandledrejection"), {
      reason: "nope",
    });
    window.dispatchEvent(event);

    expect(formatDevDiagnostic(last(getDevDiagnostics()))).toBe(
      "Unhandled rejection: nope",
    );
  });

  it("captures CSP violations as typed entries", () => {
    const event = Object.assign(new Event("securitypolicyviolation"), {
      effectiveDirective: "form-action",
      violatedDirective: "form-action",
      blockedURI: "https://example.com/",
      originalPolicy: "connect-src 'self'; form-action 'none'",
    } satisfies Partial<SecurityPolicyViolationEvent>);
    window.dispatchEvent(event);

    const entry = last(getDevDiagnostics());
    expect(entry).toMatchObject({
      kind: "csp-violation",
      directive: "form-action",
      blockedUri: "https://example.com/",
    });
    expect(formatDevDiagnostic(entry)).toBe(
      "Content Security Policy (form-action) blocked https://example.com/",
    );
  });

  it("formats a CSP violation with an empty URI as inline content", () => {
    recordDevDiagnostic({
      kind: "csp-violation",
      directive: "script-src",
      blockedUri: "",
    });

    expect(formatDevDiagnostic(last(getDevDiagnostics()))).toBe(
      "Content Security Policy (script-src) blocked inline content",
    );
  });

  it("notifies subscribers on record and clear, and stops after unsubscribe", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeDevDiagnostics(listener);

    console.error("one");
    expect(listener).toHaveBeenCalledTimes(1);

    clearDevDiagnostics();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    console.error("two");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("returns a fresh array reference per record (so useSyncExternalStore re-renders)", () => {
    const before = getDevDiagnostics();
    console.error("change");

    expect(getDevDiagnostics()).not.toBe(before);
  });

  it("is idempotent — installing again does not double-record", () => {
    installDevDiagnostics();
    console.error("once");

    expect(getDevDiagnostics()).toHaveLength(1);
  });

  it("caps stored entries at 200, keeping the most recent", () => {
    for (let i = 0; i < 205; i++) {
      console.error(`error ${i}`);
    }

    const entries = getDevDiagnostics();
    expect(entries).toHaveLength(200);
    expect(formatDevDiagnostic(entries[0])).toBe("error 5");
    expect(formatDevDiagnostic(last(entries))).toBe("error 204");
  });
});

describe("recordSandboxBlockedEvent", () => {
  it("records a blocked API as a blocked-api entry and logs it uncaptured", () => {
    recordSandboxBlockedEvent({
      type: "api",
      message: "[data-app dev] blocked API call: document.write",
    });

    const entries = getDevDiagnostics();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "blocked-api",
      message: "[data-app dev] blocked API call: document.write",
    });
    // Forwarded to the real console, without being re-captured as an error.
    expect(forwarded).toContainEqual([
      "[data-app dev] blocked API call: document.write",
    ]);
  });

  it("records a blocked network call as a blocked-network entry and logs it uncaptured", () => {
    recordSandboxBlockedEvent({
      type: "network",
      api: "fetch",
      url: "https://evil.test/x",
      reason: "evil.test (not in allowed_hosts)",
    });

    const entries = getDevDiagnostics();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "blocked-network",
      api: "fetch",
      url: "https://evil.test/x",
      reason: "evil.test (not in allowed_hosts)",
    });
    expect(formatDevDiagnostic(entries[0])).toBe(
      "Blocked fetch to evil.test (not in allowed_hosts)",
    );
    expect(forwarded).toContainEqual([
      "[data-app dev] blocked fetch to evil.test (not in allowed_hosts)",
    ]);
  });
});

describe("sdk-call entries", () => {
  it("formats a completed call with status and duration", () => {
    recordDevDiagnostic({
      kind: "sdk-call",
      method: "POST",
      endpoint: "/api/card/1/query",
      status: 202,
      durationMs: 45,
      rowCount: 10,
    });

    expect(formatDevDiagnostic(last(getDevDiagnostics()))).toBe(
      "POST /api/card/1/query → 202 (45ms)",
    );
  });

  it("formats a failed call with its error", () => {
    recordDevDiagnostic({
      kind: "sdk-call",
      method: "GET",
      endpoint: "/api/user/current",
      status: null,
      durationMs: 5,
      error: "Failed to fetch",
    });

    expect(formatDevDiagnostic(last(getDevDiagnostics()))).toBe(
      "GET /api/user/current → Failed to fetch (5ms)",
    );
  });
});

describe("connection status", () => {
  it("stores the connection status and notifies subscribers", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeDevDiagnostics(listener);

    setDevConnectionStatus({
      checkedAt: 1,
      metabaseUrl: "http://localhost:3000",
      reachable: true,
      apiKeyValid: true,
      metabaseVersion: "v1.56.0",
      sdkVersion: "0.63.1",
    });

    expect(getDevConnectionStatus()).toMatchObject({ reachable: true });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe("bounded entry size", () => {
  it("truncates a huge logged object instead of retaining it whole", () => {
    installDevDiagnostics();
    clearDevDiagnostics();

    // The count cap alone bounds nothing: one entry can be arbitrarily large,
    // and it is retained twice and re-serialized on every poll.
    console.error("rows", {
      rows: Array.from({ length: 50_000 }, (_, i) => i),
    });

    const [entry] = getDevDiagnostics();
    expect(entry.kind).toBe("error");
    const message = entry.kind === "error" ? entry.message : "";
    expect(message.length).toBeLessThan(DATA_APP_DIAGNOSTIC_MAX_CHARS * 2);
    expect(message).toContain("truncated");
  });
});

describe("installDevDiagnostics teardown", () => {
  it("stops capturing, and a reinstall records once rather than twice", () => {
    uninstall();
    clearDevDiagnostics();

    console.error("after teardown");
    expect(getDevDiagnostics()).toHaveLength(0);

    // Reinstalling wraps the restored console.error, not the previous wrapper —
    // without the teardown resetting `installed`, an HMR reload of the dev entry
    // would double every capture.
    uninstall = installDevDiagnostics();
    clearDevDiagnostics();
    console.error("once");

    expect(getDevDiagnostics()).toHaveLength(1);
  });
});
