// The toolbar's data source. Collection happens elsewhere (the capture points
// feed the in-page store, and `installDiagnosticsReporter` mirrors it to the dev
// server); this only reads the server's feed back, so the panel and any external
// reader — an agent polling the same URL — always show the same thing.

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DATA_APP_DIAGNOSTICS_LIMIT,
  DATA_APP_DIAGNOSTICS_URL,
  type DataAppDiagnosticPayload,
  type DataAppDiagnosticsReport,
} from "../diagnostics-channel";

/** How often the toolbar re-reads the feed. */
const POLL_MS = 1000;

/**
 * Why the feed has no fresh data. `unreachable` is a dead or restarting dev
 * server; `http` is one that answered but refused — worth distinguishing, since
 * only the first is fixed by restarting `npm run dev`.
 */
export type DiagnosticsFeedProblem =
  | { kind: "unreachable" }
  | { kind: "http"; status: number };

export interface DiagnosticsFeed {
  entries: DataAppDiagnosticPayload[];
  connection: unknown | null;
  manifest: unknown | null;
  /** Connected preview tabs, per the dev server. */
  clients: number;
  lastReportAt: number | null;
  lastRebuildAt: number | null;
  problem: DiagnosticsFeedProblem | null;
  /** False until the first response lands, so callers don't read zeroes as facts. */
  loaded: boolean;
  clear: () => void;
}

const EMPTY: DataAppDiagnosticPayload[] = [];

export const useDiagnosticsFeed = (
  url: string = DATA_APP_DIAGNOSTICS_URL,
  pollMs: number = POLL_MS,
): DiagnosticsFeed => {
  const [entries, setEntries] = useState<DataAppDiagnosticPayload[]>(EMPTY);
  const [report, setReport] = useState<DataAppDiagnosticsReport | null>(null);
  const [problem, setProblem] = useState<DiagnosticsFeedProblem | null>(null);
  const [loaded, setLoaded] = useState(false);

  // The cursor lives in a ref, not state: advancing it must not itself trigger a
  // re-render or the poll would loop.
  const startEventId = useRef(0);
  // A poll can outlive its interval tick — a rebuild blocks the dev server for
  // seconds. Without this, overlapping reads share a cursor and append the same
  // batch twice: duplicate rows, and duplicate React keys.
  const inFlight = useRef(false);
  // Bumped by `clear()`, so a response fetched before the clear is discarded
  // rather than resurrecting the entries it carries.
  const generation = useRef(0);

  const poll = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    const polledGeneration = generation.current;

    try {
      const response = await fetch(
        `${url}?startEventId=${startEventId.current}`,
      );

      if (!response.ok) {
        setProblem({ kind: "http", status: response.status });
        return;
      }

      // Authored by our own dev plugin, which serves exactly this shape; JSON
      // parsing is what erases the type.
      const next = (await response.json()) as DataAppDiagnosticsReport;

      if (polledGeneration !== generation.current) {
        return;
      }

      setProblem(null);
      setLoaded(true);
      setReport(next);

      if (next.entries.length > 0) {
        startEventId.current = next.nextEventId;
        // Bounded like the server's ring buffer: every SDK call is an event, so
        // an unbounded list would grow all session and be re-filtered per render.
        setEntries((current) =>
          [...current, ...next.entries].slice(-DATA_APP_DIAGNOSTICS_LIMIT),
        );
      }
    } catch {
      // The dev server is down or restarting; keep what we have and say so.
      setProblem({ kind: "unreachable" });
    } finally {
      inFlight.current = false;
    }
  }, [url]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), pollMs);

    return () => clearInterval(timer);
  }, [poll, pollMs]);

  const clear = useCallback(() => {
    generation.current += 1;
    setEntries(EMPTY);
    // Read from the start again: the buffer is empty, and ids only climb, so
    // nothing already shown can come back.
    startEventId.current = 0;

    void fetch(url, { method: "DELETE" }).catch(() =>
      setProblem({ kind: "unreachable" }),
    );
  }, [url]);

  return {
    entries,
    connection: report?.connection ?? null,
    manifest: report?.manifest ?? null,
    clients: report?.clients ?? 0,
    lastReportAt: report?.lastReportAt ?? null,
    lastRebuildAt: report?.lastRebuildAt ?? null,
    problem,
    loaded,
    clear,
  };
};
