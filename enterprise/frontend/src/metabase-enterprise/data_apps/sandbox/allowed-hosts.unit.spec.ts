import {
  type SandboxRealm,
  isHostAllowed,
  isValidAllowedHostEntry,
  makeSandboxFetch,
  makeSandboxXhr,
} from "./allowed-hosts";

const u = (href: string) => new URL(href);

describe("isValidAllowedHostEntry — backend parity", () => {
  // The WHATWG URL parser accepts these; the backend's `allowed-host-re` does
  // not. Accepting them here would green-light a manifest that 400s on sync,
  // which defeats the point of validating locally.
  it.each([
    "https://internal_api.acme.com",
    "https://[::1]",
    "https://münchen.de",
    "https://api.example.com.",
    "https://api.example.com/v1",
    "ftp://example.com",
  ])("rejects %s, which remote-sync would reject", (entry) => {
    expect(isValidAllowedHostEntry(entry)).toBe(false);
  });

  it.each([
    "https://api.example.com",
    "https://*.internal.acme.com",
    "http://localhost:3000",
    // normalized first, as the backend does
    "  HTTPS://API.EXAMPLE.COM/  ",
  ])("accepts %s", (entry) => {
    expect(isValidAllowedHostEntry(entry)).toBe(true);
  });

  it("does not change what the sandbox allows at runtime", () => {
    // This validator is advisory — it reports what remote-sync would reject. An
    // app already running with such a host must keep its egress, so tightening
    // validation must never be "unified" into `isHostAllowed`.
    const entry = "https://internal_api.acme.com";

    expect(isValidAllowedHostEntry(entry)).toBe(false);
    expect(
      isHostAllowed(u("https://internal_api.acme.com/data"), [entry]),
    ).toBe(true);
  });
});

describe("isHostAllowed", () => {
  it("matches an exact host (ignoring path)", () => {
    expect(
      isHostAllowed(u("https://api.example.com/v1/x"), [
        "https://api.example.com",
      ]),
    ).toBe(true);
  });

  it("rejects a different host", () => {
    expect(
      isHostAllowed(u("https://evil.example.org/"), [
        "https://api.example.com",
      ]),
    ).toBe(false);
  });

  it("rejects a protocol mismatch", () => {
    expect(
      isHostAllowed(u("http://api.example.com/"), ["https://api.example.com"]),
    ).toBe(false);
  });

  it("matches subdomains for a wildcard but not the apex", () => {
    const allow = ["https://*.example.com"];
    expect(isHostAllowed(u("https://a.example.com/"), allow)).toBe(true);
    expect(isHostAllowed(u("https://a.b.example.com/"), allow)).toBe(true);
    expect(isHostAllowed(u("https://example.com/"), allow)).toBe(false);
    expect(isHostAllowed(u("https://notexample.com/"), allow)).toBe(false);
  });

  it("matches an explicit port exactly; an entry without a port matches any", () => {
    expect(
      isHostAllowed(u("https://api.example.com:8443/"), [
        "https://api.example.com:8443",
      ]),
    ).toBe(true);
    expect(
      isHostAllowed(u("https://api.example.com:9999/"), [
        "https://api.example.com:8443",
      ]),
    ).toBe(false);
    // an entry without a port matches any port
    expect(
      isHostAllowed(u("https://api.example.com:8443/"), [
        "https://api.example.com",
      ]),
    ).toBe(true);
  });

  it("treats an explicit default port the same as none (agrees with CSP)", () => {
    // `URL` strips the default port (`:443`/`:80` → ""), so an entry that spells
    // it out must still match a default-port request — otherwise the JS allowlist
    // would disagree with the browser's CSP matching.
    expect(
      isHostAllowed(u("https://api.example.com/"), [
        "https://api.example.com:443",
      ]),
    ).toBe(true);
    expect(
      isHostAllowed(u("http://api.example.com/"), [
        "http://api.example.com:80",
      ]),
    ).toBe(true);
  });

  it("denies everything for an empty allowlist", () => {
    expect(isHostAllowed(u("https://api.example.com/"), [])).toBe(false);
  });
});

describe("makeSandboxFetch", () => {
  const base = "https://mb.example.com/embed/apps/sales";
  const origin = "https://mb.example.com";

  const fakeWindow = (fetch: typeof global.fetch): SandboxRealm => ({
    fetch,
    XMLHttpRequest,
    location: { href: base, origin },
  });

  it("returns null for an empty allowlist (keeps the sandbox hard block)", () => {
    expect(makeSandboxFetch(window, [], "sales")).toBeNull();
  });

  it("allows listed hosts and blocks others", async () => {
    const realFetch = jest.fn(() => Promise.resolve(new Response("ok")));
    const sandboxFetch = makeSandboxFetch(
      fakeWindow(realFetch),
      ["https://api.example.com"],
      "sales",
    );
    expect(sandboxFetch).not.toBeNull();

    await sandboxFetch!("https://api.example.com/data");
    expect(realFetch).toHaveBeenCalledTimes(1);

    await expect(sandboxFetch!("https://evil.example.org/")).rejects.toThrow(
      /blocked fetch/,
    );
    expect(realFetch).toHaveBeenCalledTimes(1);
  });

  it("always blocks the Metabase origin, even if it's in allowed_hosts", async () => {
    const realFetch = jest.fn(() => Promise.resolve(new Response("ok")));
    // The Metabase origin is mistakenly allowlisted — it must still be denied.
    const sandboxFetch = makeSandboxFetch(
      fakeWindow(realFetch),
      [origin, "https://api.example.com"],
      "sales",
    )!;

    await expect(sandboxFetch(`${origin}/api/user/current`)).rejects.toThrow(
      /Metabase origin/,
    );
    // A relative URL resolves to the Metabase origin too.
    await expect(sandboxFetch("/api/user/current")).rejects.toThrow(
      /Metabase origin/,
    );
    expect(realFetch).not.toHaveBeenCalled();
  });
});

