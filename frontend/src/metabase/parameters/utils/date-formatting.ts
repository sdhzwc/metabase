import { getDateFilterDisplayName } from "metabase/querying/filters/utils/dates";
import { deserializeDateParameterValue } from "metabase/querying/parameters/utils/parsing";
import type { DateFormattingSettings, Parameter } from "metabase-types/api";

type FormatDateValueOptions = {
  singleDateShortcutLabels?: boolean;
  locale?: string;
};

export function formatDateValue(
  parameter: Parameter,
  value: string,
  formattingSettings?: DateFormattingSettings,
  options: FormatDateValueOptions = {},
): string | null {
  const filter = deserializeDateParameterValue(value);
  if (filter == null) {
    return null;
  }

  return getDateFilterDisplayName(filter, {
    withPrefix: parameter.type !== "date/single",
    formattingSettings,
    singleDateShortcutLabels:
      parameter.type === "date/single" && options.singleDateShortcutLabels,
    singleDateShortcutDates:
      parameter.type === "date/single" && !options.singleDateShortcutLabels,
    locale: options.locale,
  });
}
