import type { LibraryFormats } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import svgr from "vite-plugin-svgr";

import {
  DATA_APP_ENTRY,
  DATA_APP_EXTERNALS,
  DATA_APP_FACTORY_GLOBAL,
  DATA_APP_GLOBALS,
} from "../bundle";

/**
 * The bundle contract, shared by `vite build` and the dev server's in-memory
 * build so both emit the same shape. `assetsInlineLimit` base64-inlines every
 * asset: the backend serves one file, so the build must be self-contained.
 */
export function dataAppLibBuild(fileName: string) {
  return {
    assetsInlineLimit: () => true,
    lib: {
      entry: DATA_APP_ENTRY,
      formats: ["iife"] satisfies LibraryFormats[],
      name: DATA_APP_FACTORY_GLOBAL,
      fileName: () => fileName,
    },
    rollupOptions: {
      external: DATA_APP_EXTERNALS,
      output: { globals: DATA_APP_GLOBALS },
    },
  };
}

// CSS is inlined into the JS — the IIFE has no HTML to link a stylesheet.
export function dataAppBuildPlugins() {
  return [cssInjectedByJsPlugin(), svgr()];
}
