import { DevToolbar } from "embedding-sdk-package/data-app-dev/components/DevToolbar/DevToolbar";
import type {
  DataAppDiagnosticPayload,
  DataAppDiagnosticsReport,
} from "embedding-sdk-package/data-app-dev/diagnostics-channel";

const FEED = "**/__data-app/diagnostics*";

const root = () => cy.get("[data-cy-root]");
const dockedPanel = () => root().find("[role='tablist']").parent();

const entry = (
  over: Partial<DataAppDiagnosticPayload> = {},
): DataAppDiagnosticPayload => ({
  eventId: 1,
  time: Date.parse("2026-01-01T10:00:00Z"),
  kind: "error",
  summary: "boom",
  detail: null,
  hint: null,
  alert: true,
  ...over,
});

const report = (
  entries: DataAppDiagnosticPayload[],
  over: Partial<DataAppDiagnosticsReport> = {},
): DataAppDiagnosticsReport => ({
  entries,
  connection: null,
  manifest: null,
  clients: 1,
  lastReportAt: 1,
  lastRebuildAt: 1,
  nextEventId: (entries.at(-1)?.eventId ?? 0) + 1,
  session: "session-1",
  ...over,
});

/**
 * Serve a fixed buffer, filtered by `startEventId` exactly as the dev server
 * does, and clear it on DELETE. Modelling the real contract keeps the toolbar's
 * cursor/poll logic honestly exercised.
 */
function serveFeed(
  entries: DataAppDiagnosticPayload[],
  reportOver: Partial<DataAppDiagnosticsReport> = {},
) {
  const buffer = [...entries];

  cy.intercept("GET", FEED, (req) => {
    const start = Number(
      new URL(req.url, "http://localhost").searchParams.get("startEventId"),
    );
    const shown = Number.isFinite(start)
      ? buffer.filter((e) => e.eventId >= start)
      : buffer;
    req.reply(report(shown, reportOver));
  }).as("feed");

  cy.intercept("DELETE", FEED, (req) => {
    buffer.length = 0;
    req.reply({ statusCode: 204 });
  }).as("clear");
}

const getToggle = () => root().findByRole("button", { name: /Diagnostics/ });
const expand = () => {
  getToggle().click();
  root().findByRole("button", { name: "Expand" }).click();
};

