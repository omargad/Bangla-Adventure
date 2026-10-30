"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Lesson } from "../curriculum";
import { lessonExtensions, lessonSessionSkills, type LearningSkill, type QuickCheck } from "../learning-content";
import type { LearnerVideo } from "../../lib/lesson-model";
import { lessonClip, voiceStatusText, type Clip, type VoiceStatus } from "../../lib/voice-playback";
import { localNumber } from "../../lib/local-format";
import type { Message } from "../../lib/use-language";

type Language = "en" | "bn";
type Cue = "tap" | "success" | "retry" | "star";
export type LessonStep = "overview" | LearningSkill;

type LevelBand = {
  code: string;
  title: string;
  titleBn: string;
  tone: string;
};

type LessonExperienceProps = {
  lesson: Lesson;
  /** The video learners get after a teacher's video check; null when it was taken down without a replacement. */
  video?: LearnerVideo | null;
  /** Staff preview in the Studio: transcripts, scaffolds and answers start visible and nothing is saved. */
  preview?: boolean;
  /** Called with each part of the lesson the viewer opens, starting with the overview. */
  onStepView?: (step: LessonStep) => void;
  level: LevelBand;
  language: Language;
  completed: string[];
  soundEnabled: boolean;
  isSpeaking: boolean;
  /** What is playing now, so the lesson can say whether it is a recorded, device or computer voice. */
  voiceStatus?: VoiceStatus | null;
  onSpeak: (text: string, lang?: string, clip?: Clip) => void;
  onStopAudio: () => void;
  onAward: (activity: string, amount?: number) => void;
  onCue: (cue: Cue) => void;
  onClose: () => void;
};

export const lessonSteps: LessonStep[] = [
  "overview",
  "listening",
  "reading",
  "speaking",
  "writing",
  "culture",
  "mastery",
];

const labels: Record<Language, Record<LessonStep, string>> = {
  en: {
    overview: "Overview",
    listening: "Listen",
    reading: "Read",
    speaking: "Speak",
    writing: "Write",
    culture: "Watch",
    mastery: "Mastery",
  },
  bn: {
    overview: "শুরু",
    listening: "শুনি",
    reading: "পড়ি",
    speaking: "বলি",
    writing: "লিখি",
    culture: "দেখি",
    mastery: "যাচাই",
  },
};

function sessionKey(lessonId: string, skill: LearningSkill) {
  return `session-${lessonId}-${skill}`;
}

/** A Bangla run inside English text: Bangla words and the spaces and punctuation between them. */
const banglaRun = /[\u0980-\u09ff\u0964\u0965]+(?:[\s,?!]+[\u0980-\u09ff\u0964\u0965]+)*/g;

/**
 * Lesson text written in English, often with Bangla words in it. The caller marks its element lang="en";
 * the Bangla words are marked here, so a screen reader reads each in its own voice.
 */
