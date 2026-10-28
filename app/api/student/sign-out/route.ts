import { browserLogoutResponse, destroyBrowserSessions } from "@/lib/browser-logout";
import { safeReturnPath } from "@/lib/safe-redirect";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const safeReturnTo = safeReturnPath(url.searchParams.get("returnTo"), "/student");
  await destroyBrowserSessions();
  return browserLogoutResponse(safeReturnTo);
}
