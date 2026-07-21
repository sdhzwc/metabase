import type { DataAppManifestStatus } from "./manifest-status";

export interface DevConnectionStatus {
  checkedAt: number;
  metabaseUrl: string;
  reachable: boolean;
  apiKeyValid: boolean | null;
  metabaseVersion: string | null;
  sdkVersion: string | null;
  error?: string;
}

export const DATA_APP_DIAGNOSTICS_EVENT = "data-app:diagnostics";

export const DATA_APP_DIAGNOSTICS_URL = "/__data-app/diagnostics";

export const DATA_APP_DIAGNOSTICS_LIMIT = 200;

// Requests outrun every other kind by orders of magnitude, so under one shared
// cap a polling app quietly evicts the very errors the requests are meant to
// explain. Capping them separately keeps the rest of the buffer out of reach.
export const DATA_APP_DIAGNOSTICS_CALL_LIMIT = 50;

/**
 * Trim to `DATA_APP_DIAGNOSTICS_LIMIT`, dropping requests first and never
 * letting them hold more than their own budget. Whatever they leave unused goes
 * to the other kinds, so a quiet app still keeps a full buffer of errors.
 * Insertion order is preserved.
 */
export const capDiagnosticEntries = <T extends { kind: string }>(
  entries: T[],
): T[] => {
  if (entries.length <= DATA_APP_DIAGNOSTICS_LIMIT) {
    return entries;
  }

  const calls = entries
    .filter((entry) => entry.kind === "sdk-call")
    .slice(-DATA_APP_DIAGNOSTICS_CALL_LIMIT);
  const rest = entries
    .filter((entry) => entry.kind !== "sdk-call")
    .slice(-(DATA_APP_DIAGNOSTICS_LIMIT - calls.length));
  const kept = new Set<T>([...calls, ...rest]);

  return entries.filter((entry) => kept.has(entry));
};

// Per-field cap. Bounding the entry count alone bounds nothing: one
// `console.error("failed", rows)` can be an arbitrarily large string.
export const DATA_APP_DIAGNOSTIC_MAX_CHARS = 4000;

export const truncateDiagnosticText = (
  value: string,
  max: number = DATA_APP_DIAGNOSTIC_MAX_CHARS,
): string =>
  value.length <= max
    ? value
    : `${value.slice(0, max)}… (truncated, ${value.length} chars)`;

export interface DataAppDiagnosticEntry {
  time: number;
  kind: string;
  summary: string;
  detail: string | null;
  hint: string | null;
  alert: boolean;
}

export interface DataAppDiagnosticPayload extends DataAppDiagnosticEntry {
  eventId: number;
}

export interface DataAppDiagnosticsMessage {
  session: string;
  entries: DataAppDiagnosticEntry[];
  connection: DevConnectionStatus | null;
}

export interface DataAppDiagnosticsReport {
  entries: DataAppDiagnosticPayload[];
  connection: DevConnectionStatus | null;
  manifest: DataAppManifestStatus | null;
  clients: number;
  lastReportAt: number | null;
  lastRebuildAt: number | null;
  /** Cursor for the next poll (`?startEventId=`): the last event's id + 1. */
  nextEventId: number;
  session: string | null;
}
