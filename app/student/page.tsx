import type { Metadata } from "next";
import { getSessionStudent, redirectIfPasswordChangeRequired } from "@/lib/student-auth";
import StudentPortal from "./StudentPortal";
import { redirect } from "next/navigation";
import { learningReturnPath } from "@/lib/learning-policy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Student login | Bangla Adventures",
  description: "Sign in as a student to join classes, complete quizzes and view your Bangla learning results.",
};

export default async function StudentPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; mode?: string; section?: string }> }) {
  const { returnTo, mode, section } = await searchParams;
  const destination = returnTo && returnTo !== "/" ? learningReturnPath(returnTo) : "/student";
  const student = await getSessionStudent();
  redirectIfPasswordChangeRequired(student);
  if (student && destination !== "/student") redirect(destination);
  return <StudentPortal initialStudent={student} destination={destination} initialMode={mode === "sign-up" ? "sign-up" : "sign-in"} initialSection={section} />;
}
