import { type Ref, forwardRef } from "react";
import {
  Link as V7Link,
  type LinkProps as V7LinkProps,
  NavLink as V7NavLink,
} from "react-router-v7";

import type { RouterLinkProps } from "./react-router";

type V3To = RouterLinkProps["to"];

// v3 descriptors carry the query as a `query` object and `state` inline; v7 uses
// a `search` string and a separate `state` prop. Translate so existing call sites
// keep working on v7.
function toV7Target(to: V3To): { to: V7LinkProps["to"]; state?: unknown } {
  if (to == null || typeof to === "string") {
    return { to: to ?? "" };
  }
  if (typeof to === "function") {
    // v3's function form of `to` has no v7 analog and is not used in the app.
    return { to: "" };
  }
  const { pathname, search, hash, query, state } = to;
  const searchString =
    search ?? (query ? `?${new URLSearchParams(query).toString()}` : undefined);
  return {
    to: { pathname: pathname ?? "", search: searchString, hash },
    state,
  };
}

interface Props extends Omit<RouterLinkProps, "to"> {
  // Optional: a link with no destination is used as a button, navigating through
  // its own `onClick`.
  to?: V3To;
  // v3's ref-forwarding prop; the facade's `ForwardRefLink` still passes it.
  innerRef?: Ref<HTMLAnchorElement>;
}

export const RouterLink = forwardRef<HTMLAnchorElement, Props>(
  function RouterLink({ to, innerRef, ...props }, ref) {
    const linkRef = ref ?? innerRef;
    // v3-only props v7's `<Link>` does not accept.
    const { activeClassName, activeStyle, onlyActiveOnIndex, ...rest } = props;

    // A `<Link>` with no destination is used as a button: it navigates through
    // its `onClick`. v7's `<Link>` would additionally navigate to the current
    // route on click, clobbering any push the handler performs, so render a
    // plain anchor instead.
    if (to == null) {
      return <a {...rest} ref={linkRef} />;
    }

    const { to: v7To, state } = toV7Target(to);

    // v3's `<Link>` highlighted itself when its route was active via
    // `activeClassName`/`activeStyle` (and `onlyActiveOnIndex` for an exact
    // match). v7 moved that to `<NavLink>`, so route it there when a call site
    // asks for active styling; a plain `<Link>` would silently drop it.
    if (activeClassName != null || activeStyle != null) {
      const { className, style, ...navRest } = rest;
      return (
        <V7NavLink
          {...navRest}
          to={v7To}
          state={state}
          ref={linkRef}
          end={onlyActiveOnIndex}
          className={({ isActive }) =>
            [className, isActive ? activeClassName : null]
              .filter(Boolean)
              .join(" ")
          }
          style={({ isActive }) =>
            isActive ? { ...style, ...activeStyle } : style
          }
        />
      );
    }

    return <V7Link {...rest} to={v7To} state={state} ref={linkRef} />;
  },
);
