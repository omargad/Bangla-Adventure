import { requireAdult } from "@/lib/auth";
import { accountHome, canManageUsers } from "@/lib/roles";
import { redirect } from "next/navigation";
import AdminApprovals from "./AdminApprovals";
export const dynamic = "force-dynamic";
export const metadata = { title: "Who needs approval | Bangla Adventures", robots: { index: false, follow: false } };
export default async function Page() {
  const actor = await requireAdult("/admin/approvals");
  // Like /admin/classes and /admin/results: anyone else goes to their own home (a teacher to /teach).
  if (!canManageUsers(actor)) redirect(accountHome(actor));
  return <AdminApprovals name={actor.displayName} />;
}
