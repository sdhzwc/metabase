// The capture side of dev diagnostics: records typed events — errors, blocked
// sandbox calls, CSP violations, SDK calls — and holds the latest connection
// status (the sandbox otherwise reports blocked APIs only as an opaque
// `#<Object>`).
//
// This is a buffer, not a source anyone renders from. `installDiagnosticsReporter`
// mirrors it to the dev server (projecting each entry to the wire shape via
// `lib/diagnostics-payload`), the server serves it at `/__data-app/diagnostics`,
// and the toolbar reads that feed like any other client — so the panel and an
// agent polling the same URL can't disagree.
//
// Capture is opt-in: it only patches `console.error` / listens for uncaught
// errors once `installDevDiagnostics()` is called. Nothing here runs on import,
// so a host that imports `createDataAppSandbox` from the same entry doesn't pull
// any of this in unless it's actually used.

import type { SandboxBlockedEvent } from "metabase-enterprise/data_apps/sandbox/distortions";

import {
  type DevConnectionStatus,
  truncateDiagnosticText,
} from "../../diagnostics-channel";

export type DevDiagnosticEvent =
  | { kind: "error"; message: string }
  // A sandbox-blocked API (dangerous tag, inline handler, `javascript:` URL,
  // DOM mutation, …), reported structurally at the block site.
  | { kind: "blocked-api"; message: string }
  | {
      kind: "blocked-network";
      api: "fetch" | "xhr";
      url: string;
      reason: string;
    }
  | { kind: "csp-violation"; directive: string; blockedUri: string }
  // A request the harness page made to the connected Metabase (the SDK's
  // sanctioned channel), captured by `installSdkCallCapture`.
  | {
      kind: "sdk-call";
      method: string;
      endpoint: string;
      status: number | null;
      durationMs: number;
      rowCount?: number;
      error?: string;
    };

export type DevDiagnosticEntry = {
  id: number;
  time: number;
} & DevDiagnosticEvent;

const MAX_ENTRIES = 200;

let entries: DevDiagnosticEntry[] = [];
let connectionStatus: DevConnectionStatus | null = null;
let nextId = 1;
let installed = false;
let uncapturedConsoleError: typeof console.error | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) {
    listener();
  }
};

const formatArg = (arg: unknown): string => {
  // Capped here, at the one place arbitrary app data becomes a string: a logged
  // query result would otherwise be retained in full and re-serialized per poll.
  if (typeof arg === "string") {
    return truncateDiagnosticText(arg);
  }
  if (arg instanceof Error) {
    return truncateDiagnosticText(arg.stack ?? `${arg.name}: ${arg.message}`);
  }
  try {
    return truncateDiagnosticText(JSON.stringify(arg));
  } catch {
    return truncateDiagnosticText(String(arg));
  }
};

/**
 * Cap every string an event carries. `formatArg` bounds one console argument, but
 * a call with many args, or a structured event whose `url`/`reason` came from the
 * guest realm, still lands here unbounded — so the cap belongs at the one point
 * every capture path goes through.
 */
const cappedEvent = (event: DevDiagnosticEvent): DevDiagnosticEvent =>
  // Rebuilding a discriminated union through entries() loses the tie between
  // `kind` and its fields; values are only ever mapped string→string.
  Object.fromEntries(
    Object.entries(event).map(([key, value]) => [
      key,
      typeof value === "string" ? truncateDiagnosticText(value) : value,
    ]),
  ) as DevDiagnosticEvent;

/**
 * Record a diagnostic event into the store. This is how the structured
 * capture points (sandbox block hooks, SDK call capture, connection check)
 * feed the toolbar.
 */
export const recordDevDiagnostic = (event: DevDiagnosticEvent): void => {
  // New array reference each time so `useSyncExternalStore` re-renders.
  entries = [
    ...entries,
    { id: nextId++, time: Date.now(), ...cappedEvent(event) },
  ];
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(-MAX_ENTRIES);
  }
  emit();
};

/**
 * Log to the real `console.error` without the diagnostics capture recording it
 * again — for capture points that already recorded a structured event but still
 * want the message in the browser console. Falls back to `console.error` when
 * capture isn't installed.
 */
const logDevDiagnosticToConsole = (message: string): void => {
  (uncapturedConsoleError ?? console.error)(message);
};

/**
 * The sandbox `onBlocked` listener for dev: records the block as a structured
 * entry (the toolbar's Blocked tab) and still logs it to the real console —
 * at the block point, where the console stack points at the data-app code
 * that made the blocked call.
 */
export const recordSandboxBlockedEvent = (event: SandboxBlockedEvent): void => {
  if (event.type === "api") {
    recordDevDiagnostic({ kind: "blocked-api", message: event.message });
    logDevDiagnosticToConsole(event.message);
    return;
  }
  recordDevDiagnostic({
    kind: "blocked-network",
    api: event.api,
    url: event.url,
    reason: event.reason,
  });
  logDevDiagnosticToConsole(
    `[data-app dev] blocked ${event.api === "xhr" ? "XMLHttpRequest" : "fetch"} to ${event.reason}`,
  );
};

export const getDevDiagnostics = (): readonly DevDiagnosticEntry[] => entries;

export const getDevConnectionStatus = (): DevConnectionStatus | null =>
  connectionStatus;

export const setDevConnectionStatus = (status: DevConnectionStatus): void => {
  connectionStatus = status;
  emit();
};

export const subscribeDevDiagnostics = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Exported for tests; production clears through the dev server's DELETE. */
export const clearDevDiagnostics = (): void => {
  entries = [];
  emit();
};

/**
 * Start capturing errors into the diagnostics store: wraps `console.error` and
 * listens for uncaught errors / unhandled rejections. Idempotent. Call it before
 * the sandbox runs so nothing is missed.
 *
 * Returns a teardown, like its siblings. Without one, re-evaluating this module
 * (an HMR reload of the dev entry) resets `installed` and re-wraps the already
 * wrapped `console.error`, doubling every capture for each cycle.
 */
export const installDevDiagnostics = (): (() => void) => {
  if (installed || typeof window === "undefined") {
    return () => undefined;
  }
  installed = true;

  const originalError = console.error.bind(console);
  uncapturedConsoleError = originalError;
  console.error = (...args: unknown[]) => {
    recordDevDiagnostic({
      kind: "error",
      message: args.map(formatArg).join(" "),
    });
    originalError(...args);
  };

  const onError = (event: ErrorEvent) => {
    if (event.error != null || event.message) {
      recordDevDiagnostic({
        kind: "error",
        message: formatArg(event.error ?? event.message),
      });
    }
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    recordDevDiagnostic({
      kind: "error",
      message: `Unhandled rejection: ${formatArg(event.reason)}`,
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  // The dev server mirrors Metabase's production CSP, so a violation here means
  // the app would be blocked once sandboxed in Metabase too — e.g. a native
  // `<form action="…">` hitting `form-action 'none'`. These never reach
  // `console.error`, so the toolbar wouldn't see them otherwise.
  const onCspViolation = (event: SecurityPolicyViolationEvent) => {
    recordDevDiagnostic({
      kind: "csp-violation",
      directive: event.effectiveDirective || event.violatedDirective,
      blockedUri: event.blockedURI,
    });
  };

  window.addEventListener("securitypolicyviolation", onCspViolation);

  return () => {
    console.error = originalError;
    uncapturedConsoleError = null;
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("securitypolicyviolation", onCspViolation);
    installed = false;
  };
};
