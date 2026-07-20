import dayjs from "dayjs";
import { useMemo } from "react";

import { useListDatabasesQuery } from "metabase/api";
import { parseTimestamp } from "metabase/utils/time-dayjs";
import type { Database } from "metabase-types/api";

/**
 * A freshly provisioned DWH only becomes the upload target once the instance
 * redeploys; an old one that isn't the target is a deliberate admin choice.
 * Nothing on the wire distinguishes the two, so we use creation time. The exact
 * window isn't load-bearing — just longer than a redeploy.
 */
export const DWH_ACTIVATION_WINDOW_MS = 60 * 60 * 1000;

export interface AttachedDwhInfo {
  /** Storage exists on this instance. */
  hasAttachedDwh: boolean;
  /** Storage was provisioned so recently that the redeploy is still pending. */
  isAttachedDwhAwaitingActivation: boolean;
}

export interface AttachedDwhState extends AttachedDwhInfo {
  /** While true, the flags above read `false` because nothing was fetched yet. */
  areDatabasesLoading: boolean;
}

/** Exported so callers already subscribed to the databases list can reuse it. */
export function getAttachedDwhInfo(
  databases: Database[] | undefined,
): AttachedDwhInfo {
  const attachedDwh = databases?.find((db) => db.is_attached_dwh);

  const wasCreatedRecently =
    !!attachedDwh &&
    dayjs().diff(parseTimestamp(attachedDwh.created_at)) <
      DWH_ACTIVATION_WINDOW_MS;

  return {
    hasAttachedDwh: !!attachedDwh,
    isAttachedDwhAwaitingActivation:
      !!attachedDwh && !attachedDwh.can_upload && wasCreatedRecently,
  };
}

/**
 * Whether this instance has Metabase Storage, derived from the databases list.
 *
 * Deliberately ungated on admin/hosted: non-admins such as settings managers
 * also need the answer, and the databases list is already fetched on every page.
 */
export function useAttachedDwh(): AttachedDwhState {
  const { data: databasesResponse, isLoading: areDatabasesLoading } =
    useListDatabasesQuery();
  const databases = databasesResponse?.data;

  // Mounted on every page, so keep the dayjs parsing off the render path.
  return useMemo(
    () => ({ ...getAttachedDwhInfo(databases), areDatabasesLoading }),
    [databases, areDatabasesLoading],
  );
}
