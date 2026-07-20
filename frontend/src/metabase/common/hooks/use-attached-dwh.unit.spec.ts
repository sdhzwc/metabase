import fetchMock from "fetch-mock";

import { setupDatabaseListEndpoint } from "__support__/server-mocks";
import { renderHookWithProviders, waitFor } from "__support__/ui";
import { createMockState } from "metabase/redux/store/mocks";
import { createMockDatabase, createMockUser } from "metabase-types/api/mocks";

import { DWH_ACTIVATION_WINDOW_MS, useAttachedDwh } from "./use-attached-dwh";

const HOUR_MS = 60 * 60 * 1000;

function setup({
  hasAttachedDwhDatabase = true,
  canUpload = false,
  createdMsAgo = 0,
  isAdmin = false,
}: {
  hasAttachedDwhDatabase?: boolean;
  /** False before the redeploy that makes storage the upload target. */
  canUpload?: boolean;
  createdMsAgo?: number;
  isAdmin?: boolean;
} = {}) {
  setupDatabaseListEndpoint(
    hasAttachedDwhDatabase
      ? [
          createMockDatabase({
            id: 1,
            is_attached_dwh: true,
            can_upload: canUpload,
            created_at: new Date(Date.now() - createdMsAgo).toISOString(),
          }),
        ]
      : [],
  );

  return renderHookWithProviders(() => useAttachedDwh(), {
    storeInitialState: createMockState({
      currentUser: createMockUser({ is_superuser: isAdmin }),
    }),
  });
}

describe("useAttachedDwh", () => {
  it("reports storage for a non-admin", async () => {
    // This used to come from a query skipped for anyone who couldn't buy
    // storage, so non-admins saw an instance with storage as one without.
    const { result } = setup({ isAdmin: false, canUpload: true });

    await waitFor(() => {
      expect(result.current.hasAttachedDwh).toBe(true);
    });
  });

  it("treats storage that is not the upload target yet as awaiting activation", async () => {
    const { result } = setup({ canUpload: false, createdMsAgo: 0 });

    await waitFor(() => {
      expect(result.current.isAttachedDwhAwaitingActivation).toBe(true);
    });
  });

  it("does not treat long-standing storage with uploads off as awaiting activation", async () => {
    // Same shape on the wire, but here it means an admin turned uploads off.
    const { result } = setup({
      canUpload: false,
      createdMsAgo: DWH_ACTIVATION_WINDOW_MS + HOUR_MS,
    });

    await waitFor(() => {
      expect(result.current.hasAttachedDwh).toBe(true);
    });
    expect(result.current.isAttachedDwhAwaitingActivation).toBe(false);
  });

  it("is not awaiting activation once storage is the upload target", async () => {
    const { result } = setup({ canUpload: true, createdMsAgo: 0 });

    await waitFor(() => {
      expect(result.current.hasAttachedDwh).toBe(true);
    });
    expect(result.current.isAttachedDwhAwaitingActivation).toBe(false);
  });

  it("reports no storage when the databases list has no attached DWH", async () => {
    const { result } = setup({ hasAttachedDwhDatabase: false });

    await waitFor(() => {
      expect(fetchMock.callHistory.called("path:/api/database")).toBe(true);
    });
    expect(result.current.hasAttachedDwh).toBe(false);
    expect(result.current.isAttachedDwhAwaitingActivation).toBe(false);
  });
});
