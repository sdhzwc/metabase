import type { ColumnSizingState } from "@tanstack/react-table";

const SORT_INDICATOR_WIDTH = 14;

export const pickRowsToMeasure = <TData, TValue>(
  data: TData[],
  accessorFn: (row: TData) => TValue,
  count = 10,
) => {
  const rowIndexes = [];
  for (
    let rowIndex = 0;
    rowIndex < data.length && rowIndexes.length < count;
    rowIndex++
  ) {
    if (accessorFn(data[rowIndex]) != null) {
      rowIndexes.push(rowIndex);
    }
  }
  return rowIndexes;
};

/**
 * Limits column widths to a maximum value
 * @param columnSizingMap Original column sizing state
 * @param truncateWidth Maximum allowed width for any column
 * @returns Column sizing state with all values capped at truncateWidth
 */
export const getTruncatedColumnSizing = (
  columnSizingMap: ColumnSizingState,
  truncateWidth: number,
): ColumnSizingState =>
  Object.fromEntries(
    Object.entries(columnSizingMap).map(([key, value]) => [
      key,
      Math.min(value, truncateWidth),
    ]),
  );

export const addSortIndicatorColumnSizing = <TColumn extends string>(
  columnSizingMap: ColumnSizingState,
  sortedColumnIds: TColumn[],
): ColumnSizingState => {
  if (sortedColumnIds.length === 0) {
    return columnSizingMap;
  }

  return sortedColumnIds.reduce<ColumnSizingState>(
    (acc, id) => {
      if (acc[id] != null) {
        acc[id] += SORT_INDICATOR_WIDTH;
      }

      return acc;
    },
    { ...columnSizingMap },
  );
};

export const updateSortIndicatorColumnSizing = <TColumn extends string>(
  columnSizingMap: ColumnSizingState,
  previousSortedColumnIds: TColumn[],
  sortedColumnIds: TColumn[],
): ColumnSizingState => {
  const previousSortedColumnIdsSet = new Set(previousSortedColumnIds);
  const sortedColumnIdsSet = new Set(sortedColumnIds);
  const columnsToShrink = previousSortedColumnIds.filter(
    (id) => !sortedColumnIdsSet.has(id),
  );
  const columnsToGrow = sortedColumnIds.filter(
    (id) => !previousSortedColumnIdsSet.has(id),
  );

  if (columnsToShrink.length === 0 && columnsToGrow.length === 0) {
    return columnSizingMap;
  }

  const nextColumnSizingMap = { ...columnSizingMap };

  columnsToShrink.forEach((id) => {
    if (nextColumnSizingMap[id] != null) {
      nextColumnSizingMap[id] = Math.max(
        0,
        nextColumnSizingMap[id] - SORT_INDICATOR_WIDTH,
      );
    }
  });

  columnsToGrow.forEach((id) => {
    if (nextColumnSizingMap[id] != null) {
      nextColumnSizingMap[id] += SORT_INDICATOR_WIDTH;
    }
  });

  return nextColumnSizingMap;
};
