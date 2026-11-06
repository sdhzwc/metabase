import type { CardId } from "metabase-types/api";

export const PARAMETER_DISPLAY_CONFIG_EVENT =
  "metabase:parameter-display-config-changed";

const STORAGE_KEY = "metabase.query-editor.visible-parameters";
const DEFAULT_VISIBLE_PARAMETER_COUNT = 5;

function getStorageKey(cardId?: CardId) {
  return `${STORAGE_KEY}:${cardId ?? "new-question"}`;
}

export function getDefaultVisibleParameterSlugs(slugs: string[]) {
  return slugs.slice(0, DEFAULT_VISIBLE_PARAMETER_COUNT);
}

export function readVisibleParameterSlugs(cardId?: CardId): string[] | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = window.localStorage.getItem(getStorageKey(cardId));
    const parsed: unknown = value ? JSON.parse(value) : null;
    return Array.isArray(parsed) &&
      parsed.every((slug) => typeof slug === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * Return the saved selection when it still matches the current question.
 * A new question can inherit the storage key from a previous query, so an
 * empty or stale selection must not hide every parameter in the list.
 */
export function getVisibleParameterSlugs(
  cardId: CardId | undefined,
  parameterSlugs: string[],
) {
  const storedSlugs = readVisibleParameterSlugs(cardId);
  const matchingSlugs = storedSlugs?.filter((slug) =>
    parameterSlugs.includes(slug),
  );

  return matchingSlugs?.length
    ? matchingSlugs
    : getDefaultVisibleParameterSlugs(parameterSlugs);
}

export function saveVisibleParameterSlugs(
  cardId: CardId | undefined,
  slugs: string[],
) {
  try {
    window.localStorage.setItem(getStorageKey(cardId), JSON.stringify(slugs));
  } catch {
    // The current page can still use the selection if storage is unavailable.
  }

  window.dispatchEvent(
    new CustomEvent(PARAMETER_DISPLAY_CONFIG_EVENT, {
      detail: { cardId, slugs },
    }),
  );
}
