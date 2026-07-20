import { useStorageSetup } from "metabase/common/components/upsells/StoragePurchaseModal";

import { useAddDataState } from "./use-add-data-state";

/**
 * Everything the CSV panel can show, as one value. Computing it in a pure
 * function keeps the precedence between these cases in one readable place —
 * they overlap heavily, and expressing them as independent booleans is what
 * let the panel show contradictory things (a dead-end tab, a second storage
 * upsell to someone who already owns storage).
 */
export type CsvPanelState =
  | { type: "loading" }
  | { type: "provisioning-storage" }
  | { type: "storage-setup-failed" }
  | { type: "storage-awaiting-restart" }
  | { type: "ask-admin" }
  | { type: "no-upload-permission" }
  | { type: "needs-uploads-setup"; canOfferStorage: boolean }
  | { type: "ready" };

export interface CsvPanelStateInput {
  areDatabasesLoading: boolean;
  areUploadsEnabled: boolean;
  canUploadToDatabase: boolean;
  canManageUploads: boolean;
  isSettingUp: boolean;
  hasSetupFailed: boolean;
  isLoadingStorageAddOn: boolean;
  hasAttachedDwh: boolean;
  canUploadToAttachedDwh: boolean;
  canSetUpStorage: boolean;
}

export function getCsvPanelState({
  areDatabasesLoading,
  areUploadsEnabled,
  canUploadToDatabase,
  canManageUploads,
  isSettingUp,
  hasSetupFailed,
  isLoadingStorageAddOn,
  hasAttachedDwh,
  canUploadToAttachedDwh,
  canSetUpStorage,
}: CsvPanelStateInput): CsvPanelState {
  // Until the list arrives, "cannot upload anywhere" is indistinguishable from
  // "not fetched yet", and guessing shows a definitive answer that then flips.
  if (areDatabasesLoading) {
    return { type: "loading" };
  }

  if (isSettingUp) {
    return { type: "provisioning-storage" };
  }

  if (hasSetupFailed) {
    return { type: "storage-setup-failed" };
  }

  // Storage is provisioned but not yet the upload target. Enabling uploads by
  // hand won't help — that only happens once the instance is redeployed.
  if (hasAttachedDwh && !canUploadToAttachedDwh && !areUploadsEnabled) {
    return { type: "storage-awaiting-restart" };
  }

  if (!areUploadsEnabled) {
    if (!canManageUploads) {
      return { type: "ask-admin" };
    }

    if (isLoadingStorageAddOn) {
      return { type: "loading" };
    }

    return {
      type: "needs-uploads-setup",
      canOfferStorage: canSetUpStorage && !hasAttachedDwh,
    };
  }

  if (!canUploadToDatabase) {
    return { type: "no-upload-permission" };
  }

  return { type: "ready" };
}

/**
 * The panel's own state, gathered where the panel is rendered rather than
 * threaded down as a prop — the same shape the Sheets panel uses. The modal
 * stays out of it; it only needs the upload facts for its header links.
 */
export function useCsvPanelState(): CsvPanelState {
  const {
    areDatabasesLoading,
    areUploadsEnabled,
    canUploadToDatabase,
    canManageUploads,
  } = useAddDataState();
  const {
    isSettingUp,
    hasSetupFailed,
    isLoadingStorageAddOn,
    hasAttachedDwh,
    canUploadToAttachedDwh,
    canSetUpStorage,
  } = useStorageSetup();

  return getCsvPanelState({
    areDatabasesLoading,
    areUploadsEnabled,
    canUploadToDatabase,
    canManageUploads,
    isSettingUp,
    hasSetupFailed,
    isLoadingStorageAddOn,
    hasAttachedDwh,
    canUploadToAttachedDwh,
    canSetUpStorage,
  });
}
