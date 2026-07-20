// Pushes the diagnostics store up the HMR socket so the dev server can re-serve
// it as JSON (see `diagnostics-channel.ts`). Dev-only, and inert when the page is
// served without HMR.

import {
  type DevDiagnosticEntry,
  devDiagnosticHint,
  getDevConnectionStatus,
  getDevDiagnostics,
  isFailedSdkCall,
  splitDevDiagnostic,
  subscribeDevDiagnostics,
} from "../components/DevToolbar/diagnostics";
import {
  DATA_APP_DIAGNOSTICS_EVENT,
  type DataAppDiagnosticPayload,
  type DataAppDiagnosticsMessage,
  truncateDiagnosticText,
} from "../diagnostics-channel";

/** The subset of `import.meta.hot` this needs, so tests can pass a stub. */
export interface DiagnosticsReporterHot {
  send: (event: string, data: DataAppDiagnosticsMessage) => void;
}

const isAlert = (entry: DevDiagnosticEntry): boolean =>
  entry.kind === "error" ||
  entry.kind === "blocked-api" ||
  entry.kind === "blocked-network" ||
  entry.kind === "csp-violation" ||
  isFailedSdkCall(entry);

const toPayload = (entry: DevDiagnosticEntry): DataAppDiagnosticPayload => {
  const { summary, detail } = splitDevDiagnostic(entry);
  return {
    // Re-stamped by the dev server on receipt; this is only a placeholder so the
    // payload is well-formed in transit.
    eventId: entry.id,
    time: entry.time,
    kind: entry.kind,
    summary: truncateDiagnosticText(summary),
    detail: detail === null ? null : truncateDiagnosticText(detail),
    hint: devDiagnosticHint(entry),
    alert: isAlert(entry),
  };
};

/** Batching window: a render can record several entries in one tick. */
const FLUSH_MS = 100;

/** A per-page-load id. Runs once per module load, i.e. once per full page load. */
const makeSessionId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Start mirroring the diagnostics store to the dev server. The manifest is NOT
 * reported: the dev server validates `data_app.yaml` itself and owns that status.
 * Sends each entry once,
 * tracked by an id that only ever increases, so nothing is mirrored twice — along
 * with the current connection status.
 *
 * Returns a teardown fn.
 */
export const installDiagnosticsReporter = (
  hot: DiagnosticsReporterHot,
): (() => void) => {
  const session = makeSessionId();
  let lastSentId = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;

    const fresh = getDevDiagnostics().filter((entry) => entry.id > lastSentId);
    if (fresh.length > 0) {
      lastSentId = fresh[fresh.length - 1].id;
    }

    hot.send(DATA_APP_DIAGNOSTICS_EVENT, {
      session,
      entries: fresh.map(toPayload),
      connection: getDevConnectionStatus(),
    });
  };

  const schedule = () => {
    timer ??= setTimeout(flush, FLUSH_MS);
  };

  // Report once up front, so the server knows a client is alive and has the
  // current status even on a clean run with nothing to report.
  flush();

  const unsubscribe = subscribeDevDiagnostics(schedule);

  return () => {
    unsubscribe();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
};
