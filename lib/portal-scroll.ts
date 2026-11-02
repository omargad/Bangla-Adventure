/**
 * On iPhones and iPads the portal's main column scrolls instead of the page (app/portal.css), and the browser puts back only
 * the page's own scroll on Back, Forward and reload. PortalShell keeps the column's offset for each address (with its #part,
 * if any) and puts it back when the page it shows is one of those returns. Elsewhere the column does not scroll, and
 * PortalShell leaves all scrolling to the browser.
 *
 * The root layout's PwaBridge imports this module, so its popstate listener is added before Next's own on every page: React
 * can commit the page that Back returns to while Next's listener runs, and the return must be known by then.
 */
let returningTo = "";
if (typeof window !== "undefined") {
  const load = performance.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
  if (load?.type === "reload" || load?.type === "back_forward") returningTo = location.href;
  window.addEventListener("popstate", () => { returningTo = location.href; });
}

/** Whether the page now showing is one that Back, Forward or a reload returned to, leaving the answer for takeReturn(). */
export function isReturn() { return returningTo === location.href; }

/** Whether the page now showing is one that Back, Forward or a reload returned to. Asking clears the answer. */
export function takeReturn() {
  const returning = returningTo === location.href;
  returningTo = "";
  return returning;
}

/** Keeps the column's offset at an address (a path, its search params and its #part, if any) for this tab; the top needs no record. */
export function keepOffset(address: string, top: number) {
  try {
    if (Math.round(top) > 0) sessionStorage.setItem(`portal-scroll:${address}`, String(Math.round(top)));
    else sessionStorage.removeItem(`portal-scroll:${address}`);
  } catch { /* storage unavailable */ }
}

/** The column's offset kept at an address: the top where none was kept. */
export function keptOffset(address: string) {
  try { return Number(sessionStorage.getItem(`portal-scroll:${address}`)) || 0; } catch { return 0; /* storage unavailable */ }
}
