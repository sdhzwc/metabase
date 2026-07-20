# AddDataModal — why the state is shaped the way it is

Scope: `frontend/src/metabase/nav/containers/MainNavbar/MainNavbarContainer/AddDataModal/**`,
`enterprise/frontend/src/metabase-enterprise/storage/**`,
`frontend/src/metabase/common/components/upsells/StoragePurchaseModal/**`,
`enterprise/frontend/src/metabase-enterprise/google_drive/GdriveAddDataPanel.tsx`.

The constraints below came out of an investigation into a cluster of contradictory-state bugs in this
modal. They are kept because re-deriving them from the backend costs a day, not as a status tracker —
for what shipped when, read `git log` on these paths.

## 1. Ground truth (backend-verified)

The single most important fact, from `src/metabase/upload/settings.clj`: **only one database can have
uploads enabled at a time.** The setter flips `uploads_enabled` off on every other DB; the getter is
`select-one :model/Database :uploads_enabled true`.

And `can_upload` (`src/metabase/warehouses_rest/api.clj`, `src/metabase/upload/impl.clj`)
= `db.uploads_enabled` **AND** unrestricted `view-data` + query-builder `create-queries` on that schema
**AND** the driver supports uploads.

So the states this modal branches on are not independent — they collapse:

| State | Real meaning | Independent? |
|---|---|---|
| `isHosted` | `is-hosted?` setting | yes |
| `isAdmin` | superuser | yes |
| `canManageUploads` | `canAccessSettings` — **implied by** `isAdmin` | yes (only adds "settings manager, not admin") |
| dwh token (`attached_dwh`) | flips at *purchase*, before provisioning | yes |
| `hasAttachedDwh` | `is_attached_dwh` in `/api/database` — appears only after **redeploy** | yes |
| `areUploadsEnabled` | ∃ db with `uploads_enabled` | yes |
| `canUploadToAttachedDwh` / "can upload to another db" | **the same DB** — only one can be the upload target | **no** — collapses to one flag |

### 1a. Why the upload facts must come from the databases list, never `uploads-settings`

The two are semantically equivalent *server-side*, so they can only diverge through client staleness —
and there is a permanent source of it:

- The databases list (`useListDatabasesQuery`) is **fresh and pollable**.
- `useSetting("uploads-settings")` reads the redux `settings` slice
  (`frontend/src/metabase/redux/settings.ts`), which is seeded from `window.MetabaseBootstrap` and only
  ever updated by `loadSettings` / `refreshSiteSettings` / `updateUserSetting`.
- The provisioning poll in `use-purchase-storage-add-on.ts` writes to the **RTK cache, not that slice**.

So `uploads-settings.db_id` goes stale for the **whole session** — it does not catch up when
provisioning completes, when another admin switches the upload DB, or during any poll. Only a page
reload fixes it. That produced a visible CSV tab reading "you are not permitted to upload" for a
database the user *could* upload to, a missing "Manage imports" link, and a storage upsell shown to
admins who already owned storage.

`useAddDataState` therefore does not read the setting at all; both flags derive from the list:

```ts
const areUploadsEnabled = !!databases?.some((db) => db.uploads_enabled);
const canUploadToDatabase = !!databases?.some((db) => db.can_upload);
```

`uploads_enabled` was already on the `Database` type and returned by `dbs-list`, so no backend change
was needed. Freshness is automatic: `frontend/src/metabase/api/settings.ts` invalidates the database
list tag when `uploads-settings` is updated.

One deliberate behavior change falls out of this: a user with *no* access to the upload DB no longer
sees it in the list, so they get "contact your admin to enable CSV upload" rather than "you are not
permitted to upload" — which stops disclosing a database they cannot see. Sandboxed users who *can* see
the DB but lack unrestricted view-data still get the "not permitted" message.

## 2. How the state is put together

Each panel owns its own state and derives it from a pure function, so the precedence between
overlapping cases lives in one readable place per panel and is testable without rendering:

| Piece | Role |
|---|---|
| `AddDataModal/use-add-data-state.ts` | the upload facts (`areUploadsEnabled`, `canUploadToDatabase`, `canManageUploads`, `isAdmin`, `areDatabasesLoading`), derived once from the databases list |
| `AddDataModal/csv-panel-state.ts` | `getCsvPanelState` (pure) + `useCsvPanelState`, which folds in `useStorageSetup` |
| `google_drive/sheets-panel-state.ts` | `getSheetsPanelState`, the Sheets counterpart |
| `MainNavbarContainer/use-can-add-data.ts` | whether the navbar offers "Add data" at all — composed from `useAddDataState` so the two cannot disagree |

The modal itself only reads the upload facts, for its header links; it does not compute or pass panel
state. `CSVPanel` and `GdriveAddDataPanel` are each a `match(state).exhaustive()` over their own hook.

## 3. Decisions worth not re-litigating

- **Both tabs are always visible.** The always-visible Sheets tab is intentional discoverability, so CSV
  was made equally permissive rather than Sheets made stricter. The only dead-end state is
  `no-upload-permission`, which needs uploads enabled somewhere **and** no upload permission **and** no
  settings access — exactly the population `useCanAddData` already excludes from every entry point.
  Users with settings access land on `needs-uploads-setup`, which has a real CTA.
- **No `enabled`/skip on the databases query.** `useCanAddData` runs in `BrowseNavSection` and
  `GettingStartedSection`, mounted on every page, so the modal skipping its own call would save nothing.
  The win is single derivation and a real `isLoading`, not fewer requests.
- **`hasAttachedDwh` means presence, `canUploadToAttachedDwh` means readiness.** Collapsing them stuck
  any admin whose DWH row was missing or was no longer the upload target in a permanent "Setting up
  storage". The pre-redeploy window needs a state of its own (`storage-awaiting-restart`) rather than
  falling through to "Enable uploads" + upsell.
- **`isSettingUp` is inferred from server state, so it needs a deadline.** `STORAGE_SETUP_TIMEOUT_MS`
  (10 min) turns a genuinely stuck setup into `hasSetupFailed` → `StorageSetupErrorView`. It is
  client-side and resets on a full page reload, which is acceptable: the provider lives for the lifetime
  of the navbar.

## 4. Still open

**The "Metabase Storage is ready" toast fires on presence.** In the pre-redeploy window it can say
"ready" while the CSV panel says uploads turn on after a restart. Judged acceptable — provisioning did
finish and Sheets works immediately — but gating it on readiness is a live option. Gating it that way
means it never fires at all for anyone who lands in that window.

**The Sheets panel has no `loading` state**, unlike CSV. Until the databases list and the service
account query resolve, `hasAttachedDwh` and `showGdrive` are both `false`, so a hosted admin who already
has storage can see the "Add Metabase Storage" upsell or the sync-error alert flash before the real
state lands.

**`hasAttachedDwh` is permission-gated.** It derives from a query skipped on `!canSetUpStorage`
(`isHosted && isAdmin`), so a settings manager who is not an admin always sees it as `false` and falls
past `storage-awaiting-restart` into `needs-uploads-setup`. Deriving presence from the ungated databases
list `useAddDataState` already fetches would fix it.

**A full matrix spec** over
`(isAdmin, canManageUploads, isHosted, hasDwhToken, hasAttachedDwh, canUploadToAttachedDwh,
areUploadsEnabled, canUploadToDatabase, isLoading)` asserting `{visible tabs, panel state, header
links}` would subsume the one-off rendering cases. `csv-panel-state.unit.spec.ts` and
`sheets-panel-state.unit.spec.ts` currently cover each panel's own axis.
