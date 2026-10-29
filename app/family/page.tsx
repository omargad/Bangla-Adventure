import { requireAdult } from "@/lib/auth";
import FamilyDashboard from "./FamilyDashboard";
import ParentDashboard from "./ParentDashboard";
import PortalFrame from "../components/PortalFrame";
import { approvedLessonIds } from "@/lib/lesson-approval";

export const dynamic = "force-dynamic";

export default async function FamilyPage() {
  const user = await requireAdult("/family");
  if (user.role === "parent") return <ParentDashboard parentName={user.displayName} />;
  return <PortalFrame role={user.role} name={user.displayName} active="family"><FamilyDashboard adultName={user.displayName} approvedLessonIds={await approvedLessonIds()} /></PortalFrame>;
}
