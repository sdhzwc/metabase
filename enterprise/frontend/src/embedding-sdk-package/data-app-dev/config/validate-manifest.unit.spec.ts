import fs from "node:fs";
import path from "node:path";

import { validateDataAppManifest } from "./validate-manifest";

jest.mock("node:fs");

const mockedFs = jest.mocked(fs);

const APP_ROOT = "/repo/data_apps/sales";
const YAML_PATH = path.join(APP_ROOT, "data_app.yaml");

const VALID_YAML = `
name: Sales dashboard
path: dist/index.js
`;

const setup = (files: Record<string, string | true>) => {
  mockedFs.existsSync.mockImplementation((p) => p.toString() in files);
  mockedFs.readFileSync.mockImplementation((p) => {
    const content = files[p.toString()];

    if (typeof content !== "string") {
      throw new Error(`unexpected read: ${p}`);
    }

    return content;
  });
};

afterEach(() => jest.resetAllMocks());

describe("validateDataAppManifest", () => {
  it("errors when the manifest is missing (the app would silently not sync)", () => {
    setup({});

    const status = validateDataAppManifest(APP_ROOT, []);

    expect(status.errors).toEqual([
      "No data_app.yaml found — this app will not sync.",
    ]);
  });

  it("accepts a valid manifest whose bundle exists", () => {
    setup({
      [YAML_PATH]: VALID_YAML,
      [path.join(APP_ROOT, "dist/index.js")]: true,
    });

    const status = validateDataAppManifest(APP_ROOT, []);

    expect(status).toMatchObject({
      name: "Sales dashboard",
      bundlePath: "dist/index.js",
      bundlePathExists: true,
      allowedHosts: [],
      errors: [],
      warnings: [],
      restartRequired: false,
    });
  });

  it("reports an unparseable yaml", () => {
    setup({ [YAML_PATH]: "name: [unclosed" });

    const status = validateDataAppManifest(APP_ROOT, []);

    expect(status.errors).toHaveLength(1);
    expect(status.errors[0]).toContain("Could not parse data_app.yaml");
  });

  it("requires name and path", () => {
    setup({ [YAML_PATH]: "allowed_hosts: []\n" });

    const status = validateDataAppManifest(APP_ROOT, []);

    expect(status.errors).toEqual([
      'data_app.yaml: "name" is required.',
      'data_app.yaml: "path" is required.',
    ]);
  });

  it("rejects path traversal", () => {
    setup({ [YAML_PATH]: "name: X\npath: ../../etc/passwd\n" });

    const status = validateDataAppManifest(APP_ROOT, []);

    expect(status.errors).toEqual([
      'data_app.yaml: "path" must not contain "..".',
    ]);
  });

  it("warns when the bundle file does not exist yet", () => {
    setup({ [YAML_PATH]: VALID_YAML });

    const status = validateDataAppManifest(APP_ROOT, []);

    expect(status.errors).toEqual([]);
    expect(status.warnings).toEqual([
      '"dist/index.js" does not exist — run `npm run build` before committing, or sync will fail.',
    ]);
  });

  it("rejects an invalid directory slug", () => {
    setup({
      [path.join("/repo/data_apps/Sales_App", "data_app.yaml")]: VALID_YAML,
      [path.join("/repo/data_apps/Sales_App", "dist/index.js")]: true,
    });

    const status = validateDataAppManifest("/repo/data_apps/Sales_App", []);

    expect(status.errors).toEqual([
      `The app directory's name ("Sales_App") is its slug, so it must be lowercase letters, numbers, and dashes.`,
    ]);
  });

  it("rejects a reserved slug", () => {
    setup({
      [path.join("/repo/data_apps/repo-status", "data_app.yaml")]: VALID_YAML,
      [path.join("/repo/data_apps/repo-status", "dist/index.js")]: true,
    });

    const status = validateDataAppManifest("/repo/data_apps/repo-status", []);

    expect(status.errors).toEqual([
      '"repo-status" is a reserved slug — rename the directory.',
    ]);
  });

  it("validates allowed_hosts entries as origins (sync parity)", () => {
    setup({
      [YAML_PATH]: `${VALID_YAML}allowed_hosts:\n  - https://api.example.com\n  - https://api.example.com/v1\n  - ftp://files.example.com\n`,
      [path.join(APP_ROOT, "dist/index.js")]: true,
    });

    const status = validateDataAppManifest(APP_ROOT, [
      "https://api.example.com",
    ]);

    expect(status.allowedHosts).toEqual(["https://api.example.com"]);
    expect(status.errors).toEqual([
      '"https://api.example.com/v1" is not a valid allowed_hosts entry — use an origin like https://api.example.com or https://*.example.com.',
      '"ftp://files.example.com" is not a valid allowed_hosts entry — use an origin like https://api.example.com or https://*.example.com.',
    ]);
    expect(status.restartRequired).toBe(false);
  });

  it("rejects a non-list allowed_hosts", () => {
    setup({
      [YAML_PATH]: `${VALID_YAML}allowed_hosts: https://api.example.com\n`,
      [path.join(APP_ROOT, "dist/index.js")]: true,
    });

    expect(validateDataAppManifest(APP_ROOT, []).errors).toEqual([
      'data_app.yaml: "allowed_hosts" must be a list.',
    ]);
  });

  it("flags a restart when allowed_hosts drift from what the server booted with", () => {
    setup({
      [YAML_PATH]: `${VALID_YAML}allowed_hosts:\n  - https://api.example.com\n`,
      [path.join(APP_ROOT, "dist/index.js")]: true,
    });

    const status = validateDataAppManifest(APP_ROOT, []);

    expect(status.errors).toEqual([]);
    expect(status.restartRequired).toBe(true);
  });

  it("does not demand a restart for a padded or reordered allowed_hosts list", () => {
    // The startup list is the raw YAML; the validated list is normalized. Comparing
    // them naively reported a restart that restarting could never satisfy.
    setup({
      [YAML_PATH]: `
name: Sales dashboard
path: dist/index.js
allowed_hosts:
  - "  https://B.example.com  "
  - https://a.example.com
`,
    });

    const status = validateDataAppManifest(APP_ROOT, [
      "https://a.example.com",
      "  https://B.example.com  ",
    ]);

    expect(status.restartRequired).toBe(false);
  });

  it("accepts a non-string scalar the backend would stringify", () => {
    // `(some-> v str str/trim not-empty)` imports `name: 2024` as "2024".
    setup({
      [YAML_PATH]: `
name: 2024
path: dist/index.js
`,
    });

    const status = validateDataAppManifest(APP_ROOT, []);

    expect(status.name).toBe("2024");
    expect(status.errors).toEqual([]);
  });

  it("rejects an allowed_hosts entry remote-sync would reject", () => {
    setup({
      [YAML_PATH]: `
name: Sales dashboard
path: dist/index.js
allowed_hosts:
  - https://internal_api.acme.com
`,
    });

    const status = validateDataAppManifest(APP_ROOT, []);

    expect(status.errors).toHaveLength(1);
    expect(status.errors[0]).toContain("internal_api.acme.com");
  });
});
