import { requireAdult } from "@/lib/auth";
import { canManageUsers } from "@/lib/roles";
import { redirect } from "next/navigation";
import AdminClasses from "./AdminClasses";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await requireAdult("/admin/classes");
  if (!canManageUsers(actor)) redirect("/family");
  return <AdminClasses name={actor.displayName} />;
}
