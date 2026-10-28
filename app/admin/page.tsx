import Link from "next/link";
import { requireAdult } from "@/lib/auth";
import { accountHome, canManageUsers } from "@/lib/roles";
import UserManagement from "./UserManagement";

export const dynamic = "force-dynamic";
export const metadata = { title: "User management | Bangla Adventures", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const actor = await requireAdult("/admin");
  if (!canManageUsers(actor)) return <main className="access-panel"><h1>Administrator access required</h1><p>You are signed in as <strong>{actor.email}</strong> ({actor.role}). This account cannot manage other users.</p><div className="access-actions"><Link className="primary-button" href="/grown-ups?returnTo=%2Fadmin&switchAccount=1">Sign in as administrator</Link><Link className="outline-button" href={accountHome(actor)}>Back to my dashboard</Link></div></main>;
  return <UserManagement actorId={actor.id} actorName={actor.displayName} />;
}
