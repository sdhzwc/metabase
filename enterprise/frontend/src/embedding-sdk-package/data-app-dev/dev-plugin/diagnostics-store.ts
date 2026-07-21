import {
  type DataAppDiagnosticEntry,
  type DataAppDiagnosticPayload,
  type DataAppDiagnosticsMessage,
  type DevConnectionStatus,
  capDiagnosticEntries,
  truncateDiagnosticText,
} from "../diagnostics-channel";

export interface DiagnosticsStore {
  ingest: (message: DataAppDiagnosticsMessage) => void;
  clear: () => void;
  /** Entries from `startEventId` onward; all of them if the cursor is absent. */
  read: (startEventId: number) => DataAppDiagnosticPayload[];
  readonly connection: DevConnectionStatus | null;
  readonly lastReportAt: number | null;
  readonly sessionId: string | null;
  readonly nextEventId: number;
}

export function createDiagnosticsStore(): DiagnosticsStore {
  let entries: DataAppDiagnosticPayload[] = [];
  let connection: DevConnectionStatus | null = null;
  let lastReportAt: number | null = null;
  let sessionId: string | null = null;
  // Re-stamped server-side: the page's counter restarts at 1 on every reload, so
  // trusting it would make fresh events sort before a poller's cursor.
  let nextEventId = 1;

  const toStoredEntry = (
    entry: DataAppDiagnosticEntry,
  ): DataAppDiagnosticPayload => ({
    ...entry,
    summary: truncateDiagnosticText(entry.summary ?? ""),
    detail: entry.detail == null ? null : truncateDiagnosticText(entry.detail),
    eventId: nextEventId++,
  });

  return {
    ingest(message) {
      lastReportAt = Date.now();
      connection = message?.connection ?? connection;

      // A new page: drop the previous one's events, but keep `nextEventId`
      // climbing so an existing poller's cursor stays valid.
      if (message?.sessionId && message.sessionId !== sessionId) {
        if (sessionId !== null) {
          entries = [];
        }

        sessionId = message.sessionId;
      }

      if (Array.isArray(message?.entries) && message.entries.length > 0) {
        entries = capDiagnosticEntries([
          ...entries,
          ...message.entries.map(toStoredEntry),
        ]);
      }
    },

    clear() {
      entries = [];
    },

    read(startEventId) {
      return Number.isFinite(startEventId)
        ? entries.filter((entry) => entry.eventId >= startEventId)
        : entries;
    },

    get connection() {
      return connection;
    },

    get lastReportAt() {
      return lastReportAt;
    },

    get sessionId() {
      return sessionId;
    },

    get nextEventId() {
      return (entries.at(-1)?.eventId ?? 0) + 1;
    },
  };
}
