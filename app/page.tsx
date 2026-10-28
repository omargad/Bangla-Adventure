import { redirect } from "next/navigation";
import { getSessionStatus } from "@/lib/session-status";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSessionStatus();
  if (!session.authenticated) redirect("/welcome");
  const query = await searchParams;
  const practice = new URLSearchParams();
  for (const key of ["module", "learner"]) {
    if (typeof query[key] === "string" && query[key]) practice.set(key, query[key]);
  }
  if (practice.size) redirect(`/adventure?${practice}`);
  redirect(session.home);
}
