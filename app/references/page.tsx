import type { Metadata } from "next";
import LearningLayout from "../components/LearningLayout";
import { getSessionAdult } from "@/lib/auth";
import { getSessionStudent } from "@/lib/student-auth";
import { getLibraryCatalog } from "@/lib/library-catalog";
import { studentClassSources } from "@/lib/class-sources";
import ReferencesView from "./ReferencesView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sources & references | Bangla Adventures" };

export default async function References() {
  const [adult, student] = await Promise.all([getSessionAdult(), getSessionStudent()]);
  // As in LearningLayout, a signed-in adult sees the page as that adult; only students have class sources here.
  const learner = !adult && student && !student.mustChangePassword ? student : null;
  const [books, classSources] = await Promise.all([
    getLibraryCatalog(),
    learner ? studentClassSources(learner.id).catch(() => null) : null,
  ]);
  return <LearningLayout active="references"><ReferencesView books={books} classSources={classSources} /></LearningLayout>;
}
