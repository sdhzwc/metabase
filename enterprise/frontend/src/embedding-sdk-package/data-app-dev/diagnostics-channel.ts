/**
 * The dev-server side of the diagnostics store: the page pushes what the toolbar
 * shows up the HMR socket, and the dev server re-serves it as JSON at
 * {@link DATA_APP_DIAGNOSTICS_URL}.
 *
 * This exists so a coding agent — which has a shell, not a browser — can read the
 * same errors, blocked calls and failed queries a human reads in the toolbar,
 * without driving a browser. Entries carry the toolbar's own `summary`/`hint`
 * strings rather than raw event fields, so both readers get identical guidance.
 */

/** Client → server HMR event carrying newly captured diagnostics. */
export const DATA_APP_DIAGNOSTICS_EVENT = "data-app:diagnostics";

/** Dev-server endpoint serving the latest diagnostics as JSON. */
export const DATA_APP_DIAGNOSTICS_URL = "/__data-app/diagnostics";

/** How many entries the dev server retains, matching the in-page ring buffer. */
export const DATA_APP_DIAGNOSTICS_LIMIT = 200;

/**
 * Per-field character cap. The entry *count* is bounded, but a single
 * `console.error("failed", rows)` serializes an arbitrarily large object into one
 * string, which is then retained twice (page + server) and re-serialized on every
 * poll. Bounding the count without bounding size bounds nothing.
 */
export const DATA_APP_DIAGNOSTIC_MAX_CHARS = 4000;

/** Cap `value`, marking it so a reader knows the tail is missing. */
export const truncateDiagnosticText = (
  value: string,
  max: number = DATA_APP_DIAGNOSTIC_MAX_CHARS,
): string =>
  value.length <= max
    ? value
    : `${value.slice(0, max)}… (truncated, ${value.length} chars)`;

export interface DataAppDiagnosticPayload {
  /** Server-assigned, monotonic for the life of the dev server. */
  eventId: number;
  time: number;
  kind: string;
  /** The single-line headline, as rendered in the toolbar. */
  summary: string;
  /** Stack frames or trailing lines, when the entry has any. */
  detail: string | null;
  /** Actionable remediation, when one can be computed. */
  hint: string | null;
  /** True for entries the toolbar badges: errors, blocked calls, failed queries. */
  alert: boolean;
}

/**
 * What the page sends up the socket on each batch of new events. Note there is
 * no manifest: the dev server validates `data_app.yaml` itself, so the client
 * never reports one back.
 */
export interface DataAppDiagnosticsMessage {
  entries: DataAppDiagnosticPayload[];
  connection: unknown | null;
}

export interface DataAppDiagnosticsReport extends DataAppDiagnosticsMessage {
  /** Validated by the dev server, available before any client connects. */
  manifest: unknown | null;
  /**
   * Connected dev-preview tabs. Zero means nothing has run, so an empty
   * `entries` says nothing about the app's health — the distinction between
   * "no errors" and "never loaded".
   */
  clients: number;
  /** When the page last reported, or null if it never has. */
  lastReportAt: number | null;
  /** When the dev server last rebuilt the app bundle. */
  lastRebuildAt: number | null;
  /**
   * The id to start from next time: pass as `?startEventId=` to fetch only what
   * arrived after this batch. Inclusive, so it is one past the last event here.
   */
  nextEventId: number;
}
