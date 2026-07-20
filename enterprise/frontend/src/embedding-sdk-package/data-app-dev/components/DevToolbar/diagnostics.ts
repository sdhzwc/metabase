/* eslint-disable metabase/no-literal-metabase-strings -- dev-only guidance for data-app authors, not whitelabel-able product UI */
// Dev diagnostics store for the data-app dev toolbar. Captures typed events —
// errors, structurally-reported blocked sandbox calls, CSP violations, SDK
// calls — plus the latest connection and manifest status, so the toolbar can
// show what went wrong (the sandbox otherwise reports blocked APIs only as an
// opaque `#<Object>`).
//
// Capture is opt-in: it only patches `console.error` / listens for uncaught
// errors once `installDevDiagnostics()` is called. Nothing here runs on import,
// so a host that imports `createDataAppSandbox` from the same entry doesn't pull
// any of this in unless it's actually used.

import type { SandboxBlockedEvent } from "metabase-enterprise/data_apps/sandbox/distortions";

import { truncateDiagnosticText } from "../../diagnostics-channel";

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

export interface DevConnectionStatus {
  checkedAt: number;
  metabaseUrl: string;
  reachable: boolean;
  /** `null` while unknown — e.g. the instance wasn't reachable to check. */
  apiKeyValid: boolean | null;
  metabaseVersion: string | null;
  sdkVersion: string | null;
  error?: string;
}

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
export const logDevDiagnosticToConsole = (message: string): void => {
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

export const clearDevDiagnostics = (): void => {
  entries = [];
  emit();
};

/**
 * Whether an SDK call failed — a transport error, or a non-2xx response. Failed
 * calls are surfaced like errors (badge, collapsed popover) rather than sitting
 * unseen in the Queries tab: a bad `POST /api/dataset` is exactly what an author
 * needs told about, and it never reaches `console.error`.
 */
export const isFailedSdkCall = (entry: DevDiagnosticEntry): boolean =>
  entry.kind === "sdk-call" &&
  (entry.error != null || (entry.status != null && entry.status >= 400));

/**
 * Format an entry as a single human-readable line (the Errors/Blocked lists).
 */
export const formatDevDiagnostic = (entry: DevDiagnosticEntry): string => {
  switch (entry.kind) {
    case "error":
    case "blocked-api":
      return entry.message;
    case "blocked-network":
      return `Blocked ${entry.api === "xhr" ? "XMLHttpRequest" : "fetch"} to ${entry.reason}`;
    case "csp-violation":
      return `Content Security Policy (${entry.directive}) blocked ${
        entry.blockedUri || "inline content"
      }`;
    case "sdk-call": {
      const status = entry.error ?? entry.status ?? "pending";
      return `${entry.method} ${entry.endpoint} → ${status} (${entry.durationMs}ms)`;
    }
    default: {
      const exhaustive: never = entry;
      return String(exhaustive);
    }
  }
};

// Written for someone who has never heard of a Content Security Policy: say what
// the app tried to do and which file to edit, not which directive was violated.
// Also read by the dev-server diagnostics feed, so an agent gets the same advice.
const CSP_DIRECTIVE_HINTS: Record<string, string> = {
  "connect-src":
    "Your app tried to call a URL it isn't allowed to reach. Add that URL's origin to allowed_hosts in data_app.yaml, then restart the dev server.",
  "form-action":
    "A form tried to submit to a URL the app isn't allowed to reach. Add that origin to allowed_hosts in data_app.yaml, or submit with fetch instead.",
  "frame-src":
    "Your app tried to embed another site in an iframe. Add that site's origin to allowed_hosts in data_app.yaml.",
  "script-src":
    "Your app tried to load a script from another site. Install the dependency and import it so it's bundled, instead of loading it from a CDN.",
  "style-src":
    "Your app tried to load a stylesheet from another site. Import the CSS so it's bundled instead.",
  "img-src":
    "Your app tried to load an image from a site it isn't allowed to reach. Add that origin to allowed_hosts in data_app.yaml, or bundle the image.",
  "font-src":
    "Your app tried to load a font from another site. Add that origin to allowed_hosts in data_app.yaml, or bundle the font.",
};

const CSP_FALLBACK_HINT =
  "Metabase restricts what a data app may load or contact, and the dev server applies the same rules. Anything the app needs to reach must be listed under allowed_hosts in data_app.yaml.";

/** An actionable one-liner for an entry, when we can compute one. */
export const devDiagnosticHint = (entry: DevDiagnosticEntry): string | null => {
  if (
    entry.kind === "blocked-network" &&
    entry.reason.includes("not in allowed_hosts")
  ) {
    try {
      return `Add ${new URL(entry.url).origin} to allowed_hosts in data_app.yaml (dev server restart required).`;
    } catch {
      return null;
    }
  }
  if (entry.kind === "csp-violation") {
    return CSP_DIRECTIVE_HINTS[entry.directive] ?? CSP_FALLBACK_HINT;
  }
  return null;
};

/**
 * Split a formatted entry into its headline and the rest — stack frames for an
 * `Error`, or the trailing lines of a multi-line driver message. The toolbar
 * shows the headline and hides the detail behind a disclosure, the way DevTools
 * does, so one long stack doesn't bury every entry under it.
 */
export const splitDevDiagnostic = (
  entry: DevDiagnosticEntry,
): { summary: string; detail: string | null } => {
  const text = formatDevDiagnostic(entry);
  const firstBreak = text.indexOf("\n");
  return firstBreak === -1
    ? { summary: text, detail: null }
    : {
        summary: text.slice(0, firstBreak),
        detail: text.slice(firstBreak + 1).replace(/\n+$/, ""),
      };
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
