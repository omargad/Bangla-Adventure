import Link from "next/link";
import { lessons, levelBands } from "../curriculum";
import { getSessionAdult } from "@/lib/auth";
import { canTeach } from "@/lib/roles";
import { getCandidateLessonSnapshot, learnerLessonView } from "@/lib/lesson-approval";
import { localNumber } from "@/lib/local-format";
import { Labelled, PageTitle, Say } from "../components/PortalText";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Printable worksheets | Bangla Adventures",
  description:
    "Print-friendly practice sheets for all 18 lessons: vocabulary tracing, sentence patterns, reading, writing and the family mission.",
};

/** A lesson's time on screen in Bangla ("20 min" is "২০ মিনিট"). */
function durationBn(duration: string) {
  return duration.replace(/\d+/g, (value) => localNumber(Number(value), "bn")).replace(" min project", " মিনিটের প্রজেক্ট").replace(" min", " মিনিট");
}

/** Learners and parents get worksheets for approved lessons only; staff see every lesson. */
export default async function WorksheetsIndexPage() {
  const staff = canTeach(await getSessionAdult());
  const shown = staff
    ? (await Promise.all(lessons.map((lesson) => getCandidateLessonSnapshot(lesson.id)))).flatMap((snapshot) => snapshot ? [snapshot.lesson] : [])
    : Object.values((await learnerLessonView()).snapshots).map((snapshot) => snapshot.lesson);
  const descriptorsBn: Record<string, string> = {
    "pre-a1": "ছবি আর সহায়তা নিয়ে কয়েকটি পরিচিত বাংলা শব্দ চিনতে ও বলতে পারি।",
    a1: "নিজের পরিচয়, খাবার, পরিবার আর দৈনন্দিন কাজ নিয়ে ছোট, অনুশীলিত বাক্য বলতে পারি।",
    a2: "সহজ দৈনন্দিন কথাবার্তায় অংশ নিতে এবং কয়েকটি বাক্য জুড়তে পারি।",
    b1: "পরিচিত বিষয়ের মূল কথা বুঝে স্পষ্টভাবে গল্প বলতে ও কারণ জানাতে পারি।",
    b2: "ধারণা তুলনা করতে, সাংস্কৃতিক বিষয় ব্যাখ্যা করতে এবং বিস্তারিত বিষয়বস্তু বুঝতে পারি।",
    "c1-c2": "ভিন্ন শ্রোতার জন্য বাংলায় ব্যাখ্যা, গবেষণা, আলোচনা ও সৃজনশীল কাজ করতে পারি।",
  };
  return (
    <main className="adult-app worksheets-app">
      <PageTitle title={["Printable worksheets | Bangla Adventures", "প্রিন্ট করার ওয়ার্কশিট | Bangla Adventures"]} />
      <header className="adult-header">
        <Link className="adult-brand" href="/"><span>বা</span><span><strong>Bangla Adventures</strong><small><Say en="Printable worksheets" bn="প্রিন্ট করার ওয়ার্কশিট" /></small></span></Link>
        <Labelled as="nav" label={["Platform information", "প্ল্যাটফর্মের তথ্য"]}><Link href="/"><Say en="Learner site" bn="শেখার সাইট" /></Link><Link className="active" href="/worksheets"><Say en="Worksheets" bn="ওয়ার্কশিট" /></Link><Link href="/resources"><Say en="Resources" bn="সম্পদ" /></Link><Link href="/certificate"><Say en="Certificates" bn="সনদ" /></Link><a href="/family"><Say en="Grown-up dashboard" bn="বড়দের ড্যাশবোর্ড" /></a><a href="/safety"><Say en="Safety & access" bn="নিরাপত্তা ও প্রবেশ" /></a></Labelled>
        <div className="adult-account"><span><Say en="Free to print and share" bn="বিনা খরচে প্রিন্ট ও শেয়ার করুন" /></span></div>
      </header>

      <div className="adult-content">
        <section className="adult-hero">
          <div>
            <p className="adult-eyebrow"><Say en="Off-screen practice" bn="স্ক্রিনের বাইরে অনুশীলন" /></p>
            <h1><Say en="One printable worksheet for every lesson." bn="প্রতিটি পাঠের জন্য একটি প্রিন্ট করার ওয়ার্কশিট।" /></h1>
            <p>
              <Say
                en="Each available sheet uses its approved lesson version: vocabulary writing practice, sentence patterns, bilingual reading, writing and a family mission. Staff can preview the versions waiting for Admin review."
                bn="প্রতিটি উপলভ্য শিটে অনুমোদিত পাঠের সংস্করণ থাকে: শব্দ লেখা, বাক্যের ধাঁচ, দুই ভাষায় পড়া, লেখার কাজ আর পরিবারের সঙ্গে করার কাজ। কর্মীরা প্রশাসকের পর্যালোচনার অপেক্ষায় থাকা সংস্করণও দেখতে পারেন।"
              />
            </p>
          </div>
        </section>

        {shown.length === 0 && <p role="status"><Say en="Worksheets will appear after an Admin approves the lessons." bn="প্রশাসক পাঠগুলো অনুমোদন করলে ওয়ার্কশিট এখানে দেখা যাবে।" /></p>}

        {levelBands.map((band) => {
          const bandLessons = shown.filter((lesson) => lesson.level === band.id);
          if (bandLessons.length === 0) return null;
          return (
            <section key={band.id} className="worksheet-band">
              <h2>
                <span className="worksheet-band-code">{band.code}</span> <span lang="en">{band.title}</span> · <span lang="bn">{band.titleBn}</span>
              </h2>
              <p><Say en={band.descriptor} bn={descriptorsBn[band.id]} /></p>
              <ul className="worksheet-list">
                {bandLessons.map((lesson) => (
                  <li key={lesson.id}>
                    <Link href={`/worksheets/${lesson.id}`}>
                      <strong lang="en">
                        {lesson.number}. {lesson.title}
                      </strong>
                      <span lang="bn">{lesson.titleBn}</span>
                      <small><Say en={`${lesson.duration} on screen · 1–2 pages printed`} bn={`স্ক্রিনে ${durationBn(lesson.duration)} · ছাপলে ১–২ পাতা`} /></small>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}
