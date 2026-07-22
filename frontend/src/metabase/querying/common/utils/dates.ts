import dayjs from "dayjs";
import { match } from "ts-pattern";
import { c, msgid, ngettext, t } from "ttag";

import type {
  DateFilterDisplayOpts,
  DateFilterValue,
} from "metabase/querying/common/types";
import { DEFAULT_TIME_STYLE } from "metabase/utils/formatting/datetime-utils";
import { isSimplifiedChineseLocale } from "metabase/utils/i18n";
import type { ExcludeDateFilterUnit } from "metabase-lib";
import * as Lib from "metabase-lib";
import type { DateFormattingSettings } from "metabase-types/api";

export type { DateFilterDisplayOpts } from "metabase/querying/common/types";

export const DYNAMIC_DATE_TEMPLATE_PREFIX = "date-template:";

export function getDateFilterDisplayName(
  value: DateFilterValue,
  {
    withPrefix,
    formattingSettings,
    singleDateShortcutLabels,
    singleDateShortcutDates,
    locale,
  }: DateFilterDisplayOpts = {},
) {
  const singleDateShortcutDisplayName = singleDateShortcutLabels
    ? getSingleDateShortcutDisplayName(value, locale)
    : null;

  if (singleDateShortcutDisplayName != null) {
    return singleDateShortcutDisplayName;
  }

  const singleDateShortcutDate = singleDateShortcutDates
    ? getSingleDateDefaultDate(value)
    : null;

  if (singleDateShortcutDate != null) {
    return formatDate(singleDateShortcutDate, false, formattingSettings);
  }

  return match(value)
    .with(
      { type: "specific", operator: "=" },
      ({ values: [date], hasTime }) => {
        const dateText = formatDate(date, hasTime, formattingSettings);
        return withPrefix
          ? c("On a date. Example: On Jan 20.").t`On ${dateText}`
          : dateText;
      },
    )
    .with(
      { type: "specific", operator: "<" },
      ({ values: [date], hasTime }) => {
        return c("Before a date. Example: Before Jan 20.")
          .t`Before ${formatDate(date, hasTime, formattingSettings)}`;
      },
    )
    .with(
      { type: "specific", operator: ">" },
      ({ values: [date], hasTime }) => {
        return c("After a date. Example: After Jan 20.")
          .t`After ${formatDate(date, hasTime, formattingSettings)}`;
      },
    )
    .with(
      { type: "specific", operator: "between" },
      ({ values: [startDate, endDate], hasTime }) => {
        return `${formatDate(startDate, hasTime, formattingSettings)} - ${formatDate(endDate, hasTime, formattingSettings)}`;
      },
    )
    .with(
      {
        type: "relative",
        value: -1,
        unit: "day",
        offsetValue: -1,
        offsetUnit: "day",
      },
      () => t`Day before yesterday`,
    )
    .with(
      { type: "relative" },
      ({ value, unit, offsetValue, offsetUnit, options }) => {
        if (offsetValue != null && offsetUnit != null) {
          const prefix = Lib.describeTemporalInterval(value, unit);
          const suffix = Lib.describeRelativeDatetime(offsetValue, offsetUnit);
          return `${prefix}, ${suffix}`;
        } else {
          return Lib.describeTemporalInterval(value, unit, {
            "include-current": options?.includeCurrent,
          });
        }
      },
    )
    .with({ type: "exclude", operator: "!=" }, ({ values, unit }) => {
      if (values.length <= 2 && unit != null) {
        const parts = values.map((value) => formatExcludeUnit(value, unit));
        return t`Exclude ${parts.join(", ")}`;
      } else {
        const count = values.length;
        return ngettext(
          msgid`Exclude ${count} selection`,
          `Exclude ${count} selections`,
          count,
        );
      }
    })
    .with({ type: "exclude", operator: "is-null" }, () => {
      return t`Is empty`;
    })
    .with({ type: "exclude", operator: "not-null" }, () => {
      return t`Not empty`;
    })
    .with({ type: "month" }, ({ month, year }) => {
      return formatMonth(month, year, formattingSettings);
    })
    .with({ type: "quarter" }, ({ quarter, year }) => {
      return formatQuarter(quarter, year);
    })
    .with({ type: "dynamic-template" }, ({ template }) => {
      const date = getDynamicDateTemplateDate(template);
      return date != null
        ? formatDate(date, false, formattingSettings)
        : template;
    })
    .exhaustive();
}

