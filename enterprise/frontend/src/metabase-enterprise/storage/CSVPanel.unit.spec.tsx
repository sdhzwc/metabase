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
import { CSVPanel } from "metabase/nav/containers/MainNavbar/MainNavbarContainer/AddDataModal/Panels/CSVPanel";
import { createMockState } from "metabase/redux/store/mocks";
import type { ICloudAddOnProduct, TokenFeatures } from "metabase-types/api";
import {
  createMockDatabase,
  createMockSettings,
  createMockTokenFeatures,
  createMockUser,
} from "metabase-types/api/mocks";
import { mockStorageCloudAddOn } from "metabase-types/api/mocks/add-ons";

import { StorageSetupProvider } from "./StorageSetupProvider";
import { STORAGE_SETUP_TIMEOUT_MS } from "./use-purchase-storage-add-on";

/**
 * The panel derives its own state, so these cases cover the whole chain —
 * databases list and storage context through `useCsvPanelState` to the view —
 * rather than a hand-built state value.
 */
interface SetupOpts {
  addOns?: ICloudAddOnProduct[];
  tokenFeatures?: Partial<TokenFeatures>;
  hasAttachedDwhDatabase?: boolean;
  /** False before the redeploy that makes storage the upload target. */
  dwhCanUpload?: boolean;
  /** Adds an ordinary database that is the instance's upload target. */
  uploadsEnabled?: boolean;
  /** Whether the current user may upload to that database. */
  canUpload?: boolean;
}

const setup = ({
  addOns = [mockStorageCloudAddOn],
  tokenFeatures = {},
  hasAttachedDwhDatabase = false,
  dwhCanUpload = true,
  uploadsEnabled = false,
  canUpload = false,
}: SetupOpts = {}) => {
  const renderPanel = (mounted: boolean) =>
    mounted ? <CSVPanel onCloseAddDataModal={jest.fn()} /> : null;

  const settingValues = {
    "is-hosted?": true,
    "store-url": "https://store.metabase.com",
    "token-features": createMockTokenFeatures(tokenFeatures),
  };

  setupPropertiesEndpoints(createMockSettings(settingValues));
  setupDatabaseListEndpoint([
    ...(hasAttachedDwhDatabase
      ? [
          createMockDatabase({
            id: 1,
            can_upload: dwhCanUpload,
            is_attached_dwh: true,
          }),
        ]
      : []),
    ...(uploadsEnabled
      ? [
          createMockDatabase({
            id: 2,
            uploads_enabled: true,
            can_upload: canUpload,
          }),
        ]
      : []),
  ]);
  fetchMock.get("path:/api/ee/cloud-add-ons/addons", addOns);
  fetchMock.post("path:/api/ee/cloud-add-ons/dwh-rent", 200);
  fetchMock.post("path:/api/premium-features/token/refresh", {});

  const { rerender } = renderWithProviders(
    <StorageSetupProvider>{renderPanel(true)}</StorageSetupProvider>,
    {
      storeInitialState: createMockState({
        currentUser: createMockUser({ is_superuser: true }),
        settings: mockSettings(settingValues),
      }),
    },
  );

  const remount = (mounted: boolean) =>
    rerender(
      <StorageSetupProvider>{renderPanel(mounted)}</StorageSetupProvider>,
    );

  return { remount };
};

const openPurchaseModal = async () => {
  await userEvent.click(
    await screen.findByRole("button", { name: /Add Metabase Storage/ }),
  );

  return await screen.findByRole("dialog", { name: "Add Metabase Storage" });
};

const confirmPurchase = async () => {
  const modal = await openPurchaseModal();
  await userEvent.click(
    within(modal).getByRole("button", { name: "Add Metabase Storage" }),
  );
};

