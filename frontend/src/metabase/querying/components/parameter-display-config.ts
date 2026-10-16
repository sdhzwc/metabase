import type { CardId } from "metabase-types/api";

export const PARAMETER_DISPLAY_CONFIG_EVENT =
  "metabase:parameter-display-config-changed";
export const VISIBLE_GROUPS_CONFIG_EVENT =
  "metabase:visible-groups-config-changed";

const STORAGE_KEY = "metabase.query-editor.visible-parameters";
const VISIBLE_GROUPS_STORAGE_KEY = "metabase.query-editor.visible-groups";
const DEFAULT_VISIBLE_PARAMETER_COUNT = 5;

function getStorageKey(prefix: string, cardId?: CardId) {
  return `${prefix}:${cardId ?? "new-question"}`;
}

export function getDefaultVisibleParameterSlugs(slugs: string[]) {
  return slugs.slice(0, DEFAULT_VISIBLE_PARAMETER_COUNT);
}

function readSlugs(prefix: string, cardId?: CardId): string[] | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = window.localStorage.getItem(getStorageKey(prefix, cardId));
    const parsed: unknown = value ? JSON.parse(value) : null;
    return Array.isArray(parsed) &&
      parsed.every((slug) => typeof slug === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function saveSlugs(
  prefix: string,
  eventName: string,
  cardId: CardId | undefined,
  slugs: string[],
) {
  try {
    window.localStorage.setItem(
      getStorageKey(prefix, cardId),
      JSON.stringify(slugs),
    );
  } catch {
    // The current page can still use the selection if storage is unavailable.
  }

  window.dispatchEvent(
    new CustomEvent(eventName, {
      detail: { cardId, slugs },
    }),
  );
}

export function readVisibleParameterSlugs(cardId?: CardId): string[] | null {
  return readSlugs(STORAGE_KEY, cardId);
}

export function saveVisibleParameterSlugs(
  cardId: CardId | undefined,
  slugs: string[],
) {
  saveSlugs(STORAGE_KEY, PARAMETER_DISPLAY_CONFIG_EVENT, cardId, slugs);
}

export function readVisibleGroupSlugs(cardId?: CardId): string[] | null {
  return readSlugs(VISIBLE_GROUPS_STORAGE_KEY, cardId);
}

export function saveVisibleGroupSlugs(
  cardId: CardId | undefined,
  slugs: string[],
) {
  saveSlugs(
    VISIBLE_GROUPS_STORAGE_KEY,
    VISIBLE_GROUPS_CONFIG_EVENT,
    cardId,
    slugs,
  );
}

function splitSqlList(value: string) {
  const items: string[] = [];
  let start = 0;
  let depth = 0;

  for (let index = 0; index < value.length; index++) {
    if (value[index] === "(") {
      depth++;
    } else if (value[index] === ")") {
      depth = Math.max(0, depth - 1);
    } else if (value[index] === "," && depth === 0) {
      items.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  const lastItem = value.slice(start).trim();
  if (lastItem) {
    items.push(lastItem);
  }
  return items;
}

function normalizeSqlExpression(value: string) {
  return value
    .replace(/["`\[\]]/g, "")
    .trim()
    .toLowerCase();
}

function matchesSqlField(value: string, field: string) {
  const normalizedValue = normalizeSqlExpression(value);
  const normalizedField = normalizeSqlExpression(field);
  return (
    normalizedValue === normalizedField ||
    normalizedValue.startsWith(`${normalizedField} `)
  );
}

function updateSqlList(
  value: string,
  previousFields: string[],
  nextFields: string[],
  aliases: Record<string, string> = {},
  addAliases = false,
) {
  const retained = splitSqlList(value).filter(
    (item) => !previousFields.some((field) => matchesSqlField(item, field)),
  );
  const additions = nextFields
    .filter((field) => !retained.some((item) => matchesSqlField(item, field)))
    .map((field) => {
      if (!addAliases || !aliases[field]) {
        return field;
      }
      const alias = aliases[field].replaceAll('"', '""');
      return `${field} "${alias}"`;
    });
  return [...retained, ...additions].join(", ");
}

function preserveSqlListWhitespace(original: string, updated: string) {
  const leading = original.match(/^\s*/)?.[0] ?? " ";
  const trailing = original.match(/\s*$/)?.[0] ?? " ";
  return `${leading}${updated}${trailing}`;
}

export function updateQueryGroupFields(
  queryText: string,
  previousFields: string[],
  nextFields: string[],
  aliases: Record<string, string> = {},
) {
  if (previousFields.length === 0 && nextFields.length === 0) {
    return queryText;
  }

  const selectMatch = queryText.match(/\bselect\b([\s\S]*?)\bfrom\b/i);
  if (!selectMatch || selectMatch.index == null) {
    return queryText;
  }

  const selectStart =
    selectMatch.index + selectMatch[0].indexOf(selectMatch[1]);
  const updatedSelect = preserveSqlListWhitespace(
    selectMatch[1],
    updateSqlList(selectMatch[1], previousFields, nextFields, aliases, true),
  );
  const updatedQuery =
    queryText.slice(0, selectStart) +
    updatedSelect +
    queryText.slice(selectStart + selectMatch[1].length);

  const groupMatch = updatedQuery.match(
    /\bgroup\s+by\b([\s\S]*?)(?=\border\s+by\b|\bhaving\b|\blimit\b|\boffset\b|;|$)/i,
  );
  if (groupMatch && groupMatch.index != null) {
    const groupStart = groupMatch.index + groupMatch[0].indexOf(groupMatch[1]);
    const updatedGroup = preserveSqlListWhitespace(
      groupMatch[1],
      updateSqlList(groupMatch[1], previousFields, nextFields),
    );
    return (
      updatedQuery.slice(0, groupStart) +
      updatedGroup +
      updatedQuery.slice(groupStart + groupMatch[1].length)
    );
  }

  if (nextFields.length === 0) {
    return updatedQuery;
  }

  const groupByClause = `GROUP BY ${nextFields.join(", ")}`;
  const insertMatch = updatedQuery.match(
    /\b(order\s+by|having|limit|offset)\b/i,
  );
  if (insertMatch?.index != null) {
    return `${updatedQuery.slice(0, insertMatch.index).trimEnd()} ${groupByClause} ${updatedQuery.slice(insertMatch.index)}`;
  }
  return `${updatedQuery.trimEnd()} ${groupByClause}`;
}
