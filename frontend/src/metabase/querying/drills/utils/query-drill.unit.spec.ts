import type {
  ClickAction,
  CustomClickAction,
} from "metabase/visualizations/types";
import type { ClickObject, DrillThruDisplayInfo } from "metabase-lib";
import { createMockColumn } from "metabase-types/api/mocks";

import {
  appendFallbackSortActions,
  isGroupedDimensionClick,
  shouldHideDrill,
} from "./query-drill";

const getCustomAction = (action: ClickAction): CustomClickAction => {
  if (
    !("type" in action) ||
    action.type !== "custom" ||
    !("buttonType" in action)
  ) {
    throw new Error("Expected a custom action");
  }

  return action;
};

const groupedDimensionClick: ClickObject = {
  dimensions: [
    {
      column: createMockColumn(),
      value: ["Gizmo", "Doohickey"],
    },
  ],
};

describe("isGroupedDimensionClick", () => {
  it("detects clicks with grouped dimension values", () => {
    expect(isGroupedDimensionClick(groupedDimensionClick)).toBe(true);
  });

  it("ignores clicks with regular dimension values", () => {
    const clicked: ClickObject = {
      dimensions: [
        {
          column: createMockColumn(),
          value: "Gizmo",
        },
      ],
    };

    expect(isGroupedDimensionClick(clicked)).toBe(false);
  });
});

describe("shouldHideDrill", () => {
  it("keeps underlying records for grouped dimension clicks", () => {
    const drillInfo: DrillThruDisplayInfo = {
      type: "drill-thru/underlying-records",
      rowCount: 2,
      tableName: "Products",
    };

    expect(shouldHideDrill(drillInfo, groupedDimensionClick)).toBe(false);
  });

  it("hides other drills for grouped dimension clicks", () => {
    const drillInfo: DrillThruDisplayInfo = {
      type: "drill-thru/pivot",
    };

    expect(shouldHideDrill(drillInfo, groupedDimensionClick)).toBe(true);
  });
});

describe("appendFallbackSortActions", () => {
  const getOpts = ({
    actions = [],
    clicked = { column: createMockColumn(), value: undefined },
    isDrillEnabled = () => true,
  }: {
    actions?: ClickAction[];
    clicked?: ClickObject;
    isDrillEnabled?: (drill: DrillThruDisplayInfo) => boolean;
  } = {}) => {
    return {
      actions,
      clicked,
      isDrillEnabled,
    };
  };

  it("does not add sort actions when no client-side sort callback is provided", () => {
    const actions = appendFallbackSortActions(getOpts());

    expect(actions).toEqual([]);
  });

  it("does not replace existing query sort actions", () => {
    const onSortColumn = jest.fn();
    // Unjustified type cast. FIXME
    const existingSortAction = {
      name: "sort.ascending",
      section: "sort",
      buttonType: "sort",
      question: jest.fn(),
    } as ClickAction;

    const actions = appendFallbackSortActions(
      getOpts({
        actions: [existingSortAction],
        clicked: {
          column: createMockColumn(),
          value: undefined,
          extraData: {
            sortDirections: ["desc"],
            onSortColumn,
          },
        },
      }),
    );

    expect(actions).toEqual([existingSortAction]);
  });

  it("does not add sort actions for cell clicks", () => {
    const actions = appendFallbackSortActions(
      getOpts({ clicked: { column: createMockColumn(), value: "value" } }),
    );

    expect(actions).toEqual([]);
  });

  it("adds client-side sort actions for header clicks", () => {
    const onSortColumn = jest.fn();
    const closePopover = jest.fn();

    const actions = appendFallbackSortActions(
      getOpts({
        clicked: {
          column: createMockColumn(),
          value: undefined,
          extraData: {
            sortDirections: ["asc", "desc"],
            onSortColumn,
          },
        },
      }),
    );

    const customActions = actions.map(getCustomAction);

    expect(customActions.map((action) => action.name)).toEqual([
      "client-sort.ascending",
      "client-sort.descending",
    ]);
    expect(customActions.map((action) => action.buttonType)).toEqual([
      "sort",
      "sort",
    ]);
    expect(customActions.map((action) => action.tooltip)).toEqual([
      "Sort ascending in this table. Downloads are unaffected.",
      "Sort descending in this table. Downloads are unaffected.",
    ]);

    const sortAscending = customActions[0];

    sortAscending.onClick?.({
      dispatch: jest.fn(),
      closePopover,
    });

    expect(onSortColumn).toHaveBeenCalledWith("asc");
    expect(closePopover).toHaveBeenCalled();
  });

  it("adds a client-side clear sort action when a clear callback is provided", () => {
    const onSortColumn = jest.fn();
    const onClearSort = jest.fn();
    const closePopover = jest.fn();

    const actions = appendFallbackSortActions(
      getOpts({
        clicked: {
          column: createMockColumn(),
          value: undefined,
          extraData: {
            sortDirections: ["desc"],
            onSortColumn,
            onClearSort,
          },
        },
      }),
    );

    const customActions = actions.map(getCustomAction);

    expect(customActions.map((action) => action.name)).toEqual([
      "client-sort.descending",
      "client-sort.clear",
    ]);
    expect(customActions.map((action) => action.buttonType)).toEqual([
      "sort",
      "sort",
    ]);
    expect(customActions.map((action) => action.tooltip)).toEqual([
      "Sort descending in this table. Downloads are unaffected.",
      "Clear sorting in this table.",
    ]);

    const clearSort = customActions[1];

    clearSort.onClick?.({
      dispatch: jest.fn(),
      closePopover,
    });

    expect(onClearSort).toHaveBeenCalled();
    expect(closePopover).toHaveBeenCalled();
  });

  it("does not add sort actions for structured columns", () => {
    const actions = appendFallbackSortActions(
      getOpts({
        clicked: {
          column: createMockColumn({ base_type: "type/Structured" }),
          value: undefined,
        },
      }),
    );

    expect(actions).toEqual([]);
  });
});
