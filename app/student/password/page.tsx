import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionStudent, STUDENT_PASSWORD_PATH } from "@/lib/student-auth";
import StudentPasswordForm from "./StudentPasswordForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Change your password | Bangla Adventures",
  description: "Choose your own password for your Bangla Adventures student account.",
};

export default async function StudentPasswordPage() {
  const student = await getSessionStudent();
  if (!student) redirect(`/student?returnTo=${encodeURIComponent(STUDENT_PASSWORD_PATH)}`);
  return <StudentPasswordForm name={student.displayName} username={student.username} required={student.mustChangePassword} />;
}
