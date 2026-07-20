/* eslint-disable i18next/no-literal-string */
/* eslint-disable metabase/no-literal-metabase-strings -- dev-only toolbar for data-app authors, not whitelabel-able product UI */
import cx from "classnames";
import { type ReactNode, useState } from "react";

import type { DataAppDiagnosticPayload } from "../../diagnostics-channel";
import { useDiagnosticsFeed } from "../../lib/use-diagnostics-feed";
import type { DataAppManifestStatus } from "../../manifest-status";

import S from "./DevToolbar.module.css";
import type { DevConnectionStatus } from "./diagnostics";

type TabId = "errors" | "blocked" | "queries" | "manifest" | "connection";

const TABS: { id: TabId; label: string }[] = [
  { id: "errors", label: "Errors" },
  { id: "blocked", label: "Blocked" },
  { id: "queries", label: "Queries" },
  { id: "manifest", label: "Manifest" },
  { id: "connection", label: "Connection" },
];

const BLOCKED_KINDS = ["blocked-api", "blocked-network", "csp-violation"];

const isBlocked = (entry: DataAppDiagnosticPayload): boolean =>
  BLOCKED_KINDS.includes(entry.kind);

const isFailedCall = (entry: DataAppDiagnosticPayload): boolean =>
  entry.kind === "sdk-call" && entry.alert;

const EntryList = ({
  entries,
  emptyMessage,
}: {
  entries: readonly DataAppDiagnosticPayload[];
  emptyMessage: string;
}) => {
  if (entries.length === 0) {
    return <div className={S.Empty}>{emptyMessage}</div>;
  }
  return (
    <>
      {entries
        .slice()
        .reverse()
        .map((entry) => (
          <div
            key={entry.eventId}
            className={cx(S.Entry, { [S.EntryFailed]: isFailedCall(entry) })}
          >
            <div className={S.EntryTime}>
              {new Date(entry.time).toLocaleTimeString()}
            </div>
            {entry.detail ? (
              <details>
                <summary className={cx(S.EntryMessage, S.EntrySummary)}>
                  {entry.summary}
                </summary>
                <div className={S.EntryDetail}>{entry.detail}</div>
              </details>
            ) : (
              <div className={S.EntryMessage}>{entry.summary}</div>
            )}
            {entry.hint && <div className={S.EntryHint}>{entry.hint}</div>}
          </div>
        ))}
    </>
  );
};

const QueriesTab = ({
  entries,
}: {
  entries: readonly DataAppDiagnosticPayload[];
}) => {
  const [failedOnly, setFailedOnly] = useState(false);
  const failedCount = entries.filter(isFailedCall).length;
  const shown = failedOnly ? entries.filter(isFailedCall) : entries;

  return (
    <>
      <div className={S.Note}>
        Dev runs with an API key; in production the app runs as the viewing
        user, whose data permissions may differ.
      </div>
      <label className={S.Filter}>
        <input
          type="checkbox"
          checked={failedOnly}
          onChange={(event) => setFailedOnly(event.target.checked)}
        />
        Failed only{failedCount > 0 ? ` (${failedCount})` : ""}
      </label>
      <EntryList
        entries={shown}
        emptyMessage={
          failedOnly ? "No failed calls." : "No Metabase calls captured."
        }
      />
    </>
  );
};

const StatusRow = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div className={S.StatusRow}>
    <span className={S.StatusLabel}>{label}</span>
    <span className={S.StatusValue}>{children}</span>
  </div>
);

const check = (ok: boolean) => (ok ? "✓" : "✗");

const ConnectionTab = ({ connection }: { connection: unknown }) => {
  // Authored by our own connection check and round-tripped through the feed,
  // which erases the type.
  const status = connection as DevConnectionStatus | null;

  if (!status) {
    return <div className={S.Empty}>Connection check has not run yet.</div>;
  }
  return (
    <div className={S.StatusBody}>
      <StatusRow label="Metabase URL">{status.metabaseUrl}</StatusRow>
      <StatusRow label="Reachable">{check(status.reachable)}</StatusRow>
      <StatusRow label="API key">
        {status.apiKeyValid == null
          ? "not checked"
          : status.apiKeyValid
            ? "✓ valid"
            : "✗ invalid"}
      </StatusRow>
      <StatusRow label="Metabase version">
        {status.metabaseVersion ?? "unknown"}
      </StatusRow>
      <StatusRow label="SDK version">
        {status.sdkVersion ?? "unknown"}
      </StatusRow>
      {status.error && <div className={S.Problem}>{status.error}</div>}
    </div>
  );
};

