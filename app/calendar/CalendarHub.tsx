"use client";

import Link from "next/link";
import { useLanguage } from "../../lib/use-language";
import { useVoicePlayer } from "../../lib/use-voice-player";
import VoiceNote from "../components/VoiceNote";
import { days, months, seasons } from "../calendar-content";

export default function CalendarHub() {
  const [language, toggleLanguage] = useLanguage();
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const voice = useVoicePlayer();
  const speaking = voice.speakingKey;

  // Bangla is never read by a voice for another language; without a Bangla voice the page says so.
  const speak = (text: string, key: string) => voice.speak(text, { key, rate: 0.75 });

  return (
    <main className="explore-app calendar-app" lang={language}>
      <header className="explore-header">
        <Link className="adult-brand" href="/">
          <span>বা</span>
          <span>
            <strong>Bangla Adventures</strong>
            <small>{s("Days & seasons", "দিন ও ঋতু")}</small>
          </span>
        </Link>
        <nav aria-label={s("Sections", "বিভাগ")}>
          <Link href="/">{s("Learner site", "শেখার সাইট")}</Link>
          <Link href="/alphabet">{s("Alphabet", "বর্ণমালা")}</Link>
          <Link href="/numbers">{s("Numbers", "সংখ্যা")}</Link>
          <Link className="active" href="/calendar">{s("Calendar", "দিন-ঋতু")}</Link>
        </nav>
        <button type="button" className="explore-lang" onClick={toggleLanguage}>
          {s("বাংলায় দেখুন", "View in English")}
        </button>
      </header>

      <section className="explore-hero">
        <p className="adult-eyebrow">{s("Time, the Bangla way", "বাংলার নিয়মে সময়")}</p>
        <h1>{s("Seven days, twelve months, six seasons.", "সাত দিন, বারো মাস, ছয় ঋতু।")}</h1>
        <p>
          {s(
            "Bangladesh keeps its own beautiful calendar: the year starts in Boishakh, and instead of four seasons there are six. Tap anything to hear it.",
            "বাংলাদেশের আছে নিজের সুন্দর পঞ্জিকা: বছর শুরু হয় বৈশাখে, আর চারটির বদলে ঋতু ছয়টি। যেকোনোটি ছুঁয়ে শোনো।",
          )}
        </p>
      </section>

      <section className="explore-section" aria-labelledby="days-heading">
        <h2 id="days-heading">{s("Days of the week", "সপ্তাহের দিন")}</h2>
        <p className="explore-section-note">
          {s(
            "In Bangladesh the weekend is Friday and Saturday, so the school week starts on Sunday!",
            "বাংলাদেশে ছুটির দিন শুক্র ও শনিবার, তাই স্কুল-সপ্তাহ শুরু হয় রবিবারে!",
          )}
        </p>
        <div className="digit-grid">
          {days.map((day) => (
            <button
              type="button"
              key={day.bn}
              className={`digit-card ${speaking === `day-${day.bn}` ? "is-speaking" : ""}`}
              onClick={() => speak(day.bn, `day-${day.bn}`)}
            >
              <strong lang="bn">{day.bn}</strong>
              <em>{day.transliteration}</em>
              <small>{day.en}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="explore-section" aria-labelledby="months-heading">
        <h2 id="months-heading">{s("The twelve Bengali months", "বারো মাস")}</h2>
        <div className="digit-grid">
          {months.map((month, index) => (
            <button
              type="button"
              key={month.bn}
              className={`digit-card ${speaking === `month-${month.bn}` ? "is-speaking" : ""}`}
              onClick={() => speak(month.bn, `month-${month.bn}`)}
            >
              <span className="month-number">{index + 1}</span>
              <strong lang="bn">{month.bn}</strong>
              <em>{month.transliteration}</em>
              <small>{month.gregorian}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="explore-section" aria-labelledby="seasons-heading">
        <h2 id="seasons-heading">{s("The six seasons — ছয় ঋতু", "ছয় ঋতু")}</h2>
        <div className="season-grid">
          {seasons.map((season) => (
            <button
              type="button"
              key={season.bn}
              className={`season-card ${speaking === `season-${season.bn}` ? "is-speaking" : ""}`}
              onClick={() => speak(season.bn, `season-${season.bn}`)}
            >
              <span className="season-emoji" aria-hidden="true">{season.emoji}</span>
              <strong lang="bn">{season.bn}</strong>
              <em>
                {season.transliteration} · {season.en}
              </em>
              <span className="season-months" lang="bn">
                {season.months.join(" · ")}
              </span>
              <p>{season.description[language]}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="explore-cta">
        <Link className="primary-button" href="/explore">
          {s("Explore more of Bangladesh →", "বাংলাদেশ আরও ঘুরে দেখো →")}
        </Link>
      </section>
      <VoiceNote status={voice.status} language={language} />
    </main>
  );
}
