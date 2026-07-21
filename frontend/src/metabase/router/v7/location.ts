import type { Location as V7Location } from "react-router-v7";

import type { Location as HistoryLocation } from "../types";

/**
 * Parse a search string into v3's `location.query` object: repeated keys become
 * an array, an empty value stays `""`, matching history@3's default parser that
 * the `location.query` readers were written against.
 */
export function searchToQuery(
  search: string,
): Record<string, string | string[]> {
  const params = new URLSearchParams(search);
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }
  return query;
}

/**
 * Serialize a v3 `location.query` object back into a search string, the inverse
 * of `searchToQuery`. history@3 accepted a `query` object on a navigation target
 * and encoded it itself; v7 only understands `search`, so descriptors carrying a
 * `query` are converted here. Repeated values become repeated keys, and
 * null/undefined entries are dropped, matching history@3's serializer.
 */
export function queryToSearch(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null) {
      continue;
    }
    if (Array.isArray(value)) {
      value
        .filter((entry) => entry != null)
        .forEach((entry) => params.append(key, String(entry)));
    } else {
      params.append(key, String(value));
    }
  }
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

/**
 * Build the v3-shaped `history` location the facade context and `state.routing`
 * expect from a v7 location plus the current navigation type.
 */
export function toV3Location(
  location: V7Location,
  action: HistoryLocation["action"],
): HistoryLocation {
  return {
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    // v3 leaves state `undefined` when absent; v7 uses `null`.
    state: location.state ?? undefined,
    key: location.key,
    query: searchToQuery(location.search),
    action,
  };
}
