import { requireTeacher } from "@/lib/auth";
import { isLessonId } from "@/lib/lesson-approval";
import LessonStudio from "./LessonStudio";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lessons | Bangla Adventures", robots: { index: false, follow: false } };

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ lesson?: string }> }) {
  const user = await requireTeacher("/studio");
  const { lesson } = await searchParams;
  return <LessonStudio name={user.displayName} role={user.role === "admin" ? "admin" : "teacher"} initialLessonId={isLessonId(lesson) ? lesson : null} />;
}
