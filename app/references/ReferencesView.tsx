"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/use-language";
import { NCTB_PORTAL_URL } from "../library-content";
import type { CatalogBook } from "@/lib/library-links";
import type { StudentClassSources } from "@/lib/class-sources";
import ReferenceNote from "./ReferenceNote";
import SourceLinks from "./SourceLinks";
import ClassSourceList from "./ClassSourceList";

/**
 * Sources & references in the reader's language: a student's own class sources
 * first (classSources is null for everyone else), then the NCTB textbooks with
 * the links the administrator keeps up to date each year.
 */
export default function ReferencesView({ books, classSources }: { books: CatalogBook[]; classSources: StudentClassSources | null }) {
  const [language] = useLanguage({ title: ["Sources & references | Bangla Adventures", "উৎস ও তথ্যসূত্র | Bangla Adventures"] });
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const other = language === "bn" ? "en" : "bn";
  return (
    <section lang={language} className="references-page">
      <h1>{s("Sources & references", "উৎস ও তথ্যসূত্র")}</h1>
      <ReferenceNote note="intro" />

      {classSources && (
        <section className="teach-panel class-sources-panel" aria-label={s("My class sources", "আমার ক্লাসের উৎস")}>
          <h2>{s("My class sources", "আমার ক্লাসের উৎস")}</h2>
          {classSources.length === 0 ? (
            <p>{s("When a teacher adds you to a class, the sources your teacher picks for that class appear here.", "শিক্ষক তোমাকে কোনো ক্লাসে যোগ করলে সেই ক্লাসের জন্য শিক্ষকের বাছাই করা উৎস এখানে দেখা যাবে।")}</p>
          ) : classSources.map((classroom) => (
            <section className="class-sources-class" key={classroom.classId} aria-label={classroom.className}>
              <h3>{classroom.className}</h3>
              <p className="teach-note">{s("Teacher", "শিক্ষক")}: {classroom.teacherName}</p>
              {classroom.sources.length === 0
                ? <p>{s("Your teacher has not added sources for this class yet.", "তোমার শিক্ষক এখনো এই ক্লাসের জন্য কোনো উৎস যোগ করেননি।")}</p>
                : <ClassSourceList sources={classroom.sources} language={language} />}
            </section>
          ))}
        </section>
      )}

      <div className="teach-panel">
        <h2>{s("National Curriculum and Textbook Board, Bangladesh", "জাতীয় শিক্ষাক্রম ও পাঠ্যপুস্তক বোর্ড, বাংলাদেশ")}</h2>
        <p>{s(
          "The main source collection for the platform's culture, history and literature topics. Each book links to its page on the NCTB website, or to this year's edition when the administrator has added it. Check the title, class and edition against the original book.",
          "প্ল্যাটফর্মের সংস্কৃতি, ইতিহাস ও সাহিত্যের বিষয়গুলোর প্রধান উৎস। প্রতিটি বই এনসিটিবি ওয়েবসাইটে তার পাতায় নিয়ে যায়, আর প্রশাসক এ বছরের সংস্করণ যোগ করলে সেখানে। মূল বইয়ের সঙ্গে নাম, শ্রেণি ও সংস্করণ মিলিয়ে নিন।",
        )}</p>
        <div className="references-actions">
          <a className="outline-button" href={NCTB_PORTAL_URL} target="_blank" rel="noreferrer">{s("Official NCTB website", "এনসিটিবির সরকারি ওয়েবসাইট")}</a>
          <Link className="outline-button" href="/books">{s("Audited textbook source records", "যাচাই করা পাঠ্যবইয়ের উৎস-নথি")}</Link>
          <Link className="outline-button" href="/library">{s("Browse the textbook library", "পাঠ্যবই লাইব্রেরি দেখুন")}</Link>
        </div>
      </div>

      <div className="portal-topic-grid">
        {books.map((book) => {
          const title = language === "bn" ? book.titleBn : book.titleEn;
          return (
            <article className="teach-panel" key={book.id} aria-label={title}>
              <h2>{title}</h2>
              <p lang={other}>{language === "bn" ? book.titleEn : book.titleBn}</p>
              <p>{book.classes[language]}</p>
              {book.covers[language] && <p>{book.covers[language]}</p>}
              <SourceLinks links={book.links} language={language} bookTitle={title} />
              {book.chapterMaps?.map((map) => (
                <p key={map.volume.en}>
                  {map.volume[language]}: {map.note[language]} {map.verified ? s("(source map checked)", "(উৎস-তালিকা যাচাই করা)") : s("(review required)", "(পর্যালোচনা বাকি)")}
                </p>
              ))}
            </article>
          );
        })}
      </div>
      <ReferenceNote note="approval" />
    </section>
  );
}