function mixed(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(banglaRun)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(<span lang="bn" key={match.index}>{match[0]}</span>);
    last = match.index + match[0].length;
  }
  if (parts.length === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** English kickers keep their Bangla name beside them; in Bangla mode the Bangla stands alone. */
function paired(language: Language, en: string, bn: string, bnAlone = bn): ReactNode {
  return language === "bn" ? bnAlone : <>{en} · <span lang="bn">{bn}</span></>;
}

/** Answer letters: A, B, C in English and ক, খ, গ as in Bangla school papers. */
function optionLetter(index: number, language: Language) {
  return language === "bn" ? "কখগঘঙচ"[index] ?? localNumber(index + 1, "bn") : String.fromCharCode(65 + index);
}

/** A lesson length such as "20 min" or "60–90 min project", with Bangla digits and words in Bangla mode. */
function lessonDuration(text: string, language: Language) {
  if (language === "en") return text;
  return text.replace(/\d+/g, (digits) => localNumber(Number(digits), "bn")).replace(/\bmin project$/, "মিনিটের প্রকল্প").replace(/\bmin$/, "মিনিট");
}

/** Marks the right answer for staff in the Studio preview. */
function PreviewAnswer({ language }: { language: Language }) {
  return <em className="preview-answer"> ✓ {paired(language, "correct answer", "সঠিক উত্তর")}</em>;
}

function QuickCheckCard({
  language,
  check,
  answer,
  submitted,
  showAnswer,
  onAnswer,
  onSubmit,
}: {
  language: Language;
  check: QuickCheck;
  answer: number | null;
  submitted: boolean;
  showAnswer: boolean;
  onAnswer: (answer: number) => void;
  onSubmit: () => void;
}) {
  const correct = answer === check.answer;
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  return (
    <section className="session-check" aria-label={s("Quick check", "ছোট যাচাই")}>
      <p className="modal-kicker">{paired(language, "Quick check", "ছোট যাচাই")}</p>
      <h4 lang="en">{mixed(check.prompt)}</h4>
      <div className="session-check-options">
        {check.options.map((option, index) => (
          <button
            type="button"
            key={option}
            className={`${answer === index ? "selected" : ""} ${submitted && answer === index ? (correct ? "correct" : "wrong") : ""}`}
            aria-pressed={answer === index}
            onClick={() => onAnswer(index)}
          >
            <span>{optionLetter(index, language)}</span><span lang="en">{mixed(option)}</span>{showAnswer && index === check.answer && <PreviewAnswer language={language} />}
          </button>
        ))}
      </div>
      {showAnswer && <p className="preview-answer-note" lang="en">{mixed(check.explanation)}</p>}
      <button className="outline-button compact-button" type="button" onClick={onSubmit}>
        {s("Check this answer", "উত্তরটা যাচাই করি")}
      </button>
      {submitted && (
        <p className={`session-feedback ${correct ? "success" : "retry"}`} role="status">
          <strong>{correct ? s("✓ That’s it.", "✓ ঠিক হয়েছে।") : s("↻ Try once more.", "↻ আর একবার চেষ্টা করো।")}</strong> <span lang="en">{mixed(check.explanation)}</span>
        </p>
      )}
    </section>
  );
}

export default function LessonExperience({
  lesson,
  video: learnerVideo,
  preview = false,
  onStepView,
  level,
  language,
  completed,
  soundEnabled,
  isSpeaking,
  voiceStatus = null,
  onSpeak,
  onStopAudio,
  onAward,
  onCue,
  onClose,
}: LessonExperienceProps) {
  const extension = lessonExtensions[lesson.id];
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const voiceText = voiceStatusText(voiceStatus, language);
  const video: LearnerVideo | null = learnerVideo === undefined ? lesson.video : learnerVideo;
  const [step, setStep] = useState<LessonStep>("overview");
  const [showTranscript, setShowTranscript] = useState(preview);
  const [showEnglish, setShowEnglish] = useState(preview);
  const [listenAnswer, setListenAnswer] = useState<number | null>(null);
  const [listenSubmitted, setListenSubmitted] = useState(false);
  const [readAnswer, setReadAnswer] = useState<number | null>(null);
  const [readSubmitted, setReadSubmitted] = useState(false);
  const [writing, setWriting] = useState("");
  const [showModel, setShowModel] = useState(preview);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [watchChecks, setWatchChecks] = useState([false, false, false]);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "ready">("idle");
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<Message | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const paneHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const completeSessions = useMemo(
    () => lessonSessionSkills.filter((skill) => completed.includes(sessionKey(lesson.id, skill))).length,
    [completed, lesson.id],
  );

  useEffect(() => {
    onStepView?.(step);
  }, [onStepView, step]);

  useEffect(() => {
    const url = recordingUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [recordingUrl]);

  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  if (!extension) {
    return (
      <div className="lesson-shell lesson-content-missing">
        <h2>{s("Lesson content is being reviewed.", "পাঠটি এখন যাচাই করা হচ্ছে।")}</h2>
        <button type="button" className="primary-button" onClick={onClose}>{s("Close", "বন্ধ করি")}</button>
      </div>
    );
  }

  const allQuizAnswered = lesson.quiz.every((_, index) => quizAnswers[index] !== undefined);
  const allQuizCorrect = allQuizAnswered && lesson.quiz.every((question, index) => quizAnswers[index] === question.answer);

  function changeStep(nextStep: LessonStep) {
    onStopAudio();
    onCue("tap");
    setStep(nextStep);
    window.setTimeout(() => paneHeadingRef.current?.focus(), 0);
  }

  function complete(skill: LearningSkill) {
    onAward(sessionKey(lesson.id, skill));
  }

  function submitListen() {
    setListenSubmitted(true);
    if (listenAnswer === extension.listening.check.answer) {
      onCue("success");
      complete("listening");
    } else {
      onCue("retry");
    }
  }

  function submitRead() {
    setReadSubmitted(true);
    if (readAnswer === extension.reading.check.answer) {
      onCue("success");
      complete("reading");
    } else {
      onCue("retry");
    }
  }

  async function startRecording() {
    setRecordingError(null);
    if (!("MediaRecorder" in window) || !navigator.mediaDevices?.getUserMedia) {
      setRecordingError(["Recording is not supported in this browser. You can still rehearse aloud and complete the session.", "এই ব্রাউজারে রেকর্ড করা যায় না। তবুও জোরে জোরে অনুশীলন করে ধাপটা শেষ করতে পারো।"]);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setRecordingUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return URL.createObjectURL(blob);
        });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecordingState("ready");
      };
      recorder.start();
      setRecordingState("recording");
    } catch {
      setRecordingError(["Microphone access was not granted. Nothing was recorded; rehearse aloud or try again when you are ready.", "মাইক্রোফোন চালুর অনুমতি পাওয়া যায়নি। কিছুই রেকর্ড হয়নি; জোরে জোরে অনুশীলন করো, বা তৈরি হলে আবার চেষ্টা করো।"]);
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function deleteRecording() {
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    setRecordingUrl(null);
    setRecordingState("idle");
    setRecordingError(null);
  }

  function submitMastery() {
    setQuizSubmitted(true);
    if (!allQuizAnswered) {
      onCue("retry");
      return;
    }
    if (allQuizCorrect) {
      onAward(sessionKey(lesson.id, "mastery"));
      onAward(`lesson-${lesson.id}`, 2);
    } else {
      onCue("retry");
    }
  }

  const stepIndex = lessonSteps.indexOf(step);
  const isSessionStep = step !== "overview";
  const currentSessionComplete = isSessionStep && completed.includes(sessionKey(lesson.id, step));
  const sectionTitle = labels[language][step];

  return (
    <div className="lesson-shell expanded-lesson-shell">
      <header className={`lesson-modal-hero ${level.tone}`}>
        <div className="lesson-modal-meta">
          <span lang="en">{level.code}</span>
          <span>{language === "en" ? `Lesson ${lesson.number} / 18` : `পাঠ ${lesson.number.toLocaleString("bn-BD")} / ১৮`}</span>
          <span>{s("6 guided sessions", "৬টি শেখার ধাপ")}</span>
        </div>
        <div className="lesson-modal-title-row">
          <div>
            <p>{language === "bn" ? level.titleBn : <>{level.title} · <span lang="bn">{level.titleBn}</span></>}</p>
            <h2 lang="en">{lesson.title}</h2>
            <p className="lesson-modal-title-bn" lang="bn">{lesson.titleBn}</p>
          </div>
          <span className={`module-session-seal ${completeSessions === 6 ? "complete" : ""}`}>
            <strong>{localNumber(completeSessions, language)}/{localNumber(6, language)}</strong><small>{completeSessions === 6 ? s("Lesson complete", "পাঠ শেষ") : s("sessions complete", "ধাপ শেষ")}</small>
          </span>
        </div>
        <div className="lesson-step-progress" aria-label={s(`${completeSessions} of 6 sessions complete`, `৬টির মধ্যে ${localNumber(completeSessions, "bn")}টি ধাপ শেষ`)}>
          {lessonSessionSkills.map((skill) => (
            <span key={skill} className={completed.includes(sessionKey(lesson.id, skill)) ? "filled" : ""} />
          ))}
        </div>
      </header>

      <nav className="lesson-step-tabs expanded-tabs" aria-label={language === "en" ? "Lesson sections" : "পাঠের অংশ"}>
        {lessonSteps.map((item, index) => (
          <button
            type="button"
            key={item}
            className={`${step === item ? "active" : ""} ${item !== "overview" && completed.includes(sessionKey(lesson.id, item)) ? "complete" : ""}`}
            aria-current={step === item ? "step" : undefined}
            onClick={() => changeStep(item)}
          >
            <span>{item === "overview" ? "⌂" : localNumber(index, language)}</span>{labels[language][item]}
          </button>
        ))}
      </nav>

      <div className="lesson-pane expanded-lesson-pane">
        <h3 ref={paneHeadingRef} className="sr-only" tabIndex={-1}>{sectionTitle}</h3>

        {step === "overview" && (
          <div className="lesson-start-pane">
            <div className="module-overview-banner">
              <div><span>{s("108-session pathway", "১০৮ ধাপের পথ")}</span><strong>{localNumber(6, language)} × {lessonDuration(lesson.duration, language)}</strong></div>
              <p lang="en">{mixed(lesson.summary)}</p>
            </div>
            <div className="lesson-can-do large">
              <span aria-hidden="true">✓</span>
              <p><strong>{s("By the end, I can…", "শেষে আমি পারব…")}</strong><span lang="en">{mixed(lesson.canDo)}</span></p>
            </div>
            <div className="lesson-start-grid">
              <section>
                <p className="modal-kicker">{paired(language, "Learning goals", "শেখার লক্ষ্য")}</p>
                <ol className="objective-list">
                  {lesson.objectives.map((objective, index) => <li key={objective}><span>{localNumber(index + 1, language)}</span><span lang="en">{mixed(objective)}</span></li>)}
                </ol>
              </section>
              <section className="lesson-route-card six-session-route">
                <p className="modal-kicker">{paired(language, "Six-session route", "ছয় ধাপের পথ")}</p>
                <ul>
                  {lessonSessionSkills.map((skill, index) => (
                    <li key={skill}>
                      <span>{language === "bn" ? `০${localNumber(index + 1, "bn")}` : String(index + 1).padStart(2, "0")}</span>
                      <strong>{labels[language][skill]}</strong>
                      <small>{completed.includes(sessionKey(lesson.id, skill)) ? s("✓ Complete", "✓ শেষ") : skill === "culture" ? s("video + culture inquiry", "ভিডিও + সংস্কৃতি নিয়ে খোঁজ") : s(`${skill} practice`, `${labels.bn[skill]} অনুশীলন`)}</small>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            <aside className="adaptive-tip">
              <span aria-hidden="true">↺</span>
              <div><strong>{s("Adaptive route", "নিজের মতো পথ")}</strong><p>{s("Start with Listen. If a check feels difficult, replay with the transcript, visit Read, then return. Confident learners can go straight to the skill they need.", "শুনি দিয়ে শুরু করো। কোনো যাচাই কঠিন লাগলে লেখা দেখে আবার শোনো, পড়ি অংশে যাও, তারপর ফিরে এসো। যারা ভালো পারে, তারা সোজা দরকারি দক্ষতায় যেতে পারে।")}</p></div>
            </aside>
          </div>
        )}

        {step === "listening" && (
          <div className="session-pane listening-session">
            <div className="lesson-pane-heading">
              <p className="modal-kicker">{paired(language, "Session 1 · Listening", "শোনা", "ধাপ ১ · শোনা")}</p>
              <h3>{s("Hear the whole message before decoding every word", "প্রতিটি শব্দ বোঝার আগে পুরো কথাটা শোনো")}</h3>
              <p lang="en">{mixed(extension.listening.focus)}</p>
            </div>
            <div className="audio-story-card">
              <div className="audio-story-controls">
                <button
                  type="button"
                  className={`primary-button coral ${isSpeaking ? "is-speaking" : ""}`}
                  disabled={!soundEnabled}
                  onClick={() => onSpeak(extension.dialogue.map((line) => line.bn).join(" "), "bn-BD", lessonClip(lesson.id, "dialogue"))}
                >
                  <span aria-hidden="true">♪</span>{isSpeaking ? s("Playing dialogue…", "কথোপকথন বাজছে…") : s("Play complete dialogue", "পুরো কথোপকথন শুনি")}
                </button>
                <button type="button" className="text-button" onClick={() => setShowTranscript((value) => !value)}>{showTranscript ? s("Hide transcript", "লেখাটা লুকাই") : s("Reveal transcript after listening", "শোনার পরে লেখাটা দেখি")}</button>
              </div>
              <p className="audio-source-note">{voiceText ? `${voiceText} · ` : ""}{s("Replay as often as needed · no timer", "যতবার খুশি আবার শোনো · সময়ের কোনো চাপ নেই")}</p>
              {showTranscript ? (
                <ol className="dialogue-transcript">
                  {extension.dialogue.map((line, index) => (
                    <li key={`${line.speaker}-${line.bn}`}>
                      <button type="button" onClick={() => onSpeak(line.bn, "bn-BD")} disabled={!soundEnabled} aria-label={s(`Play line ${index + 1}`, `${localNumber(index + 1, "bn")} নম্বর লাইন শোনো`)}>♪</button>
                      <div><span lang="bn">{line.speaker}</span><strong lang="bn">{line.bn}</strong><em lang="bn-Latn">/{line.transliteration}/</em><p lang="en">{line.en}</p></div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="transcript-gate"><span aria-hidden="true">👂</span><p>{s("First listen: names, places, feelings or actions.", "প্রথমবার শোনো: নাম, জায়গা, অনুভূতি বা কাজ।")}<br />{s("Second listen: exact words and sequence.", "দ্বিতীয়বার শোনো: ঠিক কোন শব্দ, কোন ক্রমে।")}</p></div>
              )}
            </div>
            <QuickCheckCard language={language} check={extension.listening.check} answer={listenAnswer} submitted={listenSubmitted} showAnswer={preview} onAnswer={(answer) => { setListenAnswer(answer); setListenSubmitted(false); }} onSubmit={submitListen} />
          </div>
        )}

        {step === "reading" && (
          <div className="session-pane reading-session">
            <div className="lesson-pane-heading">
              <p className="modal-kicker">{paired(language, "Session 2 · Reading", "পড়া", "ধাপ ২ · পড়া")}</p>
              <h3 lang="en">{mixed(extension.reading.title)}</h3>
              <p>{s("Read for the main idea, listen, then reread for detail. The English scaffold is optional.", "আগে মূল কথাটা বুঝতে পড়ো, তারপর শোনো, তারপর খুঁটিনাটি বুঝতে আবার পড়ো। ইংরেজি সহায়তা দেখা না-দেখা তোমার ইচ্ছা।")}</p>
            </div>
            <article className="guided-reading-card">
              <div className="guided-reading-toolbar">
                <button type="button" className="listen-line" disabled={!soundEnabled} onClick={() => onSpeak(extension.reading.bn, "bn-BD", lessonClip(lesson.id, "reading"))}>♪ {s("Read aloud in Bangla", "বাংলায় পড়া শুনি")}</button>
                <button type="button" className="text-button" onClick={() => setShowEnglish((value) => !value)}>{showEnglish ? s("Hide English scaffold", "ইংরেজি সহায়তা লুকাই") : s("Show English scaffold", "ইংরেজি সহায়তা দেখি")}</button>
              </div>
              <p className="guided-reading-bn" lang="bn">{extension.reading.bn}</p>
              {showEnglish && <p className="guided-reading-en" lang="en">{mixed(extension.reading.en)}</p>}
            </article>
            <div className="lesson-word-bank">
              <p className="modal-kicker">{s("Word bank · tap a word to hear it", "শব্দভান্ডার · শব্দ ছুঁয়ে শোনো")}</p>
              <div>{lesson.vocabulary.map((word, index) => (
                <button type="button" key={word.bn} disabled={!soundEnabled} aria-label={`${s("Listen", "শোনো")}: ${word.bn} (${word.en})`} onClick={() => onSpeak(word.bn, "bn-BD", lessonClip(lesson.id, `word-${index + 1}`))}>
                  <span aria-hidden="true">♪</span><strong lang="bn">{word.bn}</strong><small lang="en">{word.en}</small>
                </button>
              ))}</div>
            </div>
            <QuickCheckCard language={language} check={extension.reading.check} answer={readAnswer} submitted={readSubmitted} showAnswer={preview} onAnswer={(answer) => { setReadAnswer(answer); setReadSubmitted(false); }} onSubmit={submitRead} />
          </div>
        )}

        {step === "speaking" && (
          <div className="session-pane speaking-session">
            <div className="lesson-pane-heading">
              <p className="modal-kicker">{paired(language, "Session 3 · Speaking", "বলা", "ধাপ ৩ · বলা")}</p>
              <h3>{s("Rehearse, record locally if you choose, then reflect", "অনুশীলন করো, চাইলে এখানেই রেকর্ড করো, তারপর ভেবে দেখো")}</h3>
              <p lang="en">{mixed(extension.speaking.mission)}</p>
            </div>
            <section className="lesson-word-bank" aria-label={s("Sentence patterns", "বাক্যের ধাঁচ")}>
              <p className="modal-kicker">{s("Sentence patterns · listen, then say them", "বাক্যের ধাঁচ · শোনো, তারপর বলো")}</p>
              <ul className="pattern-listen-list">{lesson.patterns.map((pattern, index) => (
                <li key={pattern.bn}>
                  <button type="button" disabled={!soundEnabled} aria-label={`${s("Listen", "শোনো")}: ${pattern.bn} (${pattern.en})`} onClick={() => onSpeak(pattern.bn, "bn-BD", lessonClip(lesson.id, `pattern-${index + 1}`))}>
                    <span aria-hidden="true">♪</span><strong lang="bn">{pattern.bn}</strong><small lang="en">{pattern.en}</small>
                  </button>
                </li>
              ))}</ul>
            </section>
            <div className="roleplay-grid">
              <article><span>{optionLetter(0, language)}</span><h4>{s("First role", "প্রথম চরিত্র")}</h4><p lang="en">{mixed(extension.speaking.roleA)}</p></article>
              <article><span>{optionLetter(1, language)}</span><h4>{s("Second role", "দ্বিতীয় চরিত্র")}</h4><p lang="en">{mixed(extension.speaking.roleB)}</p></article>
            </div>
            <aside className="pronunciation-lab"><span aria-hidden="true">◌</span><div><p className="modal-kicker">{s("Pronunciation focus—not accent scoring", "উচ্চারণে মন দাও—টানের কোনো নম্বর নেই")}</p><p lang="en">{mixed(extension.speaking.pronunciation)}</p></div></aside>
            <section className="local-recorder">
              <div>
                <p className="modal-kicker">{s("Optional record & compare", "চাইলে রেকর্ড করে মিলিয়ে দেখো")}</p>
                <h4>{s("Your recording stays inside this tab", "তোমার রেকর্ডিং এই ট্যাবেই থাকে")}</h4>
                <p>{s("The microphone is requested only when you press record. Audio is never uploaded and disappears when you close or delete it.", "রেকর্ড বোতাম চাপলে তবেই মাইক্রোফোন চাওয়া হয়। শব্দ কোথাও পাঠানো হয় না; পাঠ বন্ধ করলে বা মুছে দিলে তা হারিয়ে যায়।")}</p>
              </div>
              <div className="recorder-actions">
                {recordingState === "idle" && <button type="button" className="primary-button coral" onClick={startRecording}>● {s("Allow mic & record", "মাইক চালু করে রেকর্ড করি")}</button>}
                {recordingState === "recording" && <button type="button" className="primary-button recording-button" onClick={stopRecording}>■ {s("Stop recording", "রেকর্ড থামাই")}</button>}
                {recordingUrl && <audio className="learner-recording" controls src={recordingUrl}>{s("Your browser cannot play this recording.", "তোমার ব্রাউজার এই রেকর্ডিং বাজাতে পারছে না।")}</audio>}
                {recordingUrl && <button type="button" className="text-button danger" onClick={deleteRecording}>{s("Delete this recording", "রেকর্ডিংটা মুছে ফেলি")}</button>}
              </div>
              {recordingError && <p className="recording-error" role="alert">{s(...recordingError)}</p>}
            </section>
            <div className="success-checklist">
              <p className="modal-kicker">{s("Reflect, don’t rank", "নম্বর নয়, নিজে ভেবে দেখো")}</p>
              {extension.speaking.success.map((item) => <label key={item}><input type="checkbox" /> <span lang="en">{mixed(item)}</span></label>)}
            </div>
            <button type="button" className="primary-button session-complete-button" onClick={() => complete("speaking")} disabled={currentSessionComplete}>{currentSessionComplete ? s("✓ Speaking session complete", "✓ বলার ধাপ শেষ") : s("I rehearsed and reflected", "আমি অনুশীলন করেছি আর ভেবে দেখেছি")}</button>
          </div>
        )}

        {step === "writing" && (
          <div className="session-pane writing-session">
            <div className="lesson-pane-heading">
              <p className="modal-kicker">{paired(language, "Session 4 · Writing", "লেখা", "ধাপ ৪ · লেখা")}</p>
              <h3>{s("Build a message with support, then make it yours", "সাহায্য নিয়ে একটা বার্তা বানাও, তারপর নিজের মতো করে লেখো")}</h3>
              <p lang="en">{mixed(extension.writing.mission)}</p>
            </div>
            <div className="writing-workbench">
              <div className="sentence-starters">
                <p className="modal-kicker">{s("Tap a starter to add it", "শুরুর একটা অংশ ছুঁয়ে যোগ করো")}</p>
                {extension.writing.starters.map((starter) => <button type="button" key={starter} onClick={() => setWriting((current) => `${current}${current ? "\n" : ""}${starter}`)} lang="bn">+ {starter}</button>)}
              </div>
              <label className="writing-pad">
                <span>{paired(language, "Your draft", "তোমার লেখা")}</span>
                <textarea value={writing} onChange={(event) => setWriting(event.target.value)} placeholder={s("Write, copy or trace here. English planning is allowed.", "এখানে লেখো, দেখে লেখো বা হাত বুলিয়ে লেখো। চাইলে আগে ইংরেজিতে ভেবে নিতে পারো।")} rows={8} />
                <small>{s(`${writing.length} characters · saved only while this lesson is open`, `${localNumber(writing.length, "bn")}টি অক্ষর · পাঠটি খোলা থাকা পর্যন্তই রাখা থাকে`)}</small>
              </label>
              <div className="model-answer-card">
                <button type="button" className="text-button" onClick={() => setShowModel((value) => !value)}>{showModel ? s("Hide model", "নমুনা লুকাই") : s("Reveal one possible model after trying", "চেষ্টা করার পরে একটা নমুনা দেখি")}</button>
                {showModel && <div><p lang="bn">{extension.writing.modelBn}</p><p lang="en">{mixed(extension.writing.modelEn)}</p><small>{s("Model, not the only correct answer", "এটা একটা নমুনা, একমাত্র সঠিক উত্তর নয়")}</small></div>}
              </div>
              <aside className="stretch-card"><span aria-hidden="true">↗</span><p><strong>{s("Stretch:", "আরও একটু:")}</strong> <span lang="en">{mixed(extension.writing.stretch)}</span></p></aside>
            </div>
            <button type="button" className="primary-button session-complete-button" disabled={writing.trim().length < 5 || currentSessionComplete} onClick={() => complete("writing")}>{currentSessionComplete ? s("✓ Writing session complete", "✓ লেখার ধাপ শেষ") : writing.trim().length < 5 ? s("Add a short draft to complete", "শেষ করতে ছোট করে কিছু লেখো") : s("I drafted and checked my message", "আমি লিখেছি আর মিলিয়ে দেখেছি")}</button>
          </div>
        )}

        {step === "culture" && (
          <div className="session-pane lesson-watch-pane">
            <div className="lesson-pane-heading">
              <p className="modal-kicker">{paired(language, "Session 5 · Video & culture", "দেখা ও সংস্কৃতি", "ধাপ ৫ · দেখা ও সংস্কৃতি")}</p>
              {video && !video.replaced ? <h3 lang="en">{mixed(video.title)}</h3> : <h3>{video ? s("A video chosen by your teacher", "তোমার শিক্ষকের বেছে নেওয়া ভিডিও") : s("Culture inquiry", "সংস্কৃতি নিয়ে খোঁজ")}</h3>}
              {video && !video.replaced ? <p lang="en">{mixed(video.reason)}</p> : <p>{video ? s("A teacher checked the original video and chose this one instead.", "একজন শিক্ষক আগের ভিডিওটি দেখে এর বদলে এটি বেছে নিয়েছেন।") : s("A teacher took this lesson’s video down after checking it. Talk through the three prompts below with a grown-up instead.", "একজন শিক্ষক দেখে এই পাঠের ভিডিওটি সরিয়ে নিয়েছেন। তার বদলে বড় কারও সঙ্গে নিচের তিনটি প্রশ্ন নিয়ে কথা বলো।")}</p>}
            </div>
            <div className="video-learning-cycle">
              {[{ label: s("Before", "দেখার আগে"), text: extension.watch.before }, { label: s("During", "দেখার সময়"), text: extension.watch.during }, { label: s("After", "দেখার পরে"), text: extension.watch.after }].map((item, index) => (
                <label key={index} className={watchChecks[index] ? "complete" : ""}>
                  <input type="checkbox" checked={watchChecks[index]} onChange={() => setWatchChecks((current) => current.map((value, itemIndex) => itemIndex === index ? !value : value))} />
                  <span>{localNumber(index + 1, language)}</span><div><strong>{item.label}</strong><p lang="en">{mixed(item.text)}</p></div>
                </label>
              ))}
            </div>
            {video && <>
              <div className="video-resource-meta">
                <span lang="en">YouTube</span>{video.channel && !video.replaced && <strong lang="en">{video.channel}</strong>}{video.duration && <span lang="en">{video.duration}</span>}{!video.replaced && <em lang="en">{mixed(extension.watch.segment)}</em>}
                <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer">{s("Open on YouTube ↗", "YouTube-এ খুলি ↗")}</a>
              </div>
              {videoLoaded ? (
                <div className="lesson-video-frame">
                  <iframe src={`https://www.youtube-nocookie.com/embed/${video.id}?rel=0&cc_load_policy=1`} title={video.replaced ? (language === "en" ? "A video chosen by your teacher" : "তোমার শিক্ষকের বেছে নেওয়া ভিডিও") : video.title} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
                </div>
              ) : (
                <div className="video-gate">
                  <div className="video-gate-art" aria-hidden="true"><span>▶</span><i lang="bn">নদী · গল্প · বাংলা</i></div>
                  <div><h4>{s("Load only when you are ready", "তৈরি হলে তবেই ভিডিও খোলো")}</h4><p>{s("YouTube stays disconnected until this button is pressed. Loading applies YouTube’s privacy terms. A grown-up should preview and supervise external media.", "এই বোতাম না চাপা পর্যন্ত YouTube-এর সঙ্গে কোনো সংযোগ হয় না। ভিডিও খুললে YouTube-এর গোপনীয়তার নিয়ম মানতে হয়। বাইরের ভিডিও বড় কেউ আগে দেখে নিলে আর পাশে থাকলে ভালো।")}</p><button type="button" className="primary-button coral" onClick={() => setVideoLoaded(true)}>{s("Load privacy-enhanced video ▶", "গোপনীয়তা-সুরক্ষিত ভিডিও খুলি ▶")}</button></div>
                </div>
              )}
            </>}
            <a className="playlist-card" href={`https://www.youtube.com/playlist?list=${lesson.playlist.id}`} target="_blank" rel="noreferrer"><span className="playlist-icon" aria-hidden="true">☷</span><span><small>{s("Curated follow-on playlist", "পরে দেখার জন্য বাছাই করা প্লেলিস্ট")}</small><strong lang="en">{lesson.playlist.title}</strong><em><span lang="en">{lesson.playlist.channel}</span> · {s("external YouTube", "বাইরের YouTube")}</em></span><span aria-hidden="true">↗</span></a>
            <aside className="media-review-note"><span aria-hidden="true" lang="en">CC</span><p><strong>{s("Caption and availability check:", "ক্যাপশন আর ভিডিও থাকা-না-থাকা:")}</strong> {s("captions and recommendations are controlled by YouTube and may change. Teachers check each lesson video; a video they mark unsuitable is taken out of the lesson.", "ক্যাপশন আর পরামর্শ দেওয়া ভিডিও YouTube ঠিক করে, তাই এগুলো বদলাতে পারে। শিক্ষকেরা প্রতিটি পাঠের ভিডিও দেখে নেন; অনুপযুক্ত মনে হলে ভিডিওটি পাঠ থেকে সরিয়ে দেওয়া হয়।")}</p></aside>
            <button type="button" className="primary-button session-complete-button" disabled={!watchChecks.every(Boolean) || currentSessionComplete} onClick={() => complete("culture")}>{currentSessionComplete ? s("✓ Video & culture session complete", "✓ দেখা ও সংস্কৃতির ধাপ শেষ") : watchChecks.every(Boolean) ? s("I completed before, during and after", "দেখার আগে, সময়ে আর পরে—তিনটিই করেছি") : s("Complete the three viewing prompts", "দেখার তিনটি কাজ শেষ করো")}</button>
          </div>
        )}

        {step === "mastery" && (
          <div className="session-pane lesson-check-pane">
            <div className="lesson-pane-heading">
              <p className="modal-kicker">{paired(language, "Session 6 · Mastery", "দক্ষতা যাচাই", "ধাপ ৬ · দক্ষতা যাচাই")}</p>
              <h3>{s("Show what you know, then choose the right review", "যা শিখেছ দেখাও, তারপর ঠিক অংশটা আবার দেখো")}</h3>
              <p>{s("No timer and no penalty. Explanations point back to the most useful session.", "সময়ের চাপ নেই, নম্বর কাটাও নেই। ব্যাখ্যা দেখে বুঝবে কোন ধাপে ফিরে গেলে সবচেয়ে কাজে লাগবে।")}</p>
            </div>
            <div className="lesson-quiz-list">
              {lesson.quiz.map((question, questionIndex) => {
                const selectedAnswer = quizAnswers[questionIndex];
                const correct = selectedAnswer === question.answer;
                return (
                  <fieldset className="lesson-quiz-question" key={question.question}>
                    <legend><span>{localNumber(questionIndex + 1, language)}</span><span lang="en">{mixed(question.question)}</span></legend>
                    <div className="lesson-quiz-options">
                      {question.options.map((option, optionIndex) => (
                        <button type="button" key={option} className={`${selectedAnswer === optionIndex ? "selected" : ""} ${quizSubmitted && selectedAnswer === optionIndex ? (correct ? "correct" : "wrong") : ""}`} aria-pressed={selectedAnswer === optionIndex} onClick={() => { setQuizAnswers((current) => ({ ...current, [questionIndex]: optionIndex })); setQuizSubmitted(false); }}><span>{optionLetter(optionIndex, language)}</span><span lang="en">{mixed(option)}</span>{preview && optionIndex === question.answer && <PreviewAnswer language={language} />}</button>
                      ))}
                    </div>
                    {quizSubmitted && selectedAnswer !== undefined && <p className={correct ? "answer-explanation correct" : "answer-explanation wrong"}><strong>{correct ? "✓" : "↻"}</strong><span lang="en">{mixed(question.explanation)}</span></p>}
                    {preview && !quizSubmitted && <p className="preview-answer-note" lang="en">{mixed(question.explanation)}</p>}
                  </fieldset>
                );
              })}
            </div>
            {quizSubmitted && (
              <div className={`mastery-result ${allQuizCorrect ? "success" : "retry"}`} role="status">
                <strong>{!allQuizAnswered ? s("Choose every answer first.", "আগে সবগুলো প্রশ্নের উত্তর বেছে নাও।") : allQuizCorrect ? s("Lesson mastered—your six-session badge is complete.", "পাঠ আয়ত্ত হয়েছে—ছয় ধাপের ব্যাজ পুরো হলো!") : s("A short review will help.", "একটু ঝালিয়ে নিলে ভালো হবে।")}</strong>
                {!allQuizCorrect && allQuizAnswered && <div><button type="button" onClick={() => changeStep("listening")}>{s("Replay Listen", "আবার শুনি")}</button><button type="button" onClick={() => changeStep("reading")}>{s("Review Read", "আবার পড়ি")}</button></div>}
              </div>
            )}
            <button className="primary-button lesson-check-button" type="button" onClick={submitMastery}>{s("Check my answers", "আমার উত্তর যাচাই করি")} <span aria-hidden="true">✓</span></button>
          </div>
        )}
      </div>

      <div className="lesson-modal-footer expanded-footer">
        <button type="button" onClick={() => changeStep(lessonSteps[Math.max(0, stepIndex - 1)])} disabled={stepIndex === 0}>← {s("Previous", "আগের")}</button>
        <span>{stepIndex === 0 ? labels[language].overview : s(`Session ${stepIndex} of 6`, `৬টির মধ্যে ${localNumber(stepIndex, "bn")} নম্বর ধাপ`)} {currentSessionComplete ? s("· ✓ complete", "· ✓ শেষ") : ""}</span>
        {stepIndex === lessonSteps.length - 1 ? <button className="primary-button" type="button" onClick={onClose}>{preview ? (language === "en" ? "Close preview ×" : "প্রিভিউ বন্ধ করুন ×") : s("Close lesson ×", "পাঠ বন্ধ করি ×")}</button> : <button className="primary-button" type="button" onClick={() => changeStep(lessonSteps[stepIndex + 1])}>{s("Next", "পরের")} <span aria-hidden="true">→</span></button>}
      </div>
    </div>
  );
}