describe("scenarios > data-apps > dev diagnostics toolbar", () => {
  describe("collapsed", () => {
    it("surfaces captured alerts in the badge and popover", () => {
      serveFeed([
        entry({ eventId: 1, kind: "error", summary: "TypeError: boom" }),
        // a successful query is not an alert, so it must not inflate the badge
        entry({
          eventId: 2,
          kind: "sdk-call",
          summary: "GET /api/card/1 => 200",
          alert: false,
        }),
      ]);

      cy.mount(<DevToolbar />);

      getToggle().should("contain.text", "⚠ Diagnostics (1)");
      getToggle().click();
      root().findByText("TypeError: boom").should("be.visible");
    });

    it("hides a stack behind a disclosure until it's expanded", () => {
      serveFeed([
        entry({
          eventId: 1,
          kind: "error",
          summary: "TypeError: nope",
          detail: "    at App (src/App.tsx:12:3)",
        }),
      ]);

      cy.mount(<DevToolbar />);
      getToggle().click();

      root().findByText("TypeError: nope").should("be.visible");
      // The stack is in the DOM but collapsed inside a <details>, DevTools-style.
      root()
        .findByText(/at App \(src\/App\.tsx:12:3\)/)
        .should("not.be.visible");
      root().findByText("TypeError: nope").click();
      root()
        .findByText(/at App \(src\/App\.tsx:12:3\)/)
        .should("be.visible");
    });

    it("says so, instead of looking healthy, when the dev server is unreachable", () => {
      cy.intercept("GET", FEED, { forceNetworkError: true }).as("feed");

      cy.mount(<DevToolbar />);
      getToggle().click();

      root()
        .findByText(/Can't reach the dev server/)
        .should("be.visible");
    });

    it("clears through the endpoint, emptying the panel", () => {
      serveFeed([entry({ eventId: 1, summary: "boom" })]);

      cy.mount(<DevToolbar />);
      getToggle().click();
      root().findByText("boom").should("be.visible");

      root().findByRole("button", { name: "Clear" }).click();

      cy.wait("@clear");
      root().findByText("boom").should("not.exist");
    });
  });

  describe("expanded (docked)", () => {
    it("shows all five tabs, Errors active, with each tab's empty state", () => {
      serveFeed([]);

      cy.mount(<DevToolbar />);
      expand();

      for (const label of [
        "Errors",
        "Blocked",
        "Queries",
        "Manifest",
        "Connection",
      ]) {
        root().findByRole("tab", { name: label }).should("be.visible");
      }
      root()
        .findByRole("tab", { name: "Errors" })
        .should("have.attr", "aria-selected", "true");
      root().findByText("No errors captured.").should("be.visible");

      root().findByRole("tab", { name: "Blocked" }).click();
      root().findByText("Nothing blocked.").should("be.visible");

      root().findByRole("tab", { name: "Queries" }).click();
      root().findByText("No Metabase calls captured.").should("be.visible");

      root().findByRole("tab", { name: "Manifest" }).click();
      root()
        .findByText("Manifest has not been validated yet.")
        .should("be.visible");

      root().findByRole("tab", { name: "Connection" }).click();
      root()
        .findByText("Connection check has not run yet.")
        .should("be.visible");
    });

    it("splits errors and blocked entries across their tabs, with the fix hint", () => {
      serveFeed([
        entry({ eventId: 1, kind: "error", summary: "plain error" }),
        entry({
          eventId: 2,
          kind: "blocked-network",
          summary: "Blocked fetch to api.example.com (not in allowed_hosts)",
          hint: "Add https://api.example.com to allowed_hosts in data_app.yaml (dev server restart required).",
        }),
      ]);

      cy.mount(<DevToolbar />);
      expand();

      root().findByText("plain error").should("be.visible");
      root()
        .findByText(/Blocked fetch to/)
        .should("not.exist");

      root().findByRole("tab", { name: "Blocked" }).click();
      root()
        .findByText(/Blocked fetch to api\.example\.com/)
        .should("be.visible");
      root()
        .findByText(/Add https:\/\/api\.example\.com to allowed_hosts/)
        .should("be.visible");
      root().findByText("plain error").should("not.exist");
    });

    it("lists Metabase calls and filters the Queries tab to failures", () => {
      serveFeed([
        entry({
          eventId: 1,
          kind: "sdk-call",
          summary: "POST /api/dataset => 400 (12ms)",
          alert: true,
        }),
        entry({
          eventId: 2,
          kind: "sdk-call",
          summary: "GET /api/card/1 => 200 (8ms)",
          alert: false,
        }),
      ]);

      cy.mount(<DevToolbar />);
      expand();
      root().findByRole("tab", { name: "Queries" }).click();

      root()
        .findByText(/Dev runs with an API key/)
        .should("be.visible");
      root()
        .findByText(/api\/card\/1/)
        .should("be.visible");

      root()
        .findByRole("checkbox", { name: /Failed only/ })
        .click();

      root()
        .findByText(/api\/dataset/)
        .should("be.visible");
      root()
        .findByText(/api\/card\/1/)
        .should("not.exist");
    });

    it("renders the manifest status the feed carries", () => {
      serveFeed([], {
        manifest: {
          checkedAt: 1,
          name: "Demo",
          bundlePath: "dist/index.js",
          bundlePathExists: false,
          allowedHosts: ["https://api.example.com"],
          errors: ["path is required"],
          warnings: ["bundle is large"],
          restartRequired: true,
        },
      });

      cy.mount(<DevToolbar />);
      expand();
      root().findByRole("tab", { name: "Manifest" }).click();

      // The tab is showing (top row visible); the rest is rendered further down
      // the scrollable panel body, so assert it exists rather than fighting the
      // 33vh scroll fold.
      root().findByText("path is required").should("be.visible");
      root().findByText("bundle is large").should("exist");
      root()
        .findByText(/allowed_hosts changed/)
        .should("exist");
      root().findByText("Demo").should("exist");
      root()
        .findByText(/file not found/)
        .should("exist");
      root().findByText("https://api.example.com").should("exist");
    });

    it("renders the connection status the feed carries", () => {
      serveFeed([], {
        connection: {
          checkedAt: 1,
          metabaseUrl: "http://localhost:3000",
          reachable: true,
          apiKeyValid: false,
          metabaseVersion: "v1.56.0",
          sdkVersion: "0.64.0",
          error: "The API key was rejected (401).",
        },
      });

      cy.mount(<DevToolbar />);
      expand();
      root().findByRole("tab", { name: "Connection" }).click();

      // Top row proves the tab is showing; the lower rows are rendered below the
      // scrollable panel's fold.
      root().findByText("http://localhost:3000").should("be.visible");
      root().findByText("✗ invalid").should("exist");
      root().findByText("v1.56.0").should("exist");
      root().findByText("The API key was rejected (401).").should("exist");
    });

    it("shows the unreachable banner inside the docked panel too", () => {
      cy.intercept("GET", FEED, { forceNetworkError: true }).as("feed");

      cy.mount(<DevToolbar />);
      // Expand straight away; the panel is docked before the first poll resolves.
      getToggle().click();
      root().findByRole("button", { name: "Expand" }).click();

      root()
        .findByText(/Can't reach the dev server/)
        .should("be.visible");
    });

    it("resizes between a third and half of the screen", () => {
      serveFeed([]);

      cy.mount(<DevToolbar />);
      expand();

      // Default docked height is a third; the button offers Half.
      let thirdHeight = 0;
      dockedPanel()
        .invoke("outerHeight")
        .then((h) => {
          thirdHeight = h ?? 0;
          expect(thirdHeight).to.be.greaterThan(0);
        });

      root().findByRole("button", { name: "Half" }).click();

      // Now taller, and the button offers to go back to a Third.
      dockedPanel()
        .invoke("outerHeight")
        .should((h) => {
          expect(h).to.be.greaterThan(thirdHeight);
        });
      root().findByRole("button", { name: "Third" }).should("be.visible");
    });

    it("collapses back to the popover, and Close dismisses it", () => {
      serveFeed([entry({ eventId: 1, kind: "error", summary: "boom" })]);

      cy.mount(<DevToolbar />);
      expand();
      root().findByRole("tab", { name: "Errors" }).should("be.visible");

      // Collapse => tabs gone, the corner popover is back.
      root().findByRole("button", { name: "Collapse" }).click();
      root().findByRole("tab", { name: "Errors" }).should("not.exist");
      root().findByText("boom").should("be.visible");

      // Close => the whole panel is dismissed, only the toggle remains.
      root().findByRole("button", { name: "Close" }).click();
      root().findByText("boom").should("not.exist");
      getToggle().should("be.visible");
    });
  });
});
