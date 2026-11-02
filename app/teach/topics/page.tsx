import { requireTeacher } from "@/lib/auth";
import TopicStudio from "./TopicStudio";

export const dynamic = "force-dynamic";
export const metadata = { title: "Topics | Bangla Adventures", robots: { index: false, follow: false } };

// The studio reads what to show (?edit=, ?new=1, ?topic= and ?version=) from the address itself; see TopicStudio.
export default async function TopicsAreaPage() {
  const user = await requireTeacher("/teach/topics");
  return <TopicStudio name={user.displayName} role={user.role === "admin" ? "admin" : "teacher"} />;
}
