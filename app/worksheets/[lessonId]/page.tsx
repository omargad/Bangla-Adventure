import Link from "next/link";
import { notFound } from "next/navigation";
import PrintButton from "../PrintButton";
import WorksheetSheet from "../WorksheetSheet";
import { Labelled, PageTitle, Say } from "../../components/PortalText";
import { getSessionAdult } from "@/lib/auth";
import { canTeach } from "@/lib/roles";
import { getSessionStudent } from "@/lib/student-auth";
import { homeLink } from "@/lib/home-link";
import { getApprovedLessonSnapshot, getCandidateLessonSnapshot } from "@/lib/lesson-approval";

type PageProps = { params: Promise<{ lessonId: string }> };
export const dynamic = "force-dynamic";

async function visibleSnapshot(lessonId: string) {
  const adult = await getSessionAdult();
  const staff = canTeach(adult);
  const snapshot = staff ? await getCandidateLessonSnapshot(lessonId) : await getApprovedLessonSnapshot(lessonId);
  return { adult, staff, snapshot };
}

export async function generateMetadata({ params }: PageProps) {
  const { lessonId } = await params;
  const { snapshot } = await visibleSnapshot(lessonId);
  if (!snapshot) return { title: "Worksheet not found | Bangla Adventures" };
  return { title: `Worksheet: ${snapshot.lesson.title} | Bangla Adventures`, description: "Printable practice from the available lesson version." };
}

/** Public worksheets use the same approved content snapshot as the adventure. */
export default async function WorksheetPage({ params }: PageProps) {
  const { lessonId } = await params;
  const { adult, staff, snapshot } = await visibleSnapshot(lessonId);
  if (!snapshot) notFound();
  const home = homeLink(adult, await getSessionStudent());
  return <main className="adult-app worksheets-app">
    <PageTitle title={[`Worksheet: ${snapshot.lesson.title} | Bangla Adventures`, `ওয়ার্কশিট: ${snapshot.lesson.titleBn} | Bangla Adventures`]} />
    <header className="adult-header worksheet-no-print">
      <Link className="adult-brand" href="/"><span>বা</span><span><strong>Bangla Adventures</strong><small><Say en="Printable worksheet" bn="প্রিন্ট করার ওয়ার্কশিট" /></small></span></Link>
      <Labelled as="nav" label={["Platform information", "প্ল্যাটফর্মের তথ্য"]}><Link href="/"><Say en="Learner site" bn="শেখার সাইট" /></Link><Link href="/worksheets"><Say en="All worksheets" bn="সব ওয়ার্কশিট" /></Link>{home && <a href={home.href}><Say en={home.label[0]} bn={home.label[1]} /></a>}</Labelled>
      <div className="adult-account"><PrintButton /></div>
    </header>
    <WorksheetSheet snapshot={snapshot} staffPreview={staff} />
  </main>;
}
