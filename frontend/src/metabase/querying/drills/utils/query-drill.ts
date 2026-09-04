import { isNotNull } from "metabase/utils/types";
import type { ClickAction } from "metabase/visualizations/types";
import type { DrillThruDisplayInfo } from "metabase-lib";
import * as Lib from "metabase-lib";
import type Question from "metabase-lib/v1/Question";

import { DRILLS } from "./constants";
import {
  getCustomClearSortClickAction,
  getCustomSortClickAction,
} from "./sort-drill";

export function isGroupedDimensionClick(clicked: Lib.ClickObject) {
  return (
    clicked.dimensions?.some((dimension) => Array.isArray(dimension.value)) ??
    false
  );
}

export function shouldHideDrill(
  drillInfo: DrillThruDisplayInfo,
  clicked: Lib.ClickObject,
) {
  return isGroupedDimensionClick(clicked)
    ? drillInfo.type !== "drill-thru/underlying-records"
    : false;
}

export function queryDrill(
  question: Question,
  clicked: Lib.ClickObject,
  isDrillEnabled: (drill: DrillThruDisplayInfo) => boolean,
): ClickAction[] {
  const query = question.query();
  const stageIndex = -1;
  const drills = Lib.availableDrillThrus(
    query,
    stageIndex,
    question.id(),
    clicked.column,
    clicked.value,
    clicked.data,
    clicked.dimensions,
  );

  const applyDrill = (drill: Lib.DrillThru, ...args: unknown[]) => {
    const newQuery = Lib.drillThru(
      query,
      stageIndex,
      question.id(),
      drill,
      ...args,
    );
    return question.setQuery(newQuery);
  };

  const actions = drills
    .flatMap((drill) => {
      const drillInfo = Lib.displayInfo(query, stageIndex, drill);
      const drillHandler = DRILLS[drillInfo.type];

      if (
        !isDrillEnabled(drillInfo) ||
        !drillHandler ||
        shouldHideDrill(drillInfo, clicked)
      ) {
        return null;
      }

      return drillHandler({
        question,
        query,
        stageIndex,
        drill,
        drillInfo,
        clicked,
        applyDrill,
      });
    })
    .filter(isNotNull);

  return appendFallbackSortActions({
    actions,
    clicked,
    isDrillEnabled,
  });
}

type AppendFallbackSortActionsOpts = {
  actions: ClickAction[];
  clicked: Lib.ClickObject;
  isDrillEnabled: (drill: DrillThruDisplayInfo) => boolean;
};

export function appendFallbackSortActions({
  actions,
  clicked,
  isDrillEnabled,
}: AppendFallbackSortActionsOpts): ClickAction[] {
  const hasQuerySortAction = actions.some(
    (action) =>
      action.name === "sort.ascending" || action.name === "sort.descending",
  );
  const fallbackSortInfo: Lib.SortDrillThruInfo = {
    type: "drill-thru/sort",
    directions: ["asc", "desc"],
  };
  const clientSideSort = getClientSideSort(clicked);

  if (
    hasQuerySortAction ||
    clientSideSort == null ||
    !isDrillEnabled(fallbackSortInfo) ||
    clicked.value !== undefined ||
    clicked.column == null ||
    clicked.column.base_type === "type/Structured" ||
    clicked.column.effective_type === "type/Structured"
  ) {
    return actions;
  }

  const sortActions = clientSideSort.directions.map((direction) =>
    getCustomSortClickAction(direction, ({ closePopover }) => {
      clientSideSort.onSortColumn(direction);
      closePopover();
    }),
  );
  const clearSortActions = clientSideSort.onClearSort
    ? [
        getCustomClearSortClickAction(({ closePopover }) => {
          clientSideSort.onClearSort?.();
          closePopover();
        }),
      ]
    : [];

  return [...actions, ...sortActions, ...clearSortActions];
}

type ClientSideSort = {
  directions: Lib.SortDrillThruDirection[];
  onSortColumn: (direction: Lib.SortDrillThruDirection) => void;
  onClearSort?: () => void;
};

function getClientSideSort(clicked: Lib.ClickObject): ClientSideSort | null {
  const { sortDirections, onSortColumn, onClearSort } = clicked.extraData ?? {};

  if (
    !Array.isArray(sortDirections) ||
    sortDirections.some(
      (direction) => direction !== "asc" && direction !== "desc",
    ) ||
    typeof onSortColumn !== "function"
  ) {
    return null;
  }

  if (onClearSort != null && typeof onClearSort !== "function") {
    return null;
  }

  return {
    directions: sortDirections,
    onSortColumn: (direction) => onSortColumn(direction),
    onClearSort: onClearSort ? () => onClearSort() : undefined,
  };
}