export type SingleDateDefaultLabels = {
  today: string;
  yesterday: string;
  dayBeforeYesterday: string;
  customDynamicDate: string;
  customFixedDate: string;
  dynamicDateTemplate: string;
  invalidDynamicDateTemplate: string;
  apply: string;
};

export function getSingleDateDefaultLabels(
  locale?: string,
): SingleDateDefaultLabels {
  if (isSimplifiedChineseLocale(locale)) {
    return {
      today: "今日",
      yesterday: "昨日",
      dayBeforeYesterday: "前天",
      customDynamicDate: "自定义动态日期",
      customFixedDate: "自定义固定日期",
      dynamicDateTemplate: "动态日期模板",
      invalidDynamicDateTemplate: "请输入能生成有效单日期的模板",
      apply: "应用",
    };
  }

  return {
    today: t`Today`,
    yesterday: t`Yesterday`,
    dayBeforeYesterday: t`Day before yesterday`,
    customDynamicDate: t`Custom dynamic date`,
    customFixedDate: t`Custom fixed date`,
    dynamicDateTemplate: t`Dynamic date template`,
    invalidDynamicDateTemplate: t`Enter a template that produces a valid single date`,
    apply: t`Apply`,
  };
}

export function getSingleDateDefaultDate(value: DateFilterValue) {
  return match(value)
    .with({ type: "dynamic-template" }, ({ template }) =>
      getDynamicDateTemplateDate(template),
    )
    .with(
      {
        type: "relative",
        value: -1,
        unit: "day",
        offsetValue: -1,
        offsetUnit: "day",
      },
      () => dayjs().subtract(2, "day").startOf("day").toDate(),
    )
    .with(
      {
        type: "relative",
        value: 0,
        unit: "day",
      },
      () => dayjs().startOf("day").toDate(),
    )
    .with(
      {
        type: "relative",
        value: -1,
        unit: "day",
      },
      () => dayjs().subtract(1, "day").startOf("day").toDate(),
    )
    .otherwise(() => null);
}

function getSingleDateShortcutDisplayName(
  value: DateFilterValue,
  locale?: string,
) {
  const labels = getSingleDateDefaultLabels(locale);

  return match(value)
    .with({ type: "dynamic-template" }, ({ template }) => template)
    .with(
      {
        type: "relative",
        value: -1,
        unit: "day",
        offsetValue: -1,
        offsetUnit: "day",
      },
      () => labels.dayBeforeYesterday,
    )
    .with(
      {
        type: "relative",
        value: 0,
        unit: "day",
      },
      () => labels.today,
    )
    .with(
      {
        type: "relative",
        value: -1,
        unit: "day",
      },
      () => labels.yesterday,
    )
    .otherwise(() => null);
}

export function serializeDynamicDateTemplate(template: string) {
  return `${DYNAMIC_DATE_TEMPLATE_PREFIX}${template.trim()}`;
}

export function deserializeDynamicDateTemplate(value: string) {
  return value.startsWith(DYNAMIC_DATE_TEMPLATE_PREFIX)
    ? value.slice(DYNAMIC_DATE_TEMPLATE_PREFIX.length)
    : null;
}

export function getDynamicDateTemplateDate(template: string) {
  const expression = parseDynamicDateTemplateExpression(template);
  if (expression == null) {
    return null;
  }

  const renderedTemplate = renderDynamicDateTemplate(expression.template);
  const date =
    renderedTemplate != null
      ? parseDynamicDateTemplate(renderedTemplate)
      : null;

  return date != null
    ? applyDynamicDateTemplateOffsets(date, expression.offsets)
    : null;
}

type DynamicDateTemplateOffsetUnit = "day" | "week" | "month" | "year";

type DynamicDateTemplateOffset = {
  direction: 1 | -1;
  amount: number;
  unit: DynamicDateTemplateOffsetUnit;
};

type DynamicDateTemplateExpression = {
  template: string;
  offsets: DynamicDateTemplateOffset[];
};

const DYNAMIC_DATE_TEMPLATE_EXPRESSION_REGEX =
  /^((?:%[Ymd]|[0-9/-])+)((?:\s*[+-]\s*\d+\s*(?:days?|weeks?|months?|years?))*)$/i;

const DYNAMIC_DATE_TEMPLATE_OFFSET_REGEX =
  /([+-])\s*(\d+)\s*(days?|weeks?|months?|years?)/gi;

