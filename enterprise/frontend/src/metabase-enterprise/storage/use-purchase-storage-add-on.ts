import { useCallback, useEffect, useState } from "react";
import { t } from "ttag";

import { useListDatabasesQuery } from "metabase/api";
import { useTokenRefreshUntil } from "metabase/api/utils";
import {
  useHasTokenFeature,
  useSetting,
  useToast,
} from "metabase/common/hooks";
import { useSelector } from "metabase/redux";
import { getUserIsAdmin } from "metabase/selectors/user";
import { usePurchaseCloudAddOnMutation } from "metabase-enterprise/api";

import { STORAGE_PRODUCT_TYPE } from "./use-storage-add-on";

const POLL_INTERVAL_MS = 2000;

/**
 * Provisioning is inferred from server state, so a failed or abandoned setup
 * would otherwise leave the panels spinning indefinitely. The deadline is
 * client-side and restarts on a full page reload, which is acceptable: the
 * provider is mounted for the lifetime of the navbar.
 */
export const STORAGE_SETUP_TIMEOUT_MS = 10 * 60 * 1000;

const STORAGE_PURCHASE_CACHE_KEY = "purchase-storage-add-on";

export function usePurchaseStorageAddOn() {
  const isHosted = useSetting("is-hosted?");
  const isAdmin = useSelector(getUserIsAdmin);
  const hasStorageTokenFeature = useHasTokenFeature("attached_dwh");
  const [sendToast] = useToast();

  const [
    purchaseCloudAddOn,
    { isLoading: isPurchasing, isSuccess: isPurchased, reset: resetPurchase },
  ] = usePurchaseCloudAddOnMutation({
    fixedCacheKey: STORAGE_PURCHASE_CACHE_KEY,
  });

  const canSetUpStorage = isHosted && isAdmin;

  const { data: databasesResponse } = useListDatabasesQuery(undefined, {
    skip: !canSetUpStorage,
  });
  // Until loaded, "no attached DWH" is indistinguishable from "not fetched yet".
  const areDatabasesLoaded = databasesResponse !== undefined;
  const attachedDwhDatabase = databasesResponse?.data?.find(
    (db) => db.is_attached_dwh,
  );

  // Presence and readiness are distinct: storage exists as soon as its database
  // appears, but it only accepts uploads once it is the instance's upload
  // target, which needs a redeploy. Keying provisioning on readiness would trap
  // any admin who points uploads at a different database — only one database
  // can have uploads enabled at a time.
  const hasAttachedDwh = !!attachedDwhDatabase;
  const canUploadToAttachedDwh = !!attachedDwhDatabase?.can_upload;

  // Keeps us in setting-up from the POST until storage is ready; collapses on
  // its own on error (mutation no longer pending or successful).
  const isPurchaseSettingUp = isPurchasing || (isPurchased && !hasAttachedDwh);

  // Server-derived, so it survives the redeploy that provisioning triggers: the
  // token flips at purchase time, the DWH database only appears after redeploy.
  const isProvisioning =
    canSetUpStorage &&
    hasStorageTokenFeature &&
    areDatabasesLoaded &&
    !hasAttachedDwh;

  const isSetupPending = isPurchaseSettingUp || isProvisioning;

  const [hasSetupTimedOut, setHasSetupTimedOut] = useState(false);

  useEffect(() => {
    if (!isSetupPending) {
      setHasSetupTimedOut(false);
      return;
    }

    const timer = setTimeout(
      () => setHasSetupTimedOut(true),
      STORAGE_SETUP_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [isSetupPending]);

  const isSettingUp = isSetupPending && !hasSetupTimedOut;
  const hasSetupFailed = isSetupPending && hasSetupTimedOut;

  // Refresh the token (a Store round-trip) until `attached_dwh` shows up.
  useTokenRefreshUntil("attached-dwh", {
    skip: !isSettingUp || hasStorageTokenFeature,
  });

  // The databases list is what the panels key off, so it alone drives the
  // transition out of setting-up. This is a second *subscription* to the query
  // above, not a second request — RTK serves both from one cache entry; it
  // exists only to attach polling, which can't be conditioned on `isSettingUp`
  // in the first call because that value is derived from the first call's data.
  useListDatabasesQuery(undefined, {
    skip: !isSettingUp,
    pollingInterval: POLL_INTERVAL_MS,
    skipPollingIfUnfocused: true,
  });

  const handlePurchase = useCallback(async () => {
    try {
      await purchaseCloudAddOn({ product_type: STORAGE_PRODUCT_TYPE }).unwrap();
    } catch {
      sendToast({
        icon: "warning_triangle_filled",
        iconColor: "feedback-warning",
        message: t`It looks like something went wrong. Please refresh the page and try again.`,
      });
    }
  }, [purchaseCloudAddOn, sendToast]);

  return {
    isSettingUp,
    hasSetupFailed,
    hasAttachedDwh,
    canUploadToAttachedDwh,
    handlePurchase,
    resetPurchase,
    canSetUpStorage,
  };
}
