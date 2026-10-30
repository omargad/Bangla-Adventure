"use client";

import { useState } from "react";
import Link from "next/link";
import { useLanguage } from "../../lib/use-language";
import { useVoicePlayer } from "../../lib/use-voice-player";
import VoiceNote from "../components/VoiceNote";
import { stories, type Story } from "../stories-content";

export default function StoriesHub() {
  const [language, toggleLanguage] = useLanguage();
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const voice = useVoicePlayer();
  const speaking = voice.speakingKey;

  const active: Story | undefined = stories.find((story) => story.id === activeId);

  // Bangla is never read by a voice for another language; without a Bangla voice the page says so.
  const speak = (text: string, key: string, lang: string) => voice.speak(text, { key, lang, rate: 0.8 });

  function openStory(id: string) {
    setActiveId(id);
    setPage(0);
    setPicked(null);
  }

  function closeStory() {
    setActiveId(null);
    setPage(0);
    setPicked(null);
    voice.stop();
  }

  const onCheckPage = active ? page === active.pages.length : false;

  return (
    <main className="explore-app stories-app" lang={language}>
      <header className="explore-header">
        <Link className="adult-brand" href="/">
          <span>বা</span>
          <span>
            <strong>Bangla Adventures</strong>
            <small>{s("Story time", "গল্পের সময়")}</small>
          </span>
        </Link>
        <nav aria-label={s("Sections", "বিভাগ")}>
          <Link href="/">{s("Learner site", "শেখার সাইট")}</Link>
          <Link href="/phrasebook">{s("Phrasebook", "বাক্যের ঝুলি")}</Link>
          <Link className="active" href="/stories">{s("Stories", "গল্প")}</Link>
          <Link href="/explore">{s("Explore", "ঘুরে দেখো")}</Link>
        </nav>
        <button type="button" className="explore-lang" onClick={toggleLanguage}>
          {s("বাংলায় দেখুন", "View in English")}
        </button>
      </header>

      {!active && (
        <>
          <section className="explore-hero">
            <p className="adult-eyebrow">{s("Bilingual tales", "দুই ভাষার গল্প")}</p>
            <h1>{s("Old tales, new homes, one language of the heart.", "পুরনো গল্প, নতুন ঠিকানা, মনের একটাই ভাষা।")}</h1>
            <p>
              {s(
                "Folk tales retold gently, and stories about growing up with two homes. Read each page in Bangla and English, and tap the speaker to listen.",
                "নরম করে বলা লোককথা, আর দুই বাড়ির মাঝে বেড়ে ওঠার গল্প। প্রতিটি পাতা বাংলা ও ইংরেজিতে পড়ো, স্পিকার ছুঁয়ে শোনো।",
              )}
            </p>
          </section>
          <section className="explore-section">
            <div className="story-picker">
              {stories.map((story) => (
                <button type="button" className="story-card" key={story.id} onClick={() => openStory(story.id)}>
                  <span className="story-emoji" aria-hidden="true">{story.emoji}</span>
                  <strong lang="bn">{story.title.bn}</strong>
                  <em>{story.title.en}</em>
                  <small>{story.kind[language]} · {story.pages.length} {s("pages", "পাতা")}</small>
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      {active && (
        <section className="explore-section story-reader" aria-live="polite">
          <header className="story-reader-head">
            <button type="button" className="outline-button" onClick={closeStory}>
              ← {s("All stories", "সব গল্প")}
            </button>
            <h1>
              <span aria-hidden="true">{active.emoji}</span> {language === "bn" ? active.title.bn : active.title.en}
            </h1>
            <span className="story-progress">
              {onCheckPage
                ? s("Question", "প্রশ্ন")
                : `${s("Page", "পাতা")} ${page + 1}/${active.pages.length}`}
            </span>
          </header>

          {!onCheckPage && (
            <article className="story-page">
              <div className="story-passage">
                <p lang="bn">{active.pages[page].bn}</p>
                <button
                  type="button"
                  className={`sound-button ${speaking === `bn-${page}` ? "is-speaking" : ""}`}
                  onClick={() => speak(active.pages[page].bn, `bn-${page}`, "bn-BD")}
                >
                  <span className="sound-icon" aria-hidden="true">♪</span>
                  <span><small>{s("Hear it in Bangla", "বাংলায় শোনো")}</small><strong>বাংলা</strong></span>
                </button>
              </div>
              <div className="story-passage story-passage-en">
                <p>{active.pages[page].en}</p>
              </div>
              <div className="story-nav">
                <button type="button" className="outline-button" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  ← {s("Back", "আগে")}
                </button>
                <button type="button" className="primary-button" onClick={() => setPage(page + 1)}>
                  {page + 1 === active.pages.length ? s("Question time →", "প্রশ্নের পালা →") : s("Next page →", "পরের পাতা →")}
                </button>
              </div>
            </article>
          )}

          {onCheckPage && (
            <article className="story-page">
              <p className="counting-question">{active.check.prompt[language]}</p>
              <div className="counting-options">
                {active.check.options.map((option, index) => {
                  const state =
                    picked === null ? "" : index === active.check.answer ? "correct" : picked === index ? "wrong" : "dim";
                  return (
                    <button
                      type="button"
                      key={option.en}
                      className={`counting-option ${state}`}
                      disabled={picked !== null}
                      onClick={() => setPicked(index)}
                    >
                      <strong>{option[language]}</strong>
                    </button>
                  );
                })}
              </div>
              {picked !== null && (
                <div className="story-finish">
                  <p className="counting-result" role="status">
                    {picked === active.check.answer ? s("Correct! ⭐", "ঠিক! ⭐") : s("Good try!", "ভালো চেষ্টা!")}{" "}
                    {s("The story teaches:", "গল্পটি শেখায়:")} {active.moral[language]}
                  </p>
                  <div className="story-nav">
                    <button type="button" className="outline-button" onClick={() => { setPage(0); setPicked(null); }}>
                      {s("Read again", "আবার পড়ি")}
                    </button>
                    <button type="button" className="primary-button" onClick={closeStory}>
                      {s("Another story →", "আরেকটি গল্প →")}
                    </button>
                  </div>
                </div>
              )}
            </article>
          )}
        </section>
      )}
      <VoiceNote status={voice.status} language={language} />
    </main>
  );
}
