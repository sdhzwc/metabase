interface ImportMetaEnv {
  readonly DATA_APP_MB_URL: string;
  readonly DATA_APP_MB_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  readonly hot?: {
    on(event: string, cb: (...args: unknown[]) => void): void;
    send(event: string, data?: unknown): void;
  };
}

declare module "virtual:metabase-data-app-dev-config" {
  export const allowedHosts: string[];
  export const appSlug: string;
  export const bundleUrl: string;
  export const rebuiltEvent: string;
  export const sdkVersion: string | null;
}
