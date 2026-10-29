import { useEffect } from "react";

/**
 * While `active` (something on screen would be lost), ask `question` before a reload, closing the tab
 * or following an in-app link, and report the state through onActiveChange so a parent that would
 * unmount the panel can ask first too.
 */
export function useLeaveGuard(active: boolean, question: string, onActiveChange?: (active: boolean) => void) {
  useEffect(() => {
    onActiveChange?.(active);
    if (!active) return;
    let leaving = false;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (leaving) return;
      event.preventDefault();
      event.returnValue = "";
    };
    // In-app links change the page without unloading it, so ask when one is clicked.
    const followLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (window.confirm(question)) leaving = true;
      else { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", followLink, true);
    return () => {
      onActiveChange?.(false);
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", followLink, true);
    };
  }, [active, question, onActiveChange]);
}
