import { getCurrentTab, getDataStudioTopLevelRoute } from "./utils";

describe("getDataStudioTopLevelRoute", () => {
  it.each`
    pathname                                                    | expectedRoute
    ${"/data-studio/guide"}                                     | ${"/data-studio/guide"}
    ${"/data-studio/data/database/1/schema/1:public/table/193"} | ${"/data-studio/data"}
    ${"/data-studio/transforms/jobs/123"}                       | ${"/data-studio/transforms"}
    ${"/data-studio/transforms/runs?page=2"}                    | ${"/data-studio/transforms"}
    ${"/data-studio/library/tables/42"}                         | ${"/data-studio/library"}
    ${"/data-studio/schema-viewer?database-id=1"}               | ${"/data-studio/schema-viewer"}
    ${"/data-studio/dependency-diagnostics/broken"}             | ${"/data-studio/dependency-diagnostics"}
    ${"/data-studio/workspaces/current"}                        | ${"/data-studio/workspaces"}
    ${"/data-studio"}                                           | ${null}
    ${"/data-studio/"}                                          | ${null}
    ${"/other"}                                                 | ${null}
  `(
    "should return '$expectedRoute' for pathname '$pathname'",
    ({ pathname, expectedRoute }) => {
      expect(getDataStudioTopLevelRoute(pathname)).toBe(expectedRoute);
    },
  );
});

describe("getCurrentTab", () => {
  it.each`
    pathname                                              | expectedTab
    ${"/data-studio/guide"}                               | ${"guide"}
    ${"/data-studio/glossary"}                            | ${"glossary"}
    ${"/data-studio/glossary/some-path"}                  | ${"glossary"}
    ${"/data-studio/transforms/jobs"}                     | ${"transforms"}
    ${"/data-studio/transforms/jobs/123"}                 | ${"transforms"}
    ${"/data-studio/transforms/jobs/new"}                 | ${"transforms"}
    ${"/data-studio/dependencies"}                        | ${"dependencies"}
    ${"/data-studio/dependencies?id=1&type=card"}         | ${"dependencies"}
    ${"/data-studio/dependency-diagnostics"}              | ${"dependency-diagnostics"}
    ${"/data-studio/dependency-diagnostics/breaking"}     | ${"dependency-diagnostics"}
    ${"/data-studio/dependency-diagnostics/unreferenced"} | ${"dependency-diagnostics"}
    ${"/data-studio/library"}                             | ${"library"}
    ${"/data-studio/library/collections/123"}             | ${"library"}
    ${"/data-studio/library/metrics/456"}                 | ${"library"}
    ${"/data-studio/library/metrics/456/overview"}        | ${"library"}
    ${"/data-studio/library/tables/42"}                   | ${"library"}
    ${"/data-studio/transforms/runs"}                     | ${"transforms"}
    ${"/data-studio/transforms/runs?page=2"}              | ${"transforms"}
    ${"/data-studio/transforms"}                          | ${"transforms"}
    ${"/data-studio/transforms/123"}                      | ${"transforms"}
    ${"/data-studio/transforms/new/query"}                | ${"transforms"}
    ${"/data-studio/data"}                                | ${"data"}
    ${"/data-studio/data/database/1"}                     | ${"data"}
    ${"/data-studio/schema-viewer"}                       | ${"schema-viewer"}
    ${"/data-studio"}                                     | ${"guide"}
    ${"/data-studio/settings"}                            | ${"settings"}
    ${"/data-studio"}                                     | ${"data"}
  `(
    "should return '$expectedTab' for pathname '$pathname'",
    ({ pathname, expectedTab }) => {
      expect(getCurrentTab(pathname)).toBe(expectedTab);
    },
  );
});
