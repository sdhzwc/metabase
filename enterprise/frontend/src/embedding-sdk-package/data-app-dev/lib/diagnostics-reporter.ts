// Pushes the diagnostics store up the HMR socket for the dev server to re-serve.

import {
  getDevConnectionStatus,
  getDevDiagnostics,
  subscribeDevDiagnostics,
} from "../components/DevToolbar/diagnostics";
import {
  DATA_APP_DIAGNOSTICS_EVENT,
  type DataAppDiagnosticsMessage,
} from "../diagnostics-channel";

import { toPayload } from "./diagnostics-payload";

/** The subset of `import.meta.hot` this needs, so tests can pass a stub. */
export interface DiagnosticsReporterHot {
  send: (event: string, data: DataAppDiagnosticsMessage) => void;
}

// A render can record several entries in one tick.
const FLUSH_MS = 100;

// Once per module load, i.e. once per full page load.
const makeSessionId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Mirrors the store to the dev server. Sends each entry once, tracked by an
 * ever-increasing id. The manifest is not reported — the dev server owns it.
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

  // Report once up front so the server knows a client is alive.
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
