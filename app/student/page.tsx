import type { Metadata } from "next";
import { getSessionStudent, redirectIfPasswordChangeRequired } from "@/lib/student-auth";
import StudentPortal from "./StudentPortal";
import { redirect } from "next/navigation";
import { learningReturnPath, passwordChangeDestination } from "@/lib/learning-policy";
import { getSignedInAdult } from "@/lib/auth";
import { cache } from "react";
import { cookies } from "next/headers";
import { chosenLanguage, LANGUAGE_COOKIE } from "@/lib/language-choice";
import { studentPageTitle } from "@/lib/student-page-title";

export const dynamic = "force-dynamic";

type StudentPageProps = { searchParams: Promise<{ returnTo?: string; mode?: string; section?: string }> };
const sessionStudent = cache(getSessionStudent);

export async function generateMetadata({ searchParams }: StudentPageProps): Promise<Metadata> {
  const [{ section, mode }, student, cookieStore] = await Promise.all([searchParams, sessionStudent(), cookies()]);
  const language = chosenLanguage(cookieStore.get(LANGUAGE_COOKIE)?.value) ?? "en";
  return {
    title: studentPageTitle(Boolean(student), section, mode)[language === "bn" ? 1 : 0],
    description: "Sign in as a student to join classes, complete quizzes and view your Bangla learning results.",
  };
}

export default async function StudentPage({ searchParams }: StudentPageProps) {
  const { returnTo, mode, section } = await searchParams;
  const destination = returnTo && returnTo !== "/" ? learningReturnPath(returnTo) : "/student";
  const [student, adult] = await Promise.all([sessionStudent(), getSignedInAdult()]);
  // An adult still on an administrator-issued password goes to the change form first, as on every other page.
  if (adult?.mustChangePassword) redirect(passwordChangeDestination(destination));
  redirectIfPasswordChangeRequired(student);
  if (student && destination !== "/student") redirect(destination);
  return <StudentPortal initialStudent={student} destination={destination} initialMode={mode === "sign-up" ? "sign-up" : "sign-in"} initialSection={section} />;
}
