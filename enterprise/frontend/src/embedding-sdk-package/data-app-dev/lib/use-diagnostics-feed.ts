// The toolbar's data source: reads the dev server's feed, so the panel and any
// external reader (an agent polling the same URL) always show the same thing.

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DATA_APP_DIAGNOSTICS_LIMIT,
  DATA_APP_DIAGNOSTICS_URL,
  type DataAppDiagnosticPayload,
  type DataAppDiagnosticsReport,
  type DevConnectionStatus,
} from "../diagnostics-channel";
import type { DataAppManifestStatus } from "../manifest-status";

const REFETCH_POLL_MS = 1000;

// Distinguished because only `unreachable` is fixed by restarting `npm run dev`.
export type DiagnosticsFeedProblem =
  | { kind: "unreachable" }
  | { kind: "http"; status: number };

export interface DiagnosticsFeed {
  entries: DataAppDiagnosticPayload[];
  connection: DevConnectionStatus | null;
  manifest: DataAppManifestStatus | null;
  clients: number;
  lastReportAt: number | null;
  lastRebuildAt: number | null;
  problem: DiagnosticsFeedProblem | null;
  loaded: boolean;
  clear: () => void;
}

const EMPTY: DataAppDiagnosticPayload[] = [];

export const useDiagnosticsFeed = (
  url: string = DATA_APP_DIAGNOSTICS_URL,
  pollMs: number = REFETCH_POLL_MS,
): DiagnosticsFeed => {
  const [entries, setEntries] = useState<DataAppDiagnosticPayload[]>(EMPTY);
  const [report, setReport] = useState<DataAppDiagnosticsReport | null>(null);
  const [problem, setProblem] = useState<DiagnosticsFeedProblem | null>(null);
  const [loaded, setLoaded] = useState(false);

  // A ref, not state: advancing it must not trigger a re-render or the poll loops.
  const startEventId = useRef(0);
  // A poll can outlive its tick (a rebuild blocks the server for seconds).
  // Without this, overlapping reads share a cursor and append the same batch twice.
  const inFlight = useRef(false);
  // Bumped by `clear()`, so a response fetched before it is discarded.
  const generation = useRef(0);
  // When this changes (a full reload started a new reporter) the previous page's
  // events are dropped.
  const session = useRef<string | null>(null);

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

      // Authored by our own dev plugin; JSON parsing is what erases the type.
      const next = (await response.json()) as DataAppDiagnosticsReport;

      if (polledGeneration !== generation.current) {
        return;
      }

      setProblem(null);
      setLoaded(true);
      setReport(next);

      if (next.session !== null && next.session !== session.current) {
        if (session.current !== null) {
          startEventId.current = 0;
          setEntries(EMPTY);
        }
        session.current = next.session;
      }

      // A restarted dev server begins its ids at 1 again. Without this the cursor
      // stays above every new id and the panel looks healthy but stays empty.
      // Accumulated entries belong to the old server and would collide on id.
      if (next.nextEventId < startEventId.current) {
        startEventId.current = 0;
        setEntries(EMPTY);
      }

      if (next.entries.length > 0) {
        startEventId.current = next.nextEventId;
        // Bounded like the server's ring buffer.
        setEntries((current) =>
          [...current, ...next.entries].slice(-DATA_APP_DIAGNOSTICS_LIMIT),
        );
      }
    } catch {
      // Down or restarting: keep what we have and say so.
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
    // Ids only climb, so nothing already shown can come back.
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
