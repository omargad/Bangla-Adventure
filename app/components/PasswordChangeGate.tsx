import type { ReactNode } from "react";
import { getSessionAdult } from "@/lib/auth";
import { getSessionStudent, redirectIfPasswordChangeRequired } from "@/lib/student-auth";
/** Learner pages outside LearningLayout still send a student with a temporary password to the change form. */
export default async function PasswordChangeGate({ children }: { children: ReactNode }) {
  if (!(await getSessionAdult())) redirectIfPasswordChangeRequired(await getSessionStudent());
  return children;
}
