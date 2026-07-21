export interface DataAppManifestStatus {
  checkedAt: number;
  name: string | null;
  bundlePath: string | null;
  bundlePathExists: boolean;
  allowedHosts: string[];
  errors: string[];
  warnings: string[];
  /** `allowed_hosts` drifted from boot; the sandbox and CSP update on restart. */
  restartRequired: boolean;
}
