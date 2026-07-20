import { useAddDataState } from "./AddDataModal/use-add-data-state";

/**
 * Whether to offer the "Add data" entry points in the navbar. Composed from
 * `useAddDataState` so the navbar and the modal it opens cannot disagree about
 * who can upload — the upload facts have a single owner.
 */
export function useCanAddData() {
  const { canUploadToDatabase, canManageUploads, isAdmin } = useAddDataState();

  return canUploadToDatabase || canManageUploads || isAdmin;
}
