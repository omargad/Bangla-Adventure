import { redirect } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
export const dynamic = "force-dynamic";
// The administrator-only curriculum editor became the shared Topics area.
export default async function Page() {
  await requireTeacher("/teach/topics");
  redirect("/teach/topics");
}