describe("CSVPanel storage purchase", () => {
  it("offers to add storage next to the enable uploads CTA", async () => {
    setup();

    // A plain loader shows while the add-on availability is being fetched.
    expect(screen.getByTestId("loading-indicator")).toBeInTheDocument();

    expect(
      await screen.findByRole("button", { name: /Add Metabase Storage/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("loading-indicator")).not.toBeInTheDocument();
    expect(screen.getByText("Enable uploads")).toBeInTheDocument();
    expect(
      screen.getByText(/either enable file uploads in/),
    ).toBeInTheDocument();
    expect(screen.getByText(/, or add Metabase Storage\./)).toBeInTheDocument();
  });

  it("falls back to a store link when no purchasable add-on is available", async () => {
    setup({ addOns: [] });

    expect(await screen.findByText("Enable uploads")).toBeInTheDocument();
    // Storage is still offered, but as a link out to the store rather than the
    // in-app purchase modal.
    const storeLink = await screen.findByRole("link", {
      name: /Add Metabase Storage/,
    });
    expect(storeLink).toHaveAttribute(
      "href",
      expect.stringContaining("/account/storage"),
    );
    expect(screen.getByText(/, or add Metabase Storage\./)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add Metabase Storage/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the setting-up view instead of the obtain-permission prompt while provisioning", async () => {
    // Mid-provisioning the token feature and `uploads-settings` flip before the
    // DWH database accepts uploads, so `uploadsEnabled` is true while
    // `canUpload` is still false. The purchasing admin must see the setup view,
    // not a "contact your administrator" prompt.
    setup({
      tokenFeatures: { attached_dwh: true },
      hasAttachedDwhDatabase: false,
      uploadsEnabled: true,
      canUpload: false,
    });

    expect(await screen.findByText("Setting up storage")).toBeInTheDocument();
    expect(
      screen.queryByText(/You are not permitted to upload CSV files/),
    ).not.toBeInTheDocument();
  });

  it("shows the obtain-permission prompt when uploads are enabled but the user cannot upload", async () => {
    // Uploads are configured, but this user lacks upload permission and no
    // provisioning is underway, so they get pointed at their administrator.
    setup({ uploadsEnabled: true, canUpload: false });

    expect(
      await screen.findByText(/You are not permitted to upload CSV files/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Enable uploads")).not.toBeInTheDocument();
    expect(screen.queryByText("Setting up storage")).not.toBeInTheDocument();
  });

  it("does not offer to buy storage to an admin who already has it", async () => {
    // Storage is provisioned but uploads are pointed elsewhere, so the enable
    // uploads CTA still shows — it must not come with an offer to buy a second
    // copy of something this instance already owns.
    setup({
      tokenFeatures: { attached_dwh: true },
      hasAttachedDwhDatabase: true,
      dwhCanUpload: false,
      uploadsEnabled: true,
      canUpload: false,
    });

    expect(
      await screen.findByText(/You are not permitted to upload CSV files/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add Metabase Storage/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Add Metabase Storage/ }),
    ).not.toBeInTheDocument();
  });

  it("explains that the instance must restart before storage accepts uploads", async () => {
    // Post-provisioning, pre-redeploy: storage exists but is not yet the upload
    // target. "Enable uploads" would be a dead end — only a redeploy helps.
    setup({
      tokenFeatures: { attached_dwh: true },
      hasAttachedDwhDatabase: true,
      dwhCanUpload: false,
      uploadsEnabled: false,
    });

    expect(
      await screen.findByText(
        /Uploads will turn on the next time your instance restarts/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Enable uploads")).not.toBeInTheDocument();
    expect(screen.queryByText("Setting up storage")).not.toBeInTheDocument();
  });

  it("offers a way out when setup exceeds its deadline", async () => {
    jest.useFakeTimers();

    try {
      setup({ tokenFeatures: { attached_dwh: true } });

      expect(await screen.findByText("Setting up storage")).toBeInTheDocument();

      await act(async () => {
        jest.advanceTimersByTime(STORAGE_SETUP_TIMEOUT_MS);
      });

      expect(
        screen.getByText("Storage setup didn't finish"),
      ).toBeInTheDocument();
      expect(screen.queryByText("Setting up storage")).not.toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Go to your account" }),
      ).toHaveAttribute("href", expect.stringContaining("/account/storage"));
    } finally {
      jest.useRealTimers();
    }
  });

  it("shows the confirmation modal with the pricing terms", async () => {
    setup();

    const modal = await openPurchaseModal();

    expect(
      within(modal).getByText(
        /Get secure, fully managed data storage where you can upload your CSVs and sync data from Google Sheets\./,
      ),
    ).toBeInTheDocument();
    // Numbers are derived from the add-on product: 1M included rows,
    // $0.000002 per row => $2 per additional 1M rows.
    expect(
      within(modal).getByText(
        /You will not be charged until you reach 1M stored rows, after which it's \$2\/mo\. for each additional 1M rows\./,
      ),
    ).toBeInTheDocument();
  });

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

  it("shows the in-panel setting-up view after confirming the purchase", async () => {
    setup();

    await confirmPurchase();

    expect(await screen.findByText("Setting up storage")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        fetchMock.callHistory.called("path:/api/ee/cloud-add-ons/dwh-rent", {
          method: "POST",
        }),
      ).toBe(true);
    });
  });

  it("keeps the setting-up state when the panel is unmounted and remounted", async () => {
    const { remount } = setup();

    await confirmPurchase();
    expect(await screen.findByText("Setting up storage")).toBeInTheDocument();

    // Simulate closing the Add data modal (panel content unmounts) and reopening
    // it. The provider lives above the modal, so the setting-up state survives.
    remount(false);
    expect(screen.queryByText("Setting up storage")).not.toBeInTheDocument();

    remount(true);
    expect(await screen.findByText("Setting up storage")).toBeInTheDocument();
  });
});
