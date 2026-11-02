import type { Metadata } from "next";
import TopicsHub from "./TopicsHub";
import LearningLayout from "../components/LearningLayout";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Classroom topics — culture, history & literature | Bangla Adventures",
  description:
    "Kid-friendly readings about Bangladesh's history, festivals, literature and arts — each traced to the NCTB government textbook that covers it, with a short quiz to show your teacher.",
};

// The page reads the topic to open (?topic=) from the address itself; see TopicsHub.
export default async function TopicsPage() {
  return <LearningLayout active="topics"><TopicsHub /></LearningLayout>;
}
