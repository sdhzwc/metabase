import { useContext, useMemo } from "react";

import { RouterContext } from "./RouterProvider";
import type { Location } from "./types";
import { useRouter } from "./use-router";

/**
 * react-router v7's `useLocation`, implemented over the v3 location injected
 * into the router context. Returns the v7 `Location` shape (no v3 `query` field).
 *
 * @see https://reactrouter.com/7.18.1/api/hooks/useLocation
 */
export function useLocation(): Location {
  const { location } = useRouter();

  return useMemo(
    () => ({
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
      // v3 leaves state `undefined` when absent, v7 uses `null`.
      state: location.state ?? null,
      key: location.key,
    }),
    [
      location.pathname,
      location.search,
      location.hash,
      location.state,
      location.key,
    ],
  );
}

/**
 * Like `useLocation`, but returns `null` when rendered outside a router instead
 * of throwing. For code shared between the routed app and the SDK, where the
 * facade router may be absent.
 */
export function useMaybeLocation(): Location | null {
  const location = useContext(RouterContext)?.location ?? null;

  return useMemo(
    () =>
      location
        ? {
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
            // v3 leaves state `undefined` when absent, v7 uses `null`.
            state: location.state ?? null,
            key: location.key,
          }
        : null,
    [location],
  );
}
