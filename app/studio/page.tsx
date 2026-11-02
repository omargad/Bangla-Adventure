import { requireTeacher } from "@/lib/auth";
import LessonStudio from "./LessonStudio";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lessons | Bangla Adventures", robots: { index: false, follow: false } };

// The studio reads the lesson to show (?lesson=) from the address itself; see LessonStudio.
export default async function StudioPage() {
  const user = await requireTeacher("/studio");
  return <LessonStudio name={user.displayName} role={user.role === "admin" ? "admin" : "teacher"} />;
}
