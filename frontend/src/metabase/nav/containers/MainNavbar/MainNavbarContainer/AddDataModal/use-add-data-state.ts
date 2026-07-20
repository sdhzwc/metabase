import { useListDatabasesQuery } from "metabase/api";
import { useSelector } from "metabase/redux";
import { canAccessSettings, getUserIsAdmin } from "metabase/selectors/user";

/**
 * The upload facts the Add data modal derives from, in one place so the tabs,
 * the header links and the CSV panel cannot disagree about them.
 *
 * Both upload facts come from the databases list rather than the
 * `uploads-settings` setting. The setting resolves through the redux settings
 * slice, which is only written when session properties are refetched — so it
 * goes stale for the rest of the session as soon as the upload target changes
 * or storage finishes provisioning. The list is refetched automatically,
 * because updating `uploads-settings` invalidates the database list tag.
 */
export function useAddDataState(): {
  areDatabasesLoading: boolean;
  areUploadsEnabled: boolean;
  canUploadToDatabase: boolean;
  canManageUploads: boolean;
  isAdmin: boolean;
} {
  const { data: databasesResponse, isLoading: areDatabasesLoading } =
    useListDatabasesQuery();
  const canManageUploads = useSelector(canAccessSettings);
  const isAdmin = useSelector(getUserIsAdmin);

  const databases = databasesResponse?.data;

  return {
    areDatabasesLoading,
    areUploadsEnabled: !!databases?.some((db) => db.uploads_enabled),
    canUploadToDatabase: !!databases?.some((db) => db.can_upload),
    canManageUploads,
    isAdmin,
  };
}
