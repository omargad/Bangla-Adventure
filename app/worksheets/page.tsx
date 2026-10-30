import Link from "next/link";
import { lessons, levelBands } from "../curriculum";
import { getSessionAdult } from "@/lib/auth";
import { canTeach } from "@/lib/roles";
import { approvedLessonIds } from "@/lib/lesson-approval";
import { visibleLessons } from "@/lib/lesson-model";
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
  const shown = canTeach(await getSessionAdult()) ? lessons : visibleLessons(lessons, await approvedLessonIds());
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
                en="Each sheet mirrors its on-screen lesson: the six vocabulary words with space to write, both sentence patterns, a short bilingual reading with a comprehension check, a guided writing task and the family mission. Made for kitchen tables and community-school classrooms — no login, no ink-heavy artwork."
                bn="প্রতিটি শিট তার অনলাইন পাঠের মতোই: লেখার জায়গাসহ ছয়টি শব্দ, দুটি বাক্যের ধাঁচ, বোঝার প্রশ্নসহ দুই ভাষায় ছোট একটি পড়া, ধাপে ধাপে লেখার কাজ আর পরিবারের সঙ্গে করার কাজ। বাড়ির টেবিল আর কমিউনিটি স্কুলের ক্লাসের জন্য বানানো — লগইন লাগে না, বেশি কালিও খরচ হয় না।"
              />
            </p>
          </div>
        </section>

        {levelBands.map((band) => {
          const bandLessons = shown.filter((lesson) => lesson.level === band.id);
          if (bandLessons.length === 0) return null;
          return (
            <section key={band.id} className="worksheet-band">
              <h2>
                <span className="worksheet-band-code">{band.code}</span> <span lang="en">{band.title}</span> · <span lang="bn">{band.titleBn}</span>
              </h2>
              <p lang="en">{band.descriptor}</p>
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
