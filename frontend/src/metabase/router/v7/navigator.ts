import type { NavigateFunction, NavigateOptions, To } from "react-router-v7";

import type { RouterNavigator } from "../middleware";
import type { LocationDescriptor } from "../types";

import { queryToSearch } from "./location";

/**
 * The live v7 `navigate`, registered by `V7ReduxBridge` once the router mounts.
 * The redux navigator adapter is built at store creation, before the router
 * exists, so it reads `navigate` through this holder rather than capturing it.
 */
let currentNavigate: NavigateFunction | null = null;

export function setV7Navigate(navigate: NavigateFunction | null): void {
  currentNavigate = navigate;
}

/**
 * Turn a v3 `LocationDescriptor` (string or `{ pathname, search, hash, state }`)
 * into v7 `navigate(to, options)` arguments. Shared by the imperative-router
 * shim and the redux navigator so both map descriptors the same way.
 */
export function toNavigateArgs(
  location: LocationDescriptor,
  options: NavigateOptions = {},
): [To, NavigateOptions] {
  if (typeof location === "string") {
    return [location, options];
  }
  // history@3 encoded a descriptor's `query` object into the URL itself; v7 only
  // reads `search`, so serialize it here. An explicit `query` wins over `search`,
  // matching how v3 rebuilt the search string from it.
  const search =
    location.query != null ? queryToSearch(location.query) : location.search;
  return [
    {
      pathname: location.pathname,
      search,
      hash: location.hash,
    },
    { ...options, state: location.state },
  ];
}

/**
 * A `RouterNavigator` (the subset of `history` that `routerMiddleware` drives)
 * backed by the live v7 `navigate`. Passed to the store on v7 so
 * `dispatch(push(...))` navigates the v7 router. Calls before the router mounts
 * are dropped, matching the pre-mount no-op window on v3.
 */
export function createV7Navigator(): RouterNavigator {
  const navigate = (to: To | number, options?: NavigateOptions) => {
    if (typeof to === "number") {
      currentNavigate?.(to);
    } else {
      currentNavigate?.(to, options);
    }
  };

  return {
    push: (location) => navigate(...toNavigateArgs(location)),
    replace: (location) =>
      navigate(...toNavigateArgs(location, { replace: true })),
    go: (n) => navigate(n),
    goBack: () => navigate(-1),
    goForward: () => navigate(1),
  };
}
