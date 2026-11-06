"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { LearnerTopic, ReaderQuizQuestion, TopicQuizMarks } from "@/lib/learner-topic";
import { formatNumber, type Language } from "@/lib/topic-model";
import { topicSourceLinks, type TopicReference } from "@/lib/library-links";
import SourceLinks from "../references/SourceLinks";
import ContentNarration from "../components/ContentNarration";
import { topicNarrationText } from "@/lib/narration-model";
import { presentQuizOptions } from "@/lib/quiz-option-order";

/**
 * One topic as students read it: heading, sections, facts, sources and the quiz.
 * The topics hub and the staff preview both render this, so a reviewer approves
 * exactly what students will see. The caller supplies the surrounding <article>.
 * Source links come with the topic (references, including the administrator's yearly
 * links) from /api/curriculum or, for the staff preview, the topic version API; a
 * topic without them falls back to the official NCTB pages.
 * Readers get topics without quiz answers, so checkQuiz marks the quiz on the server;
 * only a staff preview, whose version still has its answers, marks it here.
 */
export default function TopicReader({ topic, language, titleLevel = 1, best, checkQuiz, beforeQuiz, quizNote, onPickAnother, narrationEnabled = true }: {
  topic: LearnerTopic & { references?: TopicReference[] };
  language: Language;
  /** 2 when several readers share a page (the side-by-side preview). */
  titleLevel?: 1 | 2;
  /** The reader's best saved score, when known. */
  best?: { best: number; total: number };
  /** Marks the answers on the server; null when that failed (the caller shows why). */
  checkQuiz?: (answers: number[]) => Promise<TopicQuizMarks | null>;
  /** Shown between the sources and the quiz (the "Mark reading complete" button). */
  beforeQuiz?: ReactNode;
  /** Replaces the default note under the quiz result. */
  quizNote?: ReactNode;
  onPickAnother?: () => void;
  /** Draft/staff previews cannot request narration of unpublished text. */
  narrationEnabled?: boolean;
}) {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const n = (value: number) => formatNumber(value, language);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [marks, setMarks] = useState<TopicQuizMarks | null>(null);
  const [checking, setChecking] = useState(false);
  const checked = marks !== null;
  // A deterministic initial order keeps server/client rendering identical. A retry
  // rotates the presentation without changing the canonical answer indexes sent
  // to the server. Language changes never change the current attempt's order.
  const [attempt, setAttempt] = useState(0);
  const Title = titleLevel === 1 ? "h1" : "h2";
  const allAnswered = topic.quiz.every((_, index) => answers[index] !== undefined);
  const references = topic.references ?? topicSourceLinks(topic.sources ?? []);

  async function check() {
    const picked = topic.quiz.map((_, index) => answers[index]);
    if (!checkQuiz) { setMarks(markHere(topic.quiz, picked)); return; }
    setChecking(true);
    try { const result = await checkQuiz(picked); if (result) setMarks(result); }
    finally { setChecking(false); }
  }

  return (
    <>
      <header className="topic-reader-head">
        <span className="topic-emoji" aria-hidden="true">{topic.emoji}</span>
        <Title>{topic.title[language]}</Title>
        <p>{topic.tagline[language]}</p>
        <small>{s(`About ${topic.minutes} minutes of reading`, `পড়তে লাগবে প্রায় ${n(topic.minutes)} মিনিট`)}</small>
        {narrationEnabled && <ContentNarration source={{ kind: "topic", id: topic.id, slot: "intro", language: "bn" }} text={topicNarrationText(topic, "intro", "bn") ?? ""} language={language} label={s("Listen in Bangla", "বাংলায় শুনি")} />}
      </header>

      {topic.sections.map((section, index) => (
        <section className="topic-section" key={index}>
          <h2>{section.heading[language]}</h2>
          <p>{section.body[language]}</p>
          {narrationEnabled && <ContentNarration source={{ kind: "topic", id: topic.id, slot: `section:${index}`, language: "bn" }} text={topicNarrationText(topic, `section:${index}`, "bn") ?? ""} language={language} label={s("Listen in Bangla", "বাংলায় শুনি")} />}
        </section>
      ))}

      {topic.funFacts.length > 0 && (
        <section className="topic-facts" aria-label={s("Fun facts", "মজার তথ্য")}>
          <h2>✨ {s("Did you know?", "জানো কি?")}</h2>
          <ul>{topic.funFacts.map((fact, index) => <li key={index}>{fact[language]}{narrationEnabled && <ContentNarration source={{ kind: "topic", id: topic.id, slot: `fact:${index}`, language: "bn" }} text={topicNarrationText(topic, `fact:${index}`, "bn") ?? ""} language={language} label={s("Listen in Bangla", "বাংলায় শুনি")} />}</li>)}</ul>
        </section>
      )}

      <section className="topic-sources" aria-label={s("Learning references", "শেখার তথ্যসূত্র")}>
        <h2>📖 {s("Learning references", "শেখার তথ্যসূত্র")}</h2>
        {topic.sourceNote && <p className="topic-sources-note">{topic.sourceNote[language]}</p>}
        {references.length > 0 && <>
          <p className="topic-sources-note">{s("These NCTB textbooks are related reading. An administrator must verify the relevant edition and page or section.", "সম্পর্কিত এনসিটিবির পাঠ্যবই এখানে দেওয়া হলো। প্রাসঙ্গিক সংস্করণ এবং পৃষ্ঠা বা অংশ প্রশাসককে যাচাই করতে হবে।")}</p>
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
                {presentQuizOptions(question.options, `topic:${topic.id}`, questionIndex + attempt).map(({ text: option, originalIndex: optionIndex }) => {
                  const selected = answers[questionIndex] === optionIndex;
                  // A preview knows the answer and shows it; a reader learns only whether the pick was right.
                  const isRight = checked && (question.answer !== undefined ? optionIndex === question.answer : selected && Boolean(marks?.correct[questionIndex]));
                  const isWrong = checked && selected && !marks?.correct[questionIndex];
                  return (
                    <button
                      type="button"
                      key={optionIndex}
                      aria-pressed={selected}
                      className={`topic-option ${selected ? "is-selected" : ""} ${isRight ? "is-right" : ""} ${isWrong ? "is-wrong" : ""}`}
                      disabled={checked || checking}
                      onClick={() => setAnswers((current) => ({ ...current, [questionIndex]: optionIndex }))}
                    >
                      {option[language]}
                    </button>
                  );
                })}
              </div>
              {marks && <p className="topic-question-mark">{marks.correct[questionIndex] ? `✓ ${s("Right", "ঠিক হয়েছে")}` : `✗ ${s("Not this one", "এটি নয়")}`}</p>}
            </fieldset>
          ))}

          {marks ? (
            <div className="topic-result" role="status">
              <strong>{s(`You got ${marks.score} out of ${marks.total}!`, `তুমি ${n(marks.total)}টির মধ্যে ${n(marks.score)}টি পেরেছ!`)}</strong>
              <p>{quizNote ?? s(
                "Show this screen to your teacher or family — or read the topic again and try for a full score.",
                "এই পর্দাটি শিক্ষক বা পরিবারকে দেখাও — অথবা আবার পড়ে পুরো নম্বরের চেষ্টা করো।",
              )}</p>
              <div className="topic-result-actions">
                <button type="button" onClick={() => { setAnswers({}); setMarks(null); setAttempt((current) => current + 1); }}>{s("Try again", "আবার চেষ্টা")}</button>
                {onPickAnother && <button type="button" onClick={onPickAnother}>{s("Pick another topic", "অন্য বিষয় বেছে নাও")}</button>}
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="primary-button topic-submit"
              disabled={!allAnswered || checking}
              onClick={() => void check()}
            >
              {checking ? s("Checking…", "মিলিয়ে দেখা হচ্ছে…") : allAnswered ? s("Check my answers", "উত্তর মিলিয়ে দেখো") : s("Answer every question first", "আগে সব প্রশ্নের উত্তর দাও")}
            </button>
          )}
        </section>
      )}
    </>
  );
}

/** A staff preview's own marking, from the answers its version carries. */
function markHere(quiz: ReaderQuizQuestion[], picked: number[]): TopicQuizMarks {
  const correct = quiz.map((question, index) => question.answer !== undefined && picked[index] === question.answer);
  return { score: correct.filter(Boolean).length, total: quiz.length, correct };
}
