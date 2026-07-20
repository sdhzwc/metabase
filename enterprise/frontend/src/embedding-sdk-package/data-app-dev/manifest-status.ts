/**
 * The manifest-validation payload the dev plugin pushes to the harness page
 * over the Vite WS channel. Shared between the node-side validator
 * (`config/validate-manifest.ts`) and the browser-side diagnostics store, so
 * keep this module free of node imports.
 */

/** Custom HMR event carrying a {@link DataAppManifestStatus} payload. */
export const DATA_APP_MANIFEST_EVENT = "data-app:manifest";

export interface DataAppManifestStatus {
  checkedAt: number;
  /** `name` from `data_app.yaml`, when present and a string. */
  name: string | null;
  /** `path` from `data_app.yaml`, when present and a string. */
  bundlePath: string | null;
  /** Whether the file `path` points at exists (missing → "run npm run build"). */
  bundlePathExists: boolean;
  allowedHosts: string[];
  /** Sync-parity failures: this manifest would be rejected on remote-sync import. */
  errors: string[];
  warnings: string[];
  /**
   * The manifest's `allowed_hosts` no longer match what the dev server started
   * with — the sandbox allowlist and CSP only pick the change up on restart.
   */
  restartRequired: boolean;
}