describe("makeSandboxXhr", () => {
  // jsdom's window origin is http://localhost — treat that as the Metabase origin.
  const mbOrigin = window.location.origin;

  it("returns null for an empty allowlist", () => {
    expect(makeSandboxXhr(window, [], "sales")).toBeNull();
  });

  it("gates open() against the allowlist", () => {
    const SandboxXhr = makeSandboxXhr(
      window,
      ["https://api.example.com"],
      "sales",
    );
    expect(SandboxXhr).not.toBeNull();

    const xhr = new SandboxXhr!();
    expect(() => xhr.open("GET", "https://evil.example.org/")).toThrow(
      /blocked XMLHttpRequest/,
    );
    // Allowed host: open() should not throw.
    expect(() => xhr.open("GET", "https://api.example.com/data")).not.toThrow();
  });

  it("always blocks the Metabase origin, even if it's in allowed_hosts", () => {
    const SandboxXhr = makeSandboxXhr(
      window,
      [mbOrigin, "https://api.example.com"],
      "sales",
    )!;
    const xhr = new SandboxXhr();
    expect(() => xhr.open("GET", `${mbOrigin}/api/user/current`)).toThrow(
      /Metabase origin/,
    );
    expect(() => xhr.open("GET", "/api/user/current")).toThrow(
      /Metabase origin/,
    );
  });
});

describe("onBlocked reporting", () => {
  const base = "https://mb.example.com/embed/apps/sales";
  const origin = "https://mb.example.com";
  const fakeWindow = (fetch: typeof global.fetch): SandboxRealm => ({
    fetch,
    XMLHttpRequest,
    location: { href: base, origin },
  });

  it("reports a blocked fetch, and stays silent when no listener is given", async () => {
    const realFetch = jest.fn(() => Promise.resolve(new Response("ok")));
    const onBlocked = jest.fn();

    const reporting = makeSandboxFetch(
      fakeWindow(realFetch),
      ["https://api.example.com"],
      "sales",
      onBlocked,
    )!;
    await expect(reporting("https://evil.example.org/x")).rejects.toThrow();

    expect(onBlocked).toHaveBeenCalledWith(
      // `type: "network"` is added a layer up, in `distortions.ts`.
      expect.objectContaining({
        api: "fetch",
        url: "https://evil.example.org/x",
        reason: expect.stringContaining("not in allowed_hosts"),
      }),
    );

    // Production passes no listener; that path must be unchanged.
    const silent = makeSandboxFetch(
      fakeWindow(realFetch),
      ["https://api.example.com"],
      "sales",
    )!;
    await expect(silent("https://evil.example.org/x")).rejects.toThrow();
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("still blocks when the listener throws", async () => {
    const realFetch = jest.fn(() => Promise.resolve(new Response("ok")));
    const sandboxFetch = makeSandboxFetch(
      fakeWindow(realFetch),
      ["https://api.example.com"],
      "sales",
      () => {
        throw new Error("listener exploded");
      },
    )!;

    // A broken reporter must not become a way through the allowlist.
    await expect(sandboxFetch("https://evil.example.org/")).rejects.toThrow();
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("reports a request whose toString throws, rather than losing the block", async () => {
    const realFetch = jest.fn(() => Promise.resolve(new Response("ok")));
    const onBlocked = jest.fn();
    const sandboxFetch = makeSandboxFetch(
      fakeWindow(realFetch),
      ["https://api.example.com"],
      "sales",
      onBlocked,
    )!;

    // A guest-realm value: unparseable, and hostile when stringified. The block
    // must still be recorded, or an app could hide its own blocked calls.
    const hostile = {
      toString() {
        throw new Error("nope");
      },
    };

    await expect(
      // Deliberately not a RequestInfo: the point is a guest value the wrapper
      // can neither parse nor safely stringify.
      sandboxFetch(hostile as unknown as RequestInfo),
    ).rejects.toThrow();
    expect(onBlocked).toHaveBeenCalledWith(
      expect.objectContaining({ url: "(unreadable request)" }),
    );
    expect(realFetch).not.toHaveBeenCalled();
  });
});
