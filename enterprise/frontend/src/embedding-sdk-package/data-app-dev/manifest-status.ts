/**
 * The manifest-validation payload. Produced by the node-side validator
 * (`config/validate-manifest.ts`), served on the diagnostics feed, and rendered
 * by the toolbar's Manifest tab — so keep this module free of node imports.
 */

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
