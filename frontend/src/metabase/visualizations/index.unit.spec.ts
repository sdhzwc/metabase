import { registerVisualizations } from "metabase/visualizations/register";
import {
  createMockColumn,
  createMockDatasetData,
} from "metabase-types/api/mocks";

import { getSensibleDisplays } from ".";

registerVisualizations();

describe("visualizations", () => {
  describe("getSensibleDisplays", () => {
    it("should not consider scalar sensible for one-row multi-column results", () => {
      const data = createMockDatasetData({
        cols: [
          createMockColumn({ name: "st", base_type: "type/Date" }),
          createMockColumn({
            name: "current_user_id",
            base_type: "type/Integer",
          }),
        ],
        rows: [["2026-07-20", 1]],
      });

      expect(getSensibleDisplays(data)).toContain("table");
      expect(getSensibleDisplays(data)).not.toContain("scalar");
    });

    it("should keep all displays available while there is no data", () => {
      const data = createMockDatasetData({
        cols: [
          createMockColumn({ name: "st", base_type: "type/Date" }),
          createMockColumn({
            name: "current_user_id",
            base_type: "type/Integer",
          }),
        ],
        rows: [],
      });

      expect(getSensibleDisplays(data)).toContain("scalar");
    });
  });
});
