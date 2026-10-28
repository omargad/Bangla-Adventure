import { requireAdult } from "@/lib/auth";
import TeacherDashboard from "./TeacherDashboard";
import TeacherAccess from "./TeacherAccess";
import { canTeach } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function TeachPage() {
  const user = await requireAdult("/teach");
  if (!canTeach(user)) return <TeacherAccess name={user.displayName} status={user.teacherStatus} />;
  return <TeacherDashboard teacherName={user.displayName} isAdmin={user.role === "admin"} />;
}
