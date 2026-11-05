"use client";

import type { LessonSnapshot } from "@/lib/lesson-content";
import { localizeLesson, localizeLessonExtension } from "../lesson-locales/presentation";
import { useLanguage, localNumber } from "@/lib/use-language";

export default function WorksheetSheet({ snapshot, staffPreview = false }: { snapshot: LessonSnapshot; staffPreview?: boolean }) {
  const [language, toggle] = useLanguage();
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const n = (value: number) => localNumber(value, language);
  const missingBangla = language === "bn" && !snapshot.banglaCopy;
  const lesson = localizeLesson(snapshot.lesson, language, snapshot.banglaCopy);
  const extension = localizeLessonExtension(snapshot.extension, language, snapshot.banglaCopy);
  const answers = [s("Reading check", "পড়ার যাচাই") + ": " + n(extension.reading.check.answer + 1), ...lesson.quiz.map((item, index) => s("Quiz", "প্রশ্ন") + " " + n(index + 1) + ": " + n(item.answer + 1))].join(" · ");

  return <>
    <div className="worksheet-no-print">
      <button type="button" className="outline-button" onClick={toggle}>{language === "en" ? "বাংলা" : "English"}</button>
      {staffPreview && <p role="status">{s("Staff preview: this version may still be waiting for Admin approval.", "কর্মীদের প্রাক্‌দর্শন: এই সংস্করণটি এখনো প্রশাসকের অনুমোদনের অপেক্ষায় থাকতে পারে।")}</p>}
    </div>
    {missingBangla ? <section className="worksheet-sheet" lang="bn">
      <h1>{snapshot.lesson.titleBn}</h1>
      <p role="status">এই অনুমোদিত সংস্করণের বাংলা সহায়ক নির্দেশনা এখনো পর্যালোচনার অপেক্ষায় আছে। অনুমোদিত ইংরেজি নির্দেশনা দেখতে ভাষা বদলাও।</p>
      <button type="button" className="outline-button worksheet-no-print" onClick={toggle}>অনুমোদিত ইংরেজি নির্দেশনা দেখো</button>
    </section> : <article className="worksheet-sheet" lang={language}>
      <header className="worksheet-header">
        <div>
          <p className="worksheet-brand">বা · Bangla Adventures</p>
          <h1>{s("Lesson", "পাঠ")} {n(lesson.number)}: {language === "bn" ? lesson.titleBn : lesson.title}</h1>
          <p className="worksheet-title-bn" lang={language === "en" ? "bn" : "en"}>{language === "en" ? lesson.titleBn : lesson.title}</p>
        </div>
        <div className="worksheet-meta">
          <span className="worksheet-band-tag" lang="en">{lesson.level.toUpperCase()}</span>
          <div className="worksheet-fill-line">{s("Name", "নাম")}: ______________________</div>
          <div className="worksheet-fill-line">{s("Date", "তারিখ")}: ______________________</div>
        </div>
      </header>
      <p className="worksheet-cando"><strong>{s("Goal:", "লক্ষ্য:")}</strong> {lesson.canDo}</p>
      <section className="worksheet-section">
        <h2>{n(1)} · {s("Words to learn", "শব্দ শেখা")}</h2>
        <table className="worksheet-vocab">
          <thead><tr>
            <th scope="col">{s("Bangla", "বাংলা")}</th><th scope="col">{s("Say it", "উচ্চারণ")}</th>
            <th scope="col">{s("English", "ইংরেজি")}</th><th scope="col">{s("Write it yourself", "নিজে লেখো")}</th>
          </tr></thead>
          <tbody>{lesson.vocabulary.map(item => <tr key={item.bn}>
            <td lang="bn">{item.bn}</td><td lang="en">{item.transliteration}</td><td lang="en">{item.en}</td>
            <td className="worksheet-trace" aria-label={s("Space to practise writing", "লেখা অনুশীলনের জায়গা")} />
          </tr>)}</tbody>
        </table>
        {snapshot.supportModel && <aside className="worksheet-support">
          <h3>{snapshot.supportModel.title[language]}</h3>
          <p>{s("Written reference with pronunciation guides.", "উচ্চারণের সহায়তাসহ লিখিত তালিকা।")}</p>
          {snapshot.supportModel.groups.map(group => <div key={group.title.en}>
            <h4>{group.title[language]}</h4>
            <p>{group.items.map((item, index) => <span key={item.bn}>{index > 0 && " · "}<span lang="bn">{item.bn}</span> <span lang="en">({item.transliteration})</span>{item.value !== undefined && <> — {n(item.value)}</>}</span>)}</p>
          </div>)}
        </aside>}
      </section>
      <section className="worksheet-section">
        <h2>{n(2)} · {s("Sentence patterns", "বাক্যের ছাঁচ")}</h2>
        {lesson.patterns.map(pattern => <div className="worksheet-pattern" key={pattern.bn}>
          <p><span lang="bn">{pattern.bn}</span> <em lang="en">({pattern.transliteration}) — {pattern.en}</em></p>
          <div className="worksheet-rule" aria-hidden="true" />
        </div>)}
      </section>
      <section className="worksheet-section">
        <h2>{n(3)} · {s("Read and think", "পড়ে ভাবি")}</h2>
        <h3>{extension.reading.title}</h3>
        <p lang="bn">{extension.reading.bn}</p><p className="worksheet-reading-en" lang="en">{extension.reading.en}</p>
        <p className="worksheet-question">{extension.reading.check.prompt}</p>
        <ol className="worksheet-options">{extension.reading.check.options.map(option => <li key={option}><span className="worksheet-checkbox" aria-hidden="true" /> {option}</li>)}</ol>
      </section>
      <section className="worksheet-section">
        <h2>{n(4)} · {s("Your turn to write", "এবার লেখো")}</h2><p>{extension.writing.mission}</p>
        <p className="worksheet-starters">{s("Sentence starters:", "বাক্য শুরুর নমুনা:")} {extension.writing.starters.map((starter, index) => <span key={starter} lang="bn">{index > 0 && " • "}{starter}</span>)}</p>
        {Array.from({ length: 6 }, (_, index) => <div className="worksheet-rule" key={index} aria-hidden="true" />)}
      </section>
      <section className="worksheet-section">
        <h2>{n(5)} · {s("Check yourself", "নিজেকে যাচাই")}</h2>
        {lesson.quiz.map((item, index) => <div key={item.question} className="worksheet-quiz">
          <p className="worksheet-question">{n(index + 1)}. {item.question}</p>
          <ol className="worksheet-options">{item.options.map(option => <li key={option}><span className="worksheet-checkbox" aria-hidden="true" /> {option}</li>)}</ol>
        </div>)}
      </section>
      <aside className="worksheet-mission"><h2>{s("Family mission", "পরিবারের সঙ্গে")}</h2><p>{lesson.familyMission}</p></aside>
      <footer className="worksheet-footer">
        <span>{s("Answer key (1 = first option):", "উত্তরসূচি (১ = প্রথম উত্তর):")} {answers}</span>
        <span>{s("Free to copy for home and classroom use", "বাড়ি ও শ্রেণিকক্ষে ব্যবহারের জন্য বিনা খরচে কপি করা যায়")}</span>
      </footer>
    </article>}
  </>;
}
