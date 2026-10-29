import { redirect } from "next/navigation";
import { requireAdult } from "@/lib/auth";
import { accountHome, canManageUsers } from "@/lib/roles";
import AdminSources from "./AdminSources";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sources | Bangla Adventures", robots: { index: false, follow: false } };

export default async function Page() {
  const actor = await requireAdult("/admin/sources");
  if (!canManageUsers(actor)) redirect(accountHome(actor));
  return <AdminSources name={actor.displayName} />;
}
