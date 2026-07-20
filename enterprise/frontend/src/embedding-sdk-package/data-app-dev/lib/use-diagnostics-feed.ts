// The toolbar's data source. Collection happens elsewhere (the capture points
// feed the in-page store, and `installDiagnosticsReporter` mirrors it to the dev
// server); this only reads the server's feed back, so the panel and any external
// reader — an agent polling the same URL — always show the same thing.

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DATA_APP_DIAGNOSTICS_URL,
  type DataAppDiagnosticPayload,
  type DataAppDiagnosticsReport,
} from "../diagnostics-channel";

/** How often the toolbar re-reads the feed. */
const POLL_MS = 1000;

export interface DiagnosticsFeed {
  entries: DataAppDiagnosticPayload[];
  connection: unknown | null;
  manifest: unknown | null;
  /** Connected preview tabs, per the dev server. */
  clients: number;
  lastReportAt: number | null;
  lastRebuildAt: number | null;
  /** Set when the dev server can't be reached — the panel says so rather than looking empty. */
  unreachable: boolean;
  clear: () => void;
}

const EMPTY: DataAppDiagnosticPayload[] = [];

export const useDiagnosticsFeed = (
  url: string = DATA_APP_DIAGNOSTICS_URL,
  pollMs: number = POLL_MS,
): DiagnosticsFeed => {
  const [entries, setEntries] = useState<DataAppDiagnosticPayload[]>(EMPTY);
  const [report, setReport] = useState<DataAppDiagnosticsReport | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  // The cursor lives in a ref, not state: advancing it must not itself trigger a
  // re-render or the poll would loop.
  const startEventId = useRef(0);

  const poll = useCallback(async () => {
    try {
      const response = await fetch(
        `${url}?startEventId=${startEventId.current}`,
      );
      if (!response.ok) {
        setUnreachable(true);
        return;
      }

      // Authored by our own dev plugin, which serves exactly this shape; JSON
      // parsing is what erases the type.
      const next = (await response.json()) as DataAppDiagnosticsReport;
      setUnreachable(false);
      setReport(next);

      if (next.entries.length > 0) {
        startEventId.current = next.nextEventId;
        setEntries((current) => [...current, ...next.entries]);
      }
    } catch {
      // The dev server is down or restarting; keep what we have and say so.
      setUnreachable(true);
    }
  }, [url]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), pollMs);

    return () => clearInterval(timer);
  }, [poll, pollMs]);

  const clear = useCallback(() => {
    setEntries(EMPTY);
    void fetch(url, { method: "DELETE" })
      .then(() => {
        // The server's buffer is empty now, so start reading from the beginning
        // again; ids keep climbing, so nothing already shown can come back.
        startEventId.current = 0;
      })
      .catch(() => setUnreachable(true));
  }, [url]);

  return {
    entries,
    connection: report?.connection ?? null,
    manifest: report?.manifest ?? null,
    clients: report?.clients ?? 0,
    lastReportAt: report?.lastReportAt ?? null,
    lastRebuildAt: report?.lastRebuildAt ?? null,
    unreachable,
    clear,
  };
};
