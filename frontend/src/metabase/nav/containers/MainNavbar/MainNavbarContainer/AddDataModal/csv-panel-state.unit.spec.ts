import {
  type CsvPanelState,
  type CsvPanelStateInput,
  getCsvPanelState,
} from "./csv-panel-state";

// A settled OSS instance where the user can upload, with no storage flags set.
const BASE: CsvPanelStateInput = {
  areDatabasesLoading: false,
  areUploadsEnabled: true,
  canUploadToDatabase: true,
  canManageUploads: false,
  isSettingUp: false,
  hasSetupFailed: false,
  isLoadingStorageAddOn: false,
  hasAttachedDwh: false,
  isAttachedDwhAwaitingActivation: false,
  canPurchaseStorage: false,
};

const state = (overrides: Partial<CsvPanelStateInput>): CsvPanelState =>
  getCsvPanelState({ ...BASE, ...overrides });

describe("getCsvPanelState", () => {
  it("waits for the databases list before committing to an answer", () => {
    // Every other input says "you cannot upload"; none of it is knowable yet.
    expect(
      state({
        areDatabasesLoading: true,
        areUploadsEnabled: false,
        canUploadToDatabase: false,
      }),
    ).toEqual({ type: "loading" });
  });

  it("lets the user upload once uploads are enabled and permitted", () => {
    expect(state({})).toEqual({ type: "ready" });
  });

  it("points a user without upload permission at their admin", () => {
    expect(state({ canUploadToDatabase: false })).toEqual({
      type: "no-upload-permission",
    });
  });

  it("points a user who cannot manage uploads at their admin", () => {
    expect(
      state({ areUploadsEnabled: false, canUploadToDatabase: false }),
    ).toEqual({ type: "ask-admin" });
  });

  it("offers storage alongside the CTA to an admin who could buy it", () => {
    expect(
      state({
        areUploadsEnabled: false,
        canUploadToDatabase: false,
        canManageUploads: true,
        canPurchaseStorage: true,
      }),
    ).toEqual({ type: "needs-uploads-setup", canOfferStorage: true });
  });

  it("does not offer a second copy of storage to an admin who owns it", () => {
    expect(
      state({
        areUploadsEnabled: false,
        canUploadToDatabase: false,
        canManageUploads: true,
        canPurchaseStorage: true,
        hasAttachedDwh: true,
      }),
    ).toEqual({ type: "needs-uploads-setup", canOfferStorage: false });
  });

  describe("storage setup", () => {
    it("shows provisioning ahead of any permission prompt", () => {
      // Mid-provisioning the flags briefly look like a permissions problem.
      expect(state({ isSettingUp: true, canUploadToDatabase: false })).toEqual({
        type: "provisioning-storage",
      });
    });

    it("shows the failure once setup passes its deadline", () => {
      expect(
        state({ hasSetupFailed: true, canUploadToDatabase: false }),
      ).toEqual({ type: "storage-setup-failed" });
    });

    it("explains the pending restart instead of a dead-end CTA", () => {
      // Storage isn't the upload target yet, and only the redeploy changes that.
      expect(
        state({
          areUploadsEnabled: false,
          canUploadToDatabase: false,
          canManageUploads: true,
          canPurchaseStorage: true,
          hasAttachedDwh: true,
          isAttachedDwhAwaitingActivation: true,
        }),
      ).toEqual({ type: "storage-awaiting-restart" });
    });

    it("does not claim a restart is pending once uploads point elsewhere", () => {
      // Only one database can be the upload target at a time.
      expect(
        state({
          areUploadsEnabled: true,
          canUploadToDatabase: true,
          hasAttachedDwh: true,
        }),
      ).toEqual({ type: "ready" });
    });

    it("offers the enable-uploads CTA once storage is too old to be awaiting a restart", () => {
      // Old storage with uploads off means an admin turned them off, so "wait
      // for a restart" would be a dead end.
      expect(
        state({
          areUploadsEnabled: false,
          canUploadToDatabase: false,
          canManageUploads: true,
          canPurchaseStorage: true,
          hasAttachedDwh: true,
          isAttachedDwhAwaitingActivation: false,
        }),
      ).toEqual({ type: "needs-uploads-setup", canOfferStorage: false });
    });

    it("points a user who cannot enable uploads at their admin instead", () => {
      expect(
        state({
          areUploadsEnabled: false,
          canUploadToDatabase: false,
          canManageUploads: false,
          hasAttachedDwh: true,
          isAttachedDwhAwaitingActivation: false,
        }),
      ).toEqual({ type: "ask-admin" });
    });

    it("keeps a working uploader while storage is still provisioning", () => {
      // Setup that never lands must not hide an upload target that works.
      expect(state({ isSettingUp: true })).toEqual({ type: "ready" });
    });

    it("keeps a working uploader after storage setup gives up", () => {
      expect(state({ hasSetupFailed: true })).toEqual({ type: "ready" });
    });

    it("waits for the add-on before offering to buy storage", () => {
      expect(
        state({
          areUploadsEnabled: false,
          canUploadToDatabase: false,
          canManageUploads: true,
          canPurchaseStorage: true,
          isLoadingStorageAddOn: true,
        }),
      ).toEqual({ type: "loading" });
    });
  });
});
