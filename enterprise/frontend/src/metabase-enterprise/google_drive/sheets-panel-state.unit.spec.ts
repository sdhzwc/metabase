import {
  type SheetsPanelState,
  type SheetsPanelStateInput,
  getSheetsPanelState,
} from "./sheets-panel-state";

// A hosted admin with storage, nothing connected yet — the point where the
// status alone decides what the panel shows.
const BASE: SheetsPanelStateInput = {
  isSettingUp: false,
  hasSetupFailed: false,
  isAdmin: true,
  hasAttachedDwh: true,
  showGdrive: true,
  areConnectionDetailsShown: false,
  status: "not-connected",
};

const state = (overrides: Partial<SheetsPanelStateInput>): SheetsPanelState =>
  getSheetsPanelState({ ...BASE, ...overrides });

describe("getSheetsPanelState", () => {
  describe("gating, in precedence order", () => {
    it("shows provisioning ahead of every other gate", () => {
      // Mid-provisioning storage is absent, which on its own reads as
      // "buy storage" — the wrong thing to show someone already buying it.
      expect(
        state({ isSettingUp: true, hasAttachedDwh: false, isAdmin: false }),
      ).toBe("provisioning-storage");
    });

    it("shows the setup failure ahead of the remaining gates", () => {
      expect(
        state({ hasSetupFailed: true, hasAttachedDwh: false, isAdmin: false }),
      ).toBe("storage-setup-failed");
    });

    it("points a non-admin at their admin rather than at the store", () => {
      // A non-admin cannot buy storage, so the missing-storage case must not
      // win over the missing-permission one.
      expect(state({ isAdmin: false, hasAttachedDwh: false })).toBe(
        "ask-admin",
      );
    });

    it("offers storage to an admin who has none", () => {
      expect(state({ hasAttachedDwh: false })).toBe("needs-storage");
    });

    it("falls back to the generic error when Sheets is unavailable for some other reason", () => {
      // An admin with storage, but `useShowGdrive` is false — there is nothing
      // specific we can tell them.
      expect(state({ showGdrive: false })).toBe("unavailable");
    });

    it("prefers the connection details over anything the status would show", () => {
      expect(state({ areConnectionDetailsShown: true, status: "active" })).toBe(
        "connection-details",
      );
    });

    it("does not show connection details to an admin without storage", () => {
      expect(
        state({ areConnectionDetailsShown: true, hasAttachedDwh: false }),
      ).toBe("needs-storage");
    });
  });

  describe("connection status, once every gate is passed", () => {
    it.each([
      { status: "active", expected: "connected" },
      // Syncing is still a working connection, so it shares the connected view.
      { status: "syncing", expected: "connected" },
      { status: "paused", expected: "storage-full" },
      { status: "not-connected", expected: "not-connected" },
      { status: "initializing", expected: "connecting" },
      { status: "error", expected: "connection-error" },
    ] as const)("maps $status to $expected", ({ status, expected }) => {
      expect(state({ status })).toBe(expected);
    });
  });
});
