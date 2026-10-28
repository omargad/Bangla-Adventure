import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionAdult } from "@/lib/auth";
import { getSessionStudent, redirectIfPasswordChangeRequired } from "@/lib/student-auth";
import PortalFrame from "./PortalFrame";
export default async function LearningLayout({ children, active }: { children: ReactNode; active?: string }) {
  const student = await getSessionStudent();
  const adult = await getSessionAdult();
  if (!student && !adult) redirect("/welcome");
  if (!adult) redirectIfPasswordChangeRequired(student);
  return <PortalFrame role={adult?.role ?? "student"} name={adult?.displayName ?? student!.displayName} active={active}>{children}</PortalFrame>;
}
