import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import {
  setupDatabaseListEndpoint,
  setupPropertiesEndpoints,
} from "__support__/server-mocks";
import { mockSettings } from "__support__/settings";
import {
  act,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "__support__/ui";
import { UndoListing } from "metabase/common/components/UndoListing";
import { useStorageSetup } from "metabase/common/components/upsells/StoragePurchaseModal";
import { createMockState } from "metabase/redux/store/mocks";
import type { ICloudAddOnProduct, TokenFeatures } from "metabase-types/api";
import {
  createMockDatabase,
  createMockSettings,
  createMockTokenFeatures,
  createMockTokenStatus,
  createMockUser,
} from "metabase-types/api/mocks";
import { mockStorageCloudAddOn } from "metabase-types/api/mocks/add-ons";

import { StorageSetupProvider } from "./StorageSetupProvider";
import { STORAGE_SETUP_TIMEOUT_MS } from "./use-purchase-storage-add-on";

const TestConsumer = () => {
  const { isSettingUp, hasSetupFailed, openPurchaseModal } = useStorageSetup();

  return (
    <div>
      <button onClick={openPurchaseModal}>Open purchase modal</button>
      {isSettingUp && <span>setting up</span>}
      {hasSetupFailed && <span>setup failed</span>}
    </div>
  );
};

interface SetupOpts {
  tokenFeatures?: Partial<TokenFeatures>;
  hasAttachedDwhDatabase?: boolean;
  /** False when the admin pointed uploads at some other database. */
  dwhCanUpload?: boolean;
  isHosted?: boolean;
  addOns?: ICloudAddOnProduct[];
}

const setup = ({
  tokenFeatures = {},
  hasAttachedDwhDatabase = false,
  dwhCanUpload = true,
  isHosted = true,
  addOns = [mockStorageCloudAddOn],
}: SetupOpts = {}) => {
  const settingValues = {
    "is-hosted?": isHosted,
    "token-features": createMockTokenFeatures(tokenFeatures),
    "uploads-settings": {
      db_id: hasAttachedDwhDatabase ? 1 : null,
      schema_name: null,
      table_prefix: null,
    },
  };

  setupPropertiesEndpoints(
    createMockSettings({
      ...settingValues,
      "token-status": createMockTokenStatus({
        features: tokenFeatures.attached_dwh ? ["attached-dwh"] : [],
      }),
    }),
  );
  // Provisioning is finished once the Cloud Storage database (marked
  // `is_attached_dwh`) surfaces in the databases list. Whether it currently
  // accepts uploads is a separate question — only one database at a time can be
  // the upload target — and must not feed back into the setting-up state.
  setupDatabaseListEndpoint(
    hasAttachedDwhDatabase
      ? [
          createMockDatabase({
            id: 1,
            can_upload: dwhCanUpload,
            is_attached_dwh: true,
          }),
        ]
      : [],
  );
  fetchMock.get("path:/api/ee/cloud-add-ons/addons", addOns);
  fetchMock.post("path:/api/ee/cloud-add-ons/dwh-rent", 200);
  fetchMock.post(
    "path:/api/premium-features/token/refresh",
    createMockTokenStatus(),
  );

  renderWithProviders(
    <StorageSetupProvider>
      <TestConsumer />
      <UndoListing />
    </StorageSetupProvider>,
    {
      storeInitialState: createMockState({
        currentUser: createMockUser({ is_superuser: true }),
        settings: mockSettings(settingValues),
      }),
    },
  );
};

const openPurchaseModal = async () => {
  await userEvent.click(
    screen.getByRole("button", { name: "Open purchase modal" }),
  );
  return screen.findByRole("dialog", { name: "Add Metabase Storage" });
};

const purchaseStorage = async () => {
  const modal = await openPurchaseModal();
  await userEvent.click(
    within(modal).getByRole("button", { name: "Add Metabase Storage" }),
  );
};

describe("StorageSetupProvider", () => {
  it("purchases the add-on on confirm and enters the setting-up state", async () => {
    setup();

    await purchaseStorage();

    expect(await screen.findByText("setting up")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        fetchMock.callHistory.called("path:/api/ee/cloud-add-ons/dwh-rent", {
          method: "POST",
        }),
      ).toBe(true);
    });
  });

  it("reloads the databases list while setting up", async () => {
    setup();

    await purchaseStorage();

    expect(await screen.findByText("setting up")).toBeInTheDocument();

    // The hook polls the databases list (in addition to settings) so the
    // surrounding panels can react without a page reload.
    await waitFor(
      () => {
        expect(
          fetchMock.callHistory.calls("path:/api/database").length,
        ).toBeGreaterThan(1);
      },
      { timeout: 4000 },
    );
  });

  it("stays in the setting-up state while the attached DWH database is missing, even when the token feature flipped", async () => {
    setup({ tokenFeatures: { attached_dwh: true } });

    await purchaseStorage();

    expect(await screen.findByText("setting up")).toBeInTheDocument();
    expect(
      screen.queryByText("Metabase Storage is ready"),
    ).not.toBeInTheDocument();
  });

  it("leaves the setting-up state once the attached DWH database is available", async () => {
    setup({
      tokenFeatures: { attached_dwh: true },
      hasAttachedDwhDatabase: true,
    });

    await purchaseStorage();

    // Once storage is ready the provider resets back to `initial`, so the
    // setting-up flag clears and hosting panels reveal their default view.
    await waitFor(() => {
      expect(screen.queryByText("setting up")).not.toBeInTheDocument();
    });
    expect(
      await screen.findByText("Metabase Storage is ready"),
    ).toBeInTheDocument();
  });

  it("gives up on setup once it exceeds its deadline", async () => {
    jest.useFakeTimers();

    try {
      setup({ tokenFeatures: { attached_dwh: true } });

      expect(await screen.findByText("setting up")).toBeInTheDocument();

      await act(async () => {
        jest.advanceTimersByTime(STORAGE_SETUP_TIMEOUT_MS);
      });

      expect(screen.getByText("setup failed")).toBeInTheDocument();
      expect(screen.queryByText("setting up")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Metabase Storage is ready"),
      ).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("leaves the setting-up state when storage exists but uploads point at another database", async () => {
    // Only one database can be the upload target, so an admin enabling uploads
    // elsewhere clears `can_upload` on the storage database. That must not read
    // as "still provisioning" — it used to spin forever.
    setup({
      tokenFeatures: { attached_dwh: true },
      hasAttachedDwhDatabase: true,
      dwhCanUpload: false,
    });

    await waitFor(() => {
      expect(fetchMock.callHistory.called("path:/api/database")).toBe(true);
    });

    expect(screen.queryByText("setting up")).not.toBeInTheDocument();
  });

  it("does not flash the setting-up state or toast on load for an instance that already has storage", async () => {
    // Existing storage admin loading the app, no purchase. The token feature is
    // synchronous while the databases list is async, so setting-up must not
    // flash on while the list is still loading.
    setup({
      tokenFeatures: { attached_dwh: true },
      hasAttachedDwhDatabase: true,
    });

    // Wait for the databases list to resolve — the transition that used to flip
    // setting-up false → true → false.
    await waitFor(() => {
      expect(fetchMock.callHistory.called("path:/api/database")).toBe(true);
    });

    expect(screen.queryByText("setting up")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Metabase Storage is ready"),
    ).not.toBeInTheDocument();
  });

  describe("purchase confirmation modal", () => {
    it("does not purchase when the confirmation modal is cancelled", async () => {
      setup();

      const modal = await openPurchaseModal();

      await userEvent.click(
        within(modal).getByRole("button", { name: "Cancel" }),
      );
      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", { name: "Add Metabase Storage" }),
        ).not.toBeInTheDocument();
      });
      expect(
        fetchMock.callHistory.called("path:/api/ee/cloud-add-ons/dwh-rent"),
      ).toBe(false);
    });

    it("does not render the confirmation modal without a purchasable add-on", async () => {
      setup({ isHosted: false, addOns: [] });

      await userEvent.click(
        screen.getByRole("button", { name: "Open purchase modal" }),
      );

      expect(
        screen.queryByRole("dialog", { name: "Add Metabase Storage" }),
      ).not.toBeInTheDocument();
    });
  });
});
