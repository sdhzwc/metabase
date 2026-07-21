/* eslint-disable i18next/no-literal-string */
import cx from "classnames";
import { useState } from "react";

import { useDiagnosticsFeed } from "../../lib/use-diagnostics-feed";

import { ConnectionTab } from "./ConnectionTab/ConnectionTab";
import S from "./DevToolbar.module.css";
import { DiagnosticsToggle } from "./DiagnosticsToggle/DiagnosticsToggle";
import { EntryList } from "./EntryList/EntryList";
import { FeedBanner } from "./FeedBanner/FeedBanner";
import { ManifestTab } from "./ManifestTab/ManifestTab";
import { QueriesTab } from "./QueriesTab/QueriesTab";
import { ResizeHandle } from "./ResizeHandle/ResizeHandle";
import { TABS, type TabId, isBlocked } from "./entries";
import { usePanelResize } from "./use-panel-resize";

/**
 * The data-app dev diagnostics toolbar. Closed, it's a corner button; open, a
 * bottom-docked, resizable panel of tabbed diagnostics. It's a pure reader of the
 * dev server's feed (see `useDiagnosticsFeed`).
 */
export function DevToolbar() {
  const feed = useDiagnosticsFeed();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("errors");
  const { height, startResize } = usePanelResize();

  const { entries } = feed;
  const count = entries.filter((entry) => entry.alert).length;

  const tabEntries = {
    errors: entries.filter((entry) => entry.kind === "error"),
    blocked: entries.filter(isBlocked),
    queries: entries.filter((entry) => entry.kind === "sdk-call"),
  };

  if (!open) {
    return (
      <div className={S.DevToolbar}>
        <DiagnosticsToggle count={count} onOpen={() => setOpen(true)} />
      </div>
    );
  }

  return (
    <div className={S.DevToolbar}>
      <div
        className={cx(S.Panel, S.Docked)}
        style={{ height }}
        data-testid="dev-toolbar-panel"
      >
        <ResizeHandle onMouseDown={startResize} />

        <div className={S.Header}>
          <span className={S.Title}>Data app diagnostics</span>
          <span className={S.Spacer} />
          <button type="button" className={S.Action} onClick={feed.clear}>
            Clear
          </button>
          <button
            type="button"
            className={S.Action}
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>

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
          <FeedBanner
            problem={feed.problem}
            loaded={feed.loaded}
            clients={feed.clients}
          />
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
