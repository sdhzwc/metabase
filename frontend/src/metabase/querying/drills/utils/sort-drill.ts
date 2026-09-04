import { t } from "ttag";

import type {
  ClickActionBase,
  CustomClickAction,
  Drill,
} from "metabase/visualizations/types/click-actions";
import type * as Lib from "metabase-lib";

const ACTIONS: Record<string, ClickActionBase> = {
  asc: {
    name: "sort.ascending",
    icon: "arrow_up",
    section: "sort",
    buttonType: "sort",
    get tooltip() {
      return t`Sort ascending`;
    },
  },
  desc: {
    name: "sort.descending",
    icon: "arrow_down",
    section: "sort",
    buttonType: "sort",
    get tooltip() {
      return t`Sort descending`;
    },
  },
};

const getClientSideActionTooltip = (direction: Lib.SortDrillThruDirection) => {
  return direction === "asc"
    ? t`Sort ascending in this table. Downloads are unaffected.`
    : t`Sort descending in this table. Downloads are unaffected.`;
};

export const sortDrill: Drill<Lib.SortDrillThruInfo> = ({
  drill,
  drillInfo,
  applyDrill,
}) => {
  const { directions } = drillInfo;

  return directions.map((direction) => ({
    ...ACTIONS[direction],
    question: () => applyDrill(drill, direction),
  }));
};

export const getCustomSortClickAction = (
  direction: Lib.SortDrillThruDirection,
  onClick: CustomClickAction["onClick"],
): CustomClickAction => ({
  ...ACTIONS[direction],
  name:
    direction === "asc" ? "client-sort.ascending" : "client-sort.descending",
  tooltip: getClientSideActionTooltip(direction),
  type: "custom",
  onClick,
});
