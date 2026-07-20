import { match } from "ts-pattern";

import type { GdrivePayload } from "metabase-types/api";

/**
 * Everything the Google Sheets panel can show, as one value — the counterpart
 * to the CSV panel's state. Both panels are reachable from the same modal and
 * gate on the same storage setup, so deriving both in one place is what stops
 * them drifting into contradictory rules again.
 *
 * Plain strings rather than `CsvPanelState`'s tagged objects: no Sheets state
 * carries data, and `match` stays exhaustive either way.
 */
export type SheetsPanelState =
  | "provisioning-storage"
  | "storage-setup-failed"
  | "ask-admin"
  | "needs-storage"
  | "unavailable"
  | "connection-details"
  | "connected"
  | "storage-full"
  | "not-connected"
  | "connecting"
  | "connection-error";

export interface SheetsPanelStateInput {
  isSettingUp: boolean;
  hasSetupFailed: boolean;
  isAdmin: boolean;
  hasAttachedDwh: boolean;
  showGdrive: boolean;
  areConnectionDetailsShown: boolean;
  status: GdrivePayload["status"];
}

export function getSheetsPanelState({
  isSettingUp,
  hasSetupFailed,
  isAdmin,
  hasAttachedDwh,
  showGdrive,
  areConnectionDetailsShown,
  status,
}: SheetsPanelStateInput): SheetsPanelState {
  if (isSettingUp) {
    return "provisioning-storage";
  }

  if (hasSetupFailed) {
    return "storage-setup-failed";
  }

  if (!isAdmin) {
    return "ask-admin";
  }

  if (!hasAttachedDwh) {
    return "needs-storage";
  }

  // An admin on a hosted instance with storage, but some other condition from
  // `useShowGdrive` is unmet — there is nothing specific we can tell them.
  if (!showGdrive) {
    return "unavailable";
  }

  if (areConnectionDetailsShown) {
    return "connection-details";
  }

  return match<GdrivePayload["status"], SheetsPanelState>(status)
    .with("active", "syncing", () => "connected")
    .with("paused", () => "storage-full")
    .with("not-connected", () => "not-connected")
    .with("initializing", () => "connecting")
    .with("error", () => "connection-error")
    .exhaustive();
}
