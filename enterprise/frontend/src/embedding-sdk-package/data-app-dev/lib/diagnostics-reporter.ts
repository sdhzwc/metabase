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

export interface DiagnosticsReporterHot {
  send: (event: string, data: DataAppDiagnosticsMessage) => void;
}

const FLUSH_MS = 100;

export const installDiagnosticsReporter = (
  hot: DiagnosticsReporterHot,
): (() => void) => {
  const sessionId = String(Date.now());

  let lastSentId = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;

    const fresh = getDevDiagnostics().filter((entry) => entry.id > lastSentId);

    if (fresh.length > 0) {
      lastSentId = fresh[fresh.length - 1].id;
    }

    hot.send(DATA_APP_DIAGNOSTICS_EVENT, {
      sessionId,
      entries: fresh.map(toPayload),
      connection: getDevConnectionStatus(),
    });
  };

  const schedule = () => {
    timer ??= setTimeout(flush, FLUSH_MS);
  };

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