const ManifestTab = ({ manifest }: { manifest: unknown }) => {
  // Authored by `validateDataAppManifest` and round-tripped through the feed,
  // which erases the type.
  const status = manifest as DataAppManifestStatus | null;

  if (!status) {
    return <div className={S.Empty}>Manifest has not been validated yet.</div>;
  }
  return (
    <div className={S.StatusBody}>
      {status.restartRequired && (
        <div className={S.Problem}>
          allowed_hosts changed since the dev server started — restart `npm run
          dev` to apply it to the sandbox and CSP.
        </div>
      )}
      {status.errors.map((error) => (
        <div key={error} className={S.Problem}>
          {error}
        </div>
      ))}
      {status.warnings.map((warning) => (
        <div key={warning} className={S.Warning}>
          {warning}
        </div>
      ))}
      {status.errors.length === 0 && status.warnings.length === 0 && (
        <div className={S.Empty}>data_app.yaml is valid.</div>
      )}
      <StatusRow label="name">{status.name ?? "missing"}</StatusRow>
      <StatusRow label="path">
        {status.bundlePath ?? "missing"}
        {status.bundlePath != null &&
          !status.bundlePathExists &&
          " (file not found)"}
      </StatusRow>
      <StatusRow label="allowed_hosts">
        {status.allowedHosts.length > 0
          ? status.allowedHosts.join(", ")
          : "none (network egress is blocked)"}
      </StatusRow>
    </div>
  );
};

export function DevToolbar() {
  const feed = useDiagnosticsFeed();
  const [open, setOpen] = useState(false);
  const [docked, setDocked] = useState(false);
  const [tall, setTall] = useState(false);
  const [tab, setTab] = useState<TabId>("errors");

  const { entries } = feed;
  const alerts = entries.filter((entry) => entry.alert);
  const count = alerts.length;

  const tabEntries: Record<
    Exclude<TabId, "manifest" | "connection">,
    readonly DataAppDiagnosticPayload[]
  > = {
    errors: entries.filter((entry) => entry.kind === "error"),
    blocked: entries.filter(isBlocked),
    queries: entries.filter((entry) => entry.kind === "sdk-call"),
  };

  // The panel reads the dev server's feed, so no data can mean "the feed is
  // broken" rather than "nothing went wrong" — say which. `loaded` gates the
  // no-clients note so it doesn't flash before the first response lands.
  const banner =
    feed.problem?.kind === "unreachable" ? (
      <div className={S.Problem}>
        Can&apos;t reach the dev server, so this is not up to date. Is `npm run
        dev` still running?
      </div>
    ) : feed.problem?.kind === "http" ? (
      <div className={S.Problem}>
        The dev server answered {feed.problem.status} for the diagnostics feed,
        so this is not up to date.
      </div>
    ) : feed.loaded && feed.clients === 0 ? (
      <div className={S.Note}>
        No preview tab is connected, so nothing has been captured yet.
      </div>
    ) : null;

  const header = (
    <div className={S.Header}>
      <span className={S.Title}>Data app diagnostics</span>
      <span className={S.Spacer} />
      {docked && (
        <button
          type="button"
          className={S.Action}
          onClick={() => setTall((value) => !value)}
        >
          {tall ? "Third" : "Half"}
        </button>
      )}
      <button type="button" className={S.Action} onClick={feed.clear}>
        Clear
      </button>
      <button
        type="button"
        className={S.Action}
        onClick={() => setDocked((value) => !value)}
      >
        {docked ? "Collapse" : "Expand"}
      </button>
      <button
        type="button"
        className={S.Action}
        onClick={() => {
          setOpen(false);
          setDocked(false);
        }}
      >
        Close
      </button>
    </div>
  );

  if (docked) {
    return (
      <div className={S.DevToolbar}>
        <div className={cx(S.Panel, S.Docked, { [S.DockedTall]: tall })}>
          {header}
          <div className={S.Tabs} role="tablist">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={cx(S.Tab, { [S.TabActive]: tab === id })}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={S.Body}>
            {banner}
            {tab === "errors" && (
              <EntryList
                entries={tabEntries.errors}
                emptyMessage="No errors captured."
              />
            )}
            {tab === "blocked" && (
              <EntryList
                entries={tabEntries.blocked}
                emptyMessage="Nothing blocked."
              />
            )}
            {tab === "queries" && <QueriesTab entries={tabEntries.queries} />}
            {tab === "manifest" && <ManifestTab manifest={feed.manifest} />}
            {tab === "connection" && (
              <ConnectionTab connection={feed.connection} />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={S.DevToolbar}>
      {open && (
        <div className={S.Panel}>
          {header}
          <div className={S.Body}>
            {banner}
            <EntryList entries={alerts} emptyMessage="No errors captured." />
          </div>
        </div>
      )}

      <button
        type="button"
        className={cx(S.Toggle, { [S.ToggleHasErrors]: count > 0 })}
        onClick={() => setOpen((value) => !value)}
        title="Data app diagnostics"
      >
        ⚠ Diagnostics{count > 0 ? ` (${count})` : ""}
      </button>
    </div>
  );
}
