/* eslint-disable metabase/no-literal-metabase-strings -- dev-only guidance for data-app authors, not whitelabel-able product UI */
// Projects a captured store entry into the wire payload the reporter sends and
// the toolbar/agent read: the single-line `summary`, the collapsible `detail`,
// the actionable `hint`, and the `alert` flag. Kept out of the capture store
// (`components/DevToolbar/diagnostics.ts`), which no longer renders anything —
// this is the reporter's concern, not capture's.

import type { DevDiagnosticEntry } from "../components/DevToolbar/diagnostics";
import {
  type DataAppDiagnosticEntry,
  truncateDiagnosticText,
} from "../diagnostics-channel";

/**
 * Whether an SDK call failed — a transport error, or a non-2xx response. Failed
 * calls are surfaced like errors (badge, collapsed popover) rather than sitting
 * unseen in the Queries tab: a bad `POST /api/dataset` is exactly what an author
 * needs told about, and it never reaches `console.error`.
 */
export const isFailedSdkCall = (entry: DevDiagnosticEntry): boolean =>
  entry.kind === "sdk-call" &&
  (entry.error != null || (entry.status != null && entry.status >= 400));

/** The entries the toolbar badges and the popover surfaces. */
export const isAlert = (entry: DevDiagnosticEntry): boolean =>
  entry.kind === "error" ||
  entry.kind === "blocked-api" ||
  entry.kind === "blocked-network" ||
  entry.kind === "csp-violation" ||
  isFailedSdkCall(entry);

/** Format an entry as a single human-readable line. */
export const formatDevDiagnostic = (entry: DevDiagnosticEntry): string => {
  switch (entry.kind) {
    case "error":
    case "blocked-api":
      return entry.message;
    case "blocked-network":
      return `Blocked ${entry.api === "xhr" ? "XMLHttpRequest" : "fetch"} to ${entry.reason}`;
    case "csp-violation":
      return `Content Security Policy (${entry.directive}) blocked ${
        entry.blockedUri || "inline content"
      }`;
    case "sdk-call": {
      const status = entry.error ?? entry.status ?? "pending";
      return `${entry.method} ${entry.endpoint} → ${status} (${entry.durationMs}ms)`;
    }
    default: {
      const exhaustive: never = entry;
      return String(exhaustive);
    }
  }
};

// Written for someone who has never heard of a Content Security Policy: say what
// the app tried to do and which file to edit, not which directive was violated.
const CSP_DIRECTIVE_HINTS: Record<string, string> = {
  "connect-src":
    "Your app tried to call a URL it isn't allowed to reach. Add that URL's origin to allowed_hosts in data_app.yaml, then restart the dev server.",
  "form-action":
    "A form tried to submit to a URL the app isn't allowed to reach. Add that origin to allowed_hosts in data_app.yaml, or submit with fetch instead.",
  "frame-src":
    "Your app tried to embed another site in an iframe. Add that site's origin to allowed_hosts in data_app.yaml.",
  "script-src":
    "Your app tried to load a script from another site. Install the dependency and import it so it's bundled, instead of loading it from a CDN.",
  "style-src":
    "Your app tried to load a stylesheet from another site. Import the CSS so it's bundled instead.",
  "img-src":
    "Your app tried to load an image from a site it isn't allowed to reach. Add that origin to allowed_hosts in data_app.yaml, or bundle the image.",
  "font-src":
    "Your app tried to load a font from another site. Add that origin to allowed_hosts in data_app.yaml, or bundle the font.",
};

const CSP_FALLBACK_HINT =
  "Metabase restricts what a data app may load or contact, and the dev server applies the same rules. Anything the app needs to reach must be listed under allowed_hosts in data_app.yaml.";

/** An actionable one-liner for an entry, when we can compute one. */
export const devDiagnosticHint = (entry: DevDiagnosticEntry): string | null => {
  if (
    entry.kind === "blocked-network" &&
    entry.reason.includes("not in allowed_hosts")
  ) {
    try {
      return `Add ${new URL(entry.url).origin} to allowed_hosts in data_app.yaml (dev server restart required).`;
    } catch {
      return null;
    }
  }
  if (entry.kind === "csp-violation") {
    return CSP_DIRECTIVE_HINTS[entry.directive] ?? CSP_FALLBACK_HINT;
  }
  return null;
};

/**
 * Split a formatted entry into its headline and the rest — stack frames for an
 * `Error`, or the trailing lines of a multi-line driver message. The toolbar
 * shows the headline and hides the detail behind a disclosure, the way DevTools
 * does, so one long stack doesn't bury every entry under it.
 */
export const splitDevDiagnostic = (
  entry: DevDiagnosticEntry,
): { summary: string; detail: string | null } => {
  const text = formatDevDiagnostic(entry);
  const firstBreak = text.indexOf("\n");
  return firstBreak === -1
    ? { summary: text, detail: null }
    : {
        summary: text.slice(0, firstBreak),
        detail: text.slice(firstBreak + 1).replace(/\n+$/, ""),
      };
};

/**
 * Project a captured entry to the wire shape. No `eventId` — the dev server
 * assigns that on receipt. `summary`/`detail` are re-capped here because a
 * `console.error` with many args, or a structured field from the guest realm,
 * can exceed the per-arg bound applied at capture.
 */
export const toPayload = (
  entry: DevDiagnosticEntry,
): DataAppDiagnosticEntry => {
  const { summary, detail } = splitDevDiagnostic(entry);
  return {
    time: entry.time,
    kind: entry.kind,
    summary: truncateDiagnosticText(summary),
    detail: detail === null ? null : truncateDiagnosticText(detail),
    hint: devDiagnosticHint(entry),
    alert: isAlert(entry),
  };
};
