import { requireAdult } from "@/lib/auth";
import { accountHome, canManageUsers } from "@/lib/roles";
import { redirect } from "next/navigation";
import AdminClasses from "./AdminClasses";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await requireAdult("/admin/classes");
  // Like /admin/results and /admin/sources: anyone else goes to their own home (a teacher to /teach).
  if (!canManageUsers(actor)) redirect(accountHome(actor));
  return <AdminClasses name={actor.displayName} />;
}
