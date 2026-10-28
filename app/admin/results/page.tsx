import { requireAdult } from "@/lib/auth";
import { accountHome, canManageUsers } from "@/lib/roles";
import { redirect } from "next/navigation";
import AdminResults from "./AdminResults";
export const dynamic = "force-dynamic";
export const metadata = { title: "Grades & results | Bangla Adventures", robots: { index: false, follow: false } };
export default async function Page() {
  const actor = await requireAdult("/admin/results");
  if (!canManageUsers(actor)) redirect(accountHome(actor));
  return <AdminResults name={actor.displayName} />;
}
