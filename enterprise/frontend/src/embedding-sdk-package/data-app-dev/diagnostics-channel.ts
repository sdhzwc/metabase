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
