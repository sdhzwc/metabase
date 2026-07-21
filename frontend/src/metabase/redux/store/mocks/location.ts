import type { Location } from "history";

export const createMockLocation = (opts?: Partial<Location>): Location => {
  return {
    pathname: "/",
    search: "",
    query: {},
    hash: "",
    state: undefined,
    action: "POP",
    key: "", // can be null at runtime but the history typings type it as string
    ...opts,
  };
};
