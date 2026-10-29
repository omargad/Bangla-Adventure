import { requireTeacher } from "@/lib/auth";
import { TOPIC_ID_PATTERN } from "@/lib/topic-model";
import TopicStudio from "./TopicStudio";

export const dynamic = "force-dynamic";
export const metadata = { title: "Topics | Bangla Adventures", robots: { index: false, follow: false } };

export default async function TopicsAreaPage({ searchParams }: { searchParams: Promise<{ topic?: string; version?: string; edit?: string; new?: string }> }) {
  const user = await requireTeacher("/teach/topics");
  const params = await searchParams;
  const { topic, version, edit } = params;
  const view = params.new === "1" ? { kind: "edit" as const, topicId: null }
    : edit && TOPIC_ID_PATTERN.test(edit) ? { kind: "edit" as const, topicId: edit }
    : topic && TOPIC_ID_PATTERN.test(topic) ? { kind: "review" as const, topicId: topic, version: version && /^\d{1,6}$/.test(version) ? Number(version) : null }
    : { kind: "list" as const };
  return <TopicStudio name={user.displayName} role={user.role === "admin" ? "admin" : "teacher"} initialView={view} />;
}
