// Constants shared by the dev server preset and its plugin. The sandbox globals
// contract lives with the sandbox; re-exported so the preset has one import site.

export {
  DATA_APP_EXTERNALS,
  DATA_APP_FACTORY_GLOBAL,
  DATA_APP_GLOBALS,
  DATA_APP_GLOBAL_NAMES,
} from "metabase-enterprise/data_apps/sandbox/globals";

export const DATA_APP_ENTRY = "src/index.tsx";

export const DATA_APP_BUNDLE_URL = "/@data-app-bundle.js";

export const DATA_APP_REBUILT_EVENT = "data-app:rebuilt";