function parseDynamicDateTemplateExpression(
  template: string,
): DynamicDateTemplateExpression | null {
  const match = template.trim().match(DYNAMIC_DATE_TEMPLATE_EXPRESSION_REGEX);
  if (match == null) {
    return null;
  }

  const [, dateTemplate, offsetsText] = match;
  const offsets = Array.from(
    offsetsText.matchAll(DYNAMIC_DATE_TEMPLATE_OFFSET_REGEX),
    ([, operator, amountText, unitText]) => ({
      direction: getDynamicDateTemplateOffsetDirection(operator),
      amount: Number(amountText),
      unit: normalizeDynamicDateTemplateOffsetUnit(unitText),
    }),
  );

  return { template: dateTemplate, offsets };
}

function getDynamicDateTemplateOffsetDirection(operator: string): 1 | -1 {
  return operator === "-" ? -1 : 1;
}

function normalizeDynamicDateTemplateOffsetUnit(
  unit: string,
): DynamicDateTemplateOffsetUnit {
  switch (unit.toLowerCase().replace(/s$/, "")) {
    case "day":
      return "day";
    case "week":
      return "week";
    case "month":
      return "month";
    case "year":
      return "year";
    default:
      throw new Error(`Unsupported dynamic date template offset unit: ${unit}`);
  }
}

function renderDynamicDateTemplate(template: string) {
  const today = dayjs();
  const trimmedTemplate = template.trim();

  if (!/^(?:%[Ymd]|[0-9/-])+$/.test(trimmedTemplate)) {
    return null;
  }

  return trimmedTemplate
    .replaceAll("%Y", today.format("YYYY"))
    .replaceAll("%m", today.format("MM"))
    .replaceAll("%d", today.format("DD"));
}

function parseDynamicDateTemplate(renderedTemplate: string) {
  const parts =
    renderedTemplate.match(/^(\d{4})(\d{2})(\d{2})$/) ??
    renderedTemplate.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);

  if (parts == null) {
    return null;
  }

  const [, yearText, monthText, dayText] = parts;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null;
}

function applyDynamicDateTemplateOffsets(
  date: Date,
  offsets: DynamicDateTemplateOffset[],
) {
  return offsets.reduce((currentDate, { direction, amount, unit }) => {
    return dayjs(currentDate)
      .add(direction * amount, unit)
      .startOf("day")
      .toDate();
  }, date);
}

export function formatDate(
  date: Date,
  hasTime: boolean,
  formattingSettings: DateFormattingSettings = {},
) {
  const format = formattingSettingsToFormatString(formattingSettings, hasTime);
  return dayjs(date).format(format);
}

function formattingSettingsToFormatString(
  formattingSettings: DateFormattingSettings = {},
  hasTime: boolean = false,
) {
  const { date_style = "LL", time_style = DEFAULT_TIME_STYLE } =
    formattingSettings;

  const format = hasTime ? `${date_style} ${time_style}` : date_style;
  return abbreviateFormat(format, formattingSettings);
}

function abbreviateFormat(
  format: string,
  formattingSettings: DateFormattingSettings = {},
) {
  if (!formattingSettings.date_abbreviate) {
    return format;
  }
  return format.replace(/MMMM/, "MMM").replace(/dddd/, "ddd");
}

function formatMonth(
  month: number,
  year: number,
  formattingSettings: DateFormattingSettings = {},
) {
  return dayjs()
    .year(year)
    .month(month - 1)
    .format(abbreviateFormat("MMMM YYYY", formattingSettings));
}

function formatQuarter(quarter: number, year: number) {
  return dayjs()
    .year(year)
    .quarter(quarter)
    .format(
      c(
        'This is a "dayjs" format string (https://day.js.org/docs/en/plugin/advanced-format). It should include "Q" for the quarter number, YYYY for the year, and raw text can be escaped by brackets. For example, "[Quarter] Q YYYY" will be rendered as "Quarter 1 2024".',
      ).t`[Q]Q YYYY`,
    );
}

function formatExcludeUnit(value: number, unit: ExcludeDateFilterUnit) {
  switch (unit) {
    case "hour-of-day":
      return dayjs().hour(value).format("h A");
    case "day-of-week":
      return dayjs().isoWeekday(value).format("dddd");
    case "month-of-year":
      return dayjs()
        .month(value - 1)
        .format("MMMM");
    case "quarter-of-year":
      return dayjs()
        .quarter(value)
        .format(
          c(
            'This is a "dayjs" format string (https://day.js.org/docs/en/plugin/advanced-format). It should include "Q" for the quarter number, and raw text can be escaped by brackets. For example, "[Quarter] Q" will be rendered as "Quarter 1".',
          ).t`[Q]Q`,
        );
  }
}
