/**
 * Scrolls a page back to its top. On iPhones and iPads the portal's main column scrolls instead of the page
 * (app/portal.css), so that column is scrolled as well; elsewhere it does not scroll and only the page moves.
 */
export function scrollToTop(behavior: ScrollBehavior = "auto") {
  window.scrollTo({ top: 0, behavior });
  document.querySelector(".portal-workspace")?.scrollTo({ top: 0, behavior });
}
