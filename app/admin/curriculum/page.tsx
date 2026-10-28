import { requireAdult } from "@/lib/auth";
import { redirect } from "next/navigation";
import CurriculumEditor from "./CurriculumEditor";
export const dynamic = "force-dynamic";
export default async function Page() {
  const user = await requireAdult("/admin/curriculum");
  if (user.role !== "admin") redirect("/family");
  return <CurriculumEditor name={user.displayName} />;
}
