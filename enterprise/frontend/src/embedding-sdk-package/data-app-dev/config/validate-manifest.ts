import fs from "node:fs";
import path from "node:path";

import { load as parseYaml } from "js-yaml";

// A namespace import stays single-line so the disable covers the reported line.
// eslint-disable-next-line metabase/no-external-references-for-sdk-package-code
import * as sandboxAllowedHosts from "metabase-enterprise/data_apps/sandbox/allowed-hosts";

import type { DataAppManifestStatus } from "../types/manifest-status";

const { isValidAllowedHostEntry, normalizeAllowedHostEntry } =
  sandboxAllowedHosts;

const CONFIG_FILE_NAME = "data_app.yaml";

// Keep in sync with the backend's `slug-pattern` / `reserved-slugs`.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_SLUGS = new Set(["repo-status"]);

// The backend stringifies, so `name: 2024` imports fine as "2024". Coerce the
// same way rather than reporting an error the sync wouldn't raise.
const asTrimmedString = (value: unknown): string | null => {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return null;
  }

  const trimmed = String(value).trim();

  return trimmed.length > 0 ? trimmed : null;
};

const normalizePath = (value: string): string => value.replace(/^\.\//, "");

const hasPathTraversal = (value: string): boolean =>
  value.split("/").includes("..");

// Normalized and sorted before comparing: the startup list is raw YAML, so a
// padded or reordered entry would otherwise demand a restart that changes nothing
// — permanently, since restarting can't make the two match.
const sameHosts = (left: string[], right: string[]): boolean => {
  const normalize = (hosts: string[]) =>
    hosts
      .filter((entry) => typeof entry === "string")
      .map(normalizeAllowedHostEntry)
      .filter(isValidAllowedHostEntry)
      .sort();

  const [a, b] = [normalize(left), normalize(right)];

  return a.length === b.length && a.every((entry, index) => entry === b[index]);
};

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
        status.allowedHosts.push(normalizeAllowedHostEntry(host));
      }
    }
  }

  status.restartRequired = !sameHosts(status.allowedHosts, startupAllowedHosts);

  return status;
}
