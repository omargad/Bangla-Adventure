import { browserLogoutResponse, destroyBrowserSessions } from "@/lib/browser-logout";
import { safeReturnPath } from "@/lib/safe-redirect";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const safeReturnTo = safeReturnPath(url.searchParams.get("returnTo"), "/student");
  try {
    await destroyBrowserSessions();
  } catch (error) {
    // As in the adult sign-out: the cookies are cleared regardless, so a database fault cannot leave this browser signed in.
    console.error("GET /api/student/sign-out:", error);
  }
  return browserLogoutResponse(safeReturnTo);
}
