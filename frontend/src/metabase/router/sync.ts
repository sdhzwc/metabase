import type { History } from "history";

import { LOCATION_CHANGE } from "./location-change";

// Only the slice of the redux store `sync` actually touches. Declared
// structurally rather than as `Store<State>` so this leaf does not instantiate
// RTK's store generic against the whole app state.
type RoutingStore = {
  dispatch: (action: { type: string; payload: unknown }) => unknown;
  subscribe: (listener: () => void) => () => void;
};

/**
 * Re-owned equivalent of react-router-redux's `syncHistoryWithStore`, with the
 * live location tracked here instead of in the retired `routing` slice.
 *
 * Location flows history -> store: every transition dispatches LOCATION_CHANGE,
 * which the `isNavbarOpen` and `errorPage` reducers react to. The returned
 * history keeps its `listen` driven by the store, so the v3 `<Router>` — and
 * `router.listen`, which the dashboard tab sync relies on — is notified once per
 * change and only after redux has processed it. Deleted with the v3 engine.
 */
export function syncHistoryWithStore(
  history: History,
  store: RoutingStore,
): History {
  let currentLocation = history.getCurrentLocation();

  history.listen((location) => {
    currentLocation = location;
    store.dispatch({ type: LOCATION_CHANGE, payload: location });
  });

  // history@3 does not call listeners synchronously on subscribe, so mirror the
  // initial location into the store ourselves.
  store.dispatch({ type: LOCATION_CHANGE, payload: currentLocation });

  return {
    ...history,
    listen(listener) {
      let lastLocation = currentLocation;
      return store.subscribe(() => {
        if (currentLocation !== lastLocation) {
          lastLocation = currentLocation;
          listener(currentLocation);
        }
      });
    },
  };
}
