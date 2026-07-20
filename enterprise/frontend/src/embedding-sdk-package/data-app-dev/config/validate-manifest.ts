// Live sync-parity validation of `data_app.yaml` for the dev toolbar's Manifest
// tab. Mirrors the backend's `parse-app-config` (`data_apps/config.clj`): every
// `errors` entry here is a manifest remote-sync would reject with a 400 — so the
// developer finds out while editing, not after pushing. Node-side: run by the
// dev plugin at startup and whenever the manifest changes.

import fs from "node:fs";
import path from "node:path";

import { load as parseYaml } from "js-yaml";

// The sandbox's own origin matcher, so "valid entry" here can't drift from what
// the sandbox will actually allow; pure code, bundled as a value (cf. plugin.ts).
// eslint-disable-next-line metabase/no-external-references-for-sdk-package-code
import { isValidAllowedHostEntry } from "metabase-enterprise/data_apps/sandbox/allowed-hosts";

import type { DataAppManifestStatus } from "../manifest-status";

const CONFIG_FILE_NAME = "data_app.yaml";

// Keep in sync with the backend's `slug-pattern` / `reserved-slugs`.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_SLUGS = new Set(["repo-status"]);

const asTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizePath = (value: string): string => value.replace(/^\.\//, "");

const hasPathTraversal = (value: string): boolean =>
  value.split("/").includes("..");

const sameHosts = (left: string[], right: string[]): boolean =>
  left.length === right.length &&
  left.every((entry, index) => entry === right[index]);

/**
 * Validate the app's manifest against the same rules remote-sync applies.
 * `startupAllowedHosts` is the list the dev server booted with — when the
 * manifest drifts from it, the sandbox allowlist and CSP are stale until
 * restart, which the status flags via `restartRequired`.
 */
export function validateDataAppManifest(
  appRoot: string,
  startupAllowedHosts: string[],
): DataAppManifestStatus {
  const status: DataAppManifestStatus = {
    checkedAt: Date.now(),
    name: null,
    bundlePath: null,
    bundlePathExists: false,
    allowedHosts: [],
    errors: [],
    warnings: [],
    restartRequired: false,
  };

  const slug = path.basename(appRoot);
  if (!SLUG_PATTERN.test(slug)) {
    status.errors.push(
      `The app directory's name ("${slug}") is its slug, so it must be lowercase letters, numbers, and dashes.`,
    );
  } else if (RESERVED_SLUGS.has(slug)) {
    status.errors.push(`"${slug}" is a reserved slug — rename the directory.`);
  }

  const manifestPath = path.join(appRoot, CONFIG_FILE_NAME);
  if (!fs.existsSync(manifestPath)) {
    status.errors.push(
      `No ${CONFIG_FILE_NAME} found — this app will not sync.`,
    );
    return status;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    status.errors.push(
      `Could not parse ${CONFIG_FILE_NAME}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return status;
  }

  const manifestValue = (key: string): unknown =>
    typeof parsed === "object" && parsed !== null
      ? Reflect.get(parsed, key)
      : undefined;

  status.name = asTrimmedString(manifestValue("name"));
  if (status.name == null) {
    status.errors.push(`${CONFIG_FILE_NAME}: "name" is required.`);
  }

  const bundlePath = asTrimmedString(manifestValue("path"));
  if (bundlePath == null) {
    status.errors.push(`${CONFIG_FILE_NAME}: "path" is required.`);
  } else {
    status.bundlePath = normalizePath(bundlePath);
    if (hasPathTraversal(status.bundlePath)) {
      status.errors.push(`${CONFIG_FILE_NAME}: "path" must not contain "..".`);
    } else {
      status.bundlePathExists = fs.existsSync(
        path.join(appRoot, status.bundlePath),
      );
      if (!status.bundlePathExists) {
        status.warnings.push(
          `"${status.bundlePath}" does not exist — run \`npm run build\` before committing, or sync will fail.`,
        );
      }
    }
  }

  const rawHosts = manifestValue("allowed_hosts");
  if (rawHosts != null && !Array.isArray(rawHosts)) {
    status.errors.push(`${CONFIG_FILE_NAME}: "allowed_hosts" must be a list.`);
  } else if (Array.isArray(rawHosts)) {
    for (const entry of rawHosts) {
      const host = asTrimmedString(entry);
      if (host == null || !isValidAllowedHostEntry(host)) {
        status.errors.push(
          `"${String(entry)}" is not a valid allowed_hosts entry — use an origin like https://api.example.com or https://*.example.com.`,
        );
      } else {
        status.allowedHosts.push(host);
      }
    }
  }

  status.restartRequired = !sameHosts(status.allowedHosts, startupAllowedHosts);

  return status;
}
