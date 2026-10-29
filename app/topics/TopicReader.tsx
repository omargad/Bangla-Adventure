"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { Topic } from "../topics-content";
import { formatNumber, type Language } from "@/lib/topic-model";
import { topicSourceLinks, type TopicReference } from "@/lib/library-links";
import SourceLinks from "../references/SourceLinks";

/**
 * One topic as students read it: heading, sections, facts, sources and the quiz.
 * The topics hub and the staff preview both render this, so a reviewer approves
 * exactly what students will see. The caller supplies the surrounding <article>.
 * Source links come with the topic from /api/curriculum (references, including the
 * administrator's yearly links); a preview without them uses the official NCTB pages.
 */
export default function TopicReader({ topic, language, titleLevel = 1, best, onQuizChecked, beforeQuiz, quizNote, onPickAnother }: {
  topic: Topic & { references?: TopicReference[] };
  language: Language;
  /** 2 when several readers share a page (the side-by-side preview). */
  titleLevel?: 1 | 2;
  /** The reader's best saved score, when known. */
  best?: { best: number; total: number };
  onQuizChecked?: (answers: number[], score: number) => void;
  /** Shown between the sources and the quiz (the "Mark reading complete" button). */
  beforeQuiz?: ReactNode;
  /** Replaces the default note under the quiz result. */
  quizNote?: ReactNode;
  onPickAnother?: () => void;
}) {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const n = (value: number) => formatNumber(value, language);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);
  const Title = titleLevel === 1 ? "h1" : "h2";
  const score = topic.quiz.reduce((total, question, index) => total + (answers[index] === question.answer ? 1 : 0), 0);
  const allAnswered = topic.quiz.every((_, index) => answers[index] !== undefined);
  const references = topic.references ?? topicSourceLinks(topic.sources ?? []);

  return (
    <>
      <header className="topic-reader-head">
        <span className="topic-emoji" aria-hidden="true">{topic.emoji}</span>
        <Title>{topic.title[language]}</Title>
        <p>{topic.tagline[language]}</p>
        <small>{s(`About ${topic.minutes} minutes of reading`, `পড়তে লাগবে প্রায় ${n(topic.minutes)} মিনিট`)}</small>
      </header>

      {topic.sections.map((section, index) => (
        <section className="topic-section" key={index}>
          <h2>{section.heading[language]}</h2>
          <p>{section.body[language]}</p>
        </section>
      ))}

      {topic.funFacts.length > 0 && (
        <section className="topic-facts" aria-label={s("Fun facts", "মজার তথ্য")}>
          <h2>✨ {s("Did you know?", "জানো কি?")}</h2>
          <ul>{topic.funFacts.map((fact, index) => <li key={index}>{fact[language]}</li>)}</ul>
        </section>
      )}

      <section className="topic-sources" aria-label={s("Trusted source", "নির্ভরযোগ্য উৎস")}>
        <h2>📖 {references.length ? s("From the government textbooks", "সরকারি পাঠ্যবই থেকে") : s("Where this comes from", "এই লেখার উৎস")}</h2>
        {topic.sourceNote && <p className="topic-sources-note">{topic.sourceNote[language]}</p>}
        {references.length > 0 && <>
          <p className="topic-sources-note">{s("This topic is linked to these NCTB government textbooks:", "এই বিষয়টি এনসিটিবির এই সরকারি পাঠ্যবইগুলোর সঙ্গে যুক্ত:")}</p>
          <ul>
            {references.map((reference) => (
              <li key={reference.bookId}>
                <strong lang="bn">{reference.titleBn}</strong>
                <span> — {language === "bn" ? reference.classes.bn : `${reference.title}, ${reference.classes.en}`}</span>
                <em>{reference.note[language]}</em>
                <SourceLinks links={reference.links} language={language} bookTitle={language === "bn" ? reference.titleBn : reference.title} />
              </li>
            ))}
          </ul>
        </>}
        <Link href="/library">{s("Open the textbook library →", "পাঠ্যবই লাইব্রেরি খোলো →")}</Link>
        <Link href="/references">{s("Sources and reference guide", "উৎস ও তথ্যসূত্রের নির্দেশিকা")}</Link>
      </section>

      {beforeQuiz}

      {topic.quiz.length > 0 && (
        <section className="topic-quiz" aria-label={s("Quiz", "কুইজ")}>
          <h2>📝 {s("Show what you know", "কতটা জানলে দেখাও")}</h2>
          {best && <p className="topic-best">{s(`Your best so far: ${best.best} out of ${best.total}`, `এ পর্যন্ত তোমার সেরা: ${n(best.total)}টির মধ্যে ${n(best.best)}টি`)}</p>}
          {topic.quiz.map((question, questionIndex) => (
            <fieldset className="topic-question" key={questionIndex}>
              <legend>{n(questionIndex + 1)}. {question.question[language]}</legend>
              <div className="topic-options">
                {question.options.map((option, optionIndex) => {
                  const selected = answers[questionIndex] === optionIndex;
                  const isRight = checked && optionIndex === question.answer;
                  const isWrong = checked && selected && optionIndex !== question.answer;
                  return (
                    <button
                      type="button"
                      key={optionIndex}
                      aria-pressed={selected}
                      className={`topic-option ${selected ? "is-selected" : ""} ${isRight ? "is-right" : ""} ${isWrong ? "is-wrong" : ""}`}
                      disabled={checked}
                      onClick={() => setAnswers((current) => ({ ...current, [questionIndex]: optionIndex }))}
                    >
                      {option[language]}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}

          {checked ? (
            <div className="topic-result" role="status">
              <strong>{s(`You got ${score} out of ${topic.quiz.length}!`, `তুমি ${n(topic.quiz.length)}টির মধ্যে ${n(score)}টি পেরেছ!`)}</strong>
              <p>{quizNote ?? s(
                "Show this screen to your teacher or family — or read the topic again and try for a full score.",
                "এই পর্দাটি শিক্ষক বা পরিবারকে দেখাও — অথবা আবার পড়ে পুরো নম্বরের চেষ্টা করো।",
              )}</p>
              <div className="topic-result-actions">
                <button type="button" onClick={() => { setAnswers({}); setChecked(false); }}>{s("Try again", "আবার চেষ্টা")}</button>
                {onPickAnother && <button type="button" onClick={onPickAnother}>{s("Pick another topic", "অন্য বিষয় বেছে নাও")}</button>}
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="primary-button topic-submit"
              disabled={!allAnswered}
              onClick={() => { setChecked(true); onQuizChecked?.(topic.quiz.map((_, index) => answers[index]), score); }}
            >
              {allAnswered ? s("Check my answers", "উত্তর মিলিয়ে দেখো") : s("Answer every question first", "আগে সব প্রশ্নের উত্তর দাও")}
            </button>
          )}
        </section>
      )}
    </>
  );
}
