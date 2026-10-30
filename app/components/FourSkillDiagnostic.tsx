"use client";

import { useMemo, useState } from "react";
import { levelBands, type CurriculumLevel } from "../curriculum";
import { bundledClip, type Clip } from "../../lib/voice-playback";
import { localNumber, type Language } from "../../lib/local-format";

type Skill = "listening" | "speaking" | "reading" | "writing";
type Cue = "tap" | "success" | "retry" | "star";

type DiagnosticProps = {
  language: Language;
  soundEnabled: boolean;
  onSpeak: (text: string, lang?: string, clip?: Clip) => void;
  onCue: (cue: Cue) => void;
  onChoose: (level: CurriculumLevel) => void;
  onClose: () => void;
};

type ChoiceTask = {
  id: string;
  kind: "choice";
  weight: number;
  prompt: string;
  stimulus?: string;
  audio?: string;
  /** The bundled clip in public/audio for the listening prompt. */
  audioClip?: string;
  options: string[];
  answer: number;
};

type PerformanceTask = {
  id: string;
  kind: "performance";
  prompt: string;
  support: string;
  example?: string;
};

type Task = ChoiceTask | PerformanceTask;

const skillOrder: Skill[] = ["listening", "speaking", "reading", "writing"];

const tasks: Record<Skill, Task[]> = {
  listening: [
    { id: "l1", kind: "choice", weight: 1, prompt: "Who is speaking?", audio: "হ্যালো! আমার নাম মায়া।", audioClip: "diagnostic-listen-1", options: ["Maya", "Rafi", "Bagh"], answer: 0 },
    { id: "l2", kind: "choice", weight: 2, prompt: "Which route should the traveller take?", audio: "প্রথমে সোজা যান। নদীর আগে বাঁ দিকে যান। বাজারটি স্কুলের পাশে।", audioClip: "diagnostic-listen-2", options: ["Straight, then left before the river", "Right after the river", "Back past the school"], answer: 0 },
    { id: "l3", kind: "choice", weight: 2, prompt: "Which summary preserves the speaker’s qualification?", audio: "ভাষা পরিচয়ের গুরুত্বপূর্ণ অংশ হতে পারে, তবে সবার অভিজ্ঞতা এক নয় এবং দক্ষতাই পরিচয়ের একমাত্র মাপকাঠি নয়।", audioClip: "diagnostic-listen-3", options: ["Language never affects identity", "Language can matter, but experience varies and proficiency is not the only measure", "Everyone must have the same language history"], answer: 1 },
  ],
  speaking: [
    { id: "s1", kind: "performance", prompt: "Without reading a model, greet someone, say your name and say how you are.", support: "Score 2 if you completed all three ideas understandably; 1 if you used at least one Bangla phrase; 0 if you are not ready yet.", example: "হ্যালো। আমার নাম ___. আমি ভালো আছি।" },
    { id: "s2", kind: "performance", prompt: "Speak for 30–45 seconds about a daily routine or a journey. Link at least three events.", support: "Score 2 for connected Bangla with a time linker; 1 for separate words/phrases with support; 0 if not yet.", example: "সকালে… তারপর… শেষে…" },
    { id: "s3", kind: "performance", prompt: "Explain two perspectives on language, culture or identity, then qualify your own view.", support: "Score 2 if you compared and qualified in Bangla; 1 if you expressed one supported view; 0 if not yet.", example: "এক অর্থে… তবে অন্য দিক থেকে…" },
  ],
  reading: [
    { id: "r1", kind: "choice", weight: 1, prompt: "Choose the sentence that matches the text.", stimulus: "মায়ার আম ভালো লাগে। সে পানি চায়।", options: ["Maya likes mango and asks for water", "Maya dislikes mango", "Maya asks for a book"], answer: 0 },
    { id: "r2", kind: "choice", weight: 2, prompt: "Why did the journey start late?", stimulus: "সকাল আটটায় ফেরি ছাড়ার কথা ছিল। কিন্তু ঘন কুয়াশার জন্য সবাই অপেক্ষা করল। কুয়াশা কমলে যাত্রা শুরু হলো।", options: ["The river was dry", "Thick fog delayed the ferry", "Everyone missed the market"], answer: 1 },
    { id: "r3", kind: "choice", weight: 2, prompt: "What is the writer’s main argument?", stimulus: "ঐতিহ্যকে অপরিবর্তিত বস্তু ভাবলে কারিগরদের সিদ্ধান্ত ও নতুন পরিস্থিতির প্রভাব আড়াল হতে পারে। ধারাবাহিকতা গুরুত্বপূর্ণ, কিন্তু পরিবর্তনও জীবন্ত ঐতিহ্যের অংশ।", options: ["Traditions must never change", "Change makes all heritage meaningless", "Living heritage can carry continuity while adapting, and makers should remain visible"], answer: 2 },
  ],
  writing: [
    { id: "w1", kind: "performance", prompt: "Write your name and one true preference in Bangla. Copying a starter is allowed.", support: "Score 2 for two understandable sentences; 1 for one word/phrase or a supported copy; 0 if not yet.", example: "আমার নাম ___. আমার ___ ভালো লাগে।" },
    { id: "w2", kind: "performance", prompt: "Write 3–4 connected sentences about a routine, route or past event.", support: "Score 2 if ideas are connected with a time, cause or contrast word; 1 for understandable separate sentences; 0 if not yet.", example: "প্রথমে… তারপর… কারণ/কিন্তু…" },
    { id: "w3", kind: "performance", prompt: "Write a short analytical paragraph that compares perspectives and names one limitation or uncertainty.", support: "Score 2 for a supported, qualified comparison; 1 for one clear reasoned claim; 0 if not yet.", example: "দুটির মধ্যে… অন্যদিকে… সীমাবদ্ধতা হলো…" },
  ],
};

const skillMeta: Record<Skill, { label: string; bn: string; icon: string; note: string; noteBn: string }> = {
  listening: { label: "Listening", bn: "শোনা", icon: "♪", note: "Three recordings from first meaning to nuanced interpretation", noteBn: "প্রথম অর্থ বোঝা থেকে সূক্ষ্ম ব্যাখ্যা পর্যন্ত তিনটি রেকর্ডিং" },
  speaking: { label: "Speaking", bn: "বলা", icon: "◉", note: "Three aloud performances with a transparent self-rubric", noteBn: "নিজে যাচাই করার স্পষ্ট নিয়মসহ জোরে বলার তিনটি কাজ" },
  reading: { label: "Reading", bn: "পড়া", icon: "অ", note: "Three short texts from literal meaning to argument", noteBn: "সরল অর্থ থেকে যুক্তি পর্যন্ত তিনটি ছোট লেখা" },
  writing: { label: "Writing", bn: "লেখা", icon: "✎", note: "Three productions; drafts stay in this open window", noteBn: "লেখার তিনটি কাজ; খসড়া শুধু এই খোলা জানালাতেই থাকে" },
};

const performanceOptions = [
  { score: 2, en: "I did this independently", bn: "আমি নিজে নিজে পেরেছি" },
  { score: 1, en: "I did part of it / used support", bn: "কিছুটা পেরেছি / সাহায্য নিয়েছি" },
  { score: 0, en: "Not yet—and that is useful to know", bn: "এখনো পারিনি—এটা জানাও কাজের" },
];

const levelIds: CurriculumLevel[] = ["pre-a1", "a1", "a2", "b1", "b2", "c1-c2"];

function scoreToLevel(score: number): CurriculumLevel {
  if (score <= 0) return "pre-a1";
  if (score === 1) return "a1";
  if (score === 2) return "a2";
  if (score === 3) return "b1";
  if (score === 4) return "b2";
  return "c1-c2";
}

export default function FourSkillDiagnostic({ language, soundEnabled, onSpeak, onCue, onChoose, onClose }: DiagnosticProps) {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const [skillIndex, setSkillIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showExamples, setShowExamples] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const currentSkill = skillOrder[skillIndex];
  const currentTasks = tasks[currentSkill];
  const allCurrentAnswered = currentTasks.every((task) => answers[task.id] !== undefined);

  const results = useMemo(() => {
    const scores = Object.fromEntries(skillOrder.map((skill) => {
      const score = tasks[skill].reduce((total, task) => {
        const response = answers[task.id];
        if (task.kind === "choice") return total + (response === task.answer ? task.weight : 0);
        return total + (response ?? 0);
      }, 0);
      return [skill, Math.min(5, score)];
    })) as Record<Skill, number>;
    const levels = Object.fromEntries(skillOrder.map((skill) => [skill, scoreToLevel(scores[skill])])) as Record<Skill, CurriculumLevel>;
    const levelIndexes = skillOrder.map((skill) => levelIds.indexOf(levels[skill])).sort((a, b) => a - b);
    const recommendedIndex = Math.min(levelIndexes[0] + (levelIndexes[2] - levelIndexes[0] >= 3 ? 1 : 0), levelBands.length - 1);
    return { scores, levels, recommended: levelBands[recommendedIndex] };
  }, [answers]);

  function setAnswer(taskId: string, value: number) {
    setAnswers((current) => ({ ...current, [taskId]: value }));
    setSubmitted(false);
    onCue("tap");
  }

  function moveNext() {
    if (!allCurrentAnswered) {
      setSubmitted(true);
      onCue("retry");
      return;
    }
    if (skillIndex < skillOrder.length - 1) {
      setSkillIndex((value) => value + 1);
      setSubmitted(false);
      onCue("success");
    } else {
      setSubmitted(true);
      onCue("success");
    }
  }

  const showResults = submitted && skillIndex === skillOrder.length - 1 && allCurrentAnswered;
  const part = s(`Part ${skillIndex + 1} of 4`, `৪টির মধ্যে ${localNumber(skillIndex + 1, "bn")} নম্বর অংশ`);
  // English mode shows each skill's Bangla name beside it; Bangla mode needs only the Bangla.
  const skillName = (skill: Skill) => language === "bn" ? skillMeta[skill].bn : <>{skillMeta[skill].label} <em lang="bn">· {skillMeta[skill].bn}</em></>;

  return (
    <div className="diagnostic-shell">
      <header className="diagnostic-header">
        <p className="modal-kicker">{s("Four-skill starting-point guide · চার দক্ষতার পথনির্দেশ", "চার দক্ষতার পথনির্দেশ")}</p>
        <h2>{s("Find the next useful challenge—not a label", "পরের দরকারি চ্যালেঞ্জটা খুঁজি—কোনো তকমা নয়")}</h2>
        <p>{s("Complete 12 short tasks in listening, speaking, reading and writing. This child- and heritage-learner guide is not an official CEFR test, diagnosis or certificate.", "শোনা, বলা, পড়া আর লেখার ১২টি ছোট কাজ শেষ করো। শিশু ও প্রবাসে বড় হওয়া শিক্ষার্থীদের জন্য এই নির্দেশিকা কোনো আনুষ্ঠানিক CEFR পরীক্ষা, মূল্যায়ন বা সনদ নয়।")}</p>
        <div className="diagnostic-skill-track" aria-label={part}>
          {skillOrder.map((skill, index) => <span key={skill} className={`${index === skillIndex ? "active" : ""} ${index < skillIndex ? "complete" : ""}`}><i>{skillMeta[skill].icon}</i>{s(skillMeta[skill].label, skillMeta[skill].bn)}</span>)}
        </div>
      </header>

      {!showResults ? (
        <div className="diagnostic-body">
          <div className="diagnostic-part-heading">
            <span>{skillMeta[currentSkill].icon}</span>
            <div><small>{part}</small><h3>{skillName(currentSkill)}</h3><p>{s(skillMeta[currentSkill].note, skillMeta[currentSkill].noteBn)}</p></div>
          </div>
          <div className="diagnostic-tasks">
            {currentTasks.map((task, index) => (
              <section className="diagnostic-task" key={task.id}>
                <div className="diagnostic-task-number">{index + 1}</div>
                <div className="diagnostic-task-content">
                  <h4>{task.prompt}</h4>
                  {task.kind === "choice" ? (
                    <>
                      {task.audio && <button type="button" className="diagnostic-audio-button" disabled={!soundEnabled} onClick={() => onSpeak(task.audio!, "bn-BD", task.audioClip ? bundledClip(task.audioClip) : undefined)}>♪ {language === "bn" ? "শোনো" : <>Listen <span lang="bn">· শোনো</span></>} <small>{s("Replay freely", "যতবার খুশি শোনো")}</small></button>}
                      {task.stimulus && <p className="diagnostic-stimulus" lang="bn">{task.stimulus}</p>}
                      <div className="diagnostic-options">
                        {task.options.map((option, optionIndex) => <button type="button" key={option} className={answers[task.id] === optionIndex ? "selected" : ""} aria-pressed={answers[task.id] === optionIndex} onClick={() => setAnswer(task.id, optionIndex)}><span>{String.fromCharCode(65 + optionIndex)}</span>{option}</button>)}
                      </div>
                    </>
                  ) : (
                    <>
                      {currentSkill === "writing" && <textarea value={drafts[task.id] || ""} onChange={(event) => setDrafts((current) => ({ ...current, [task.id]: event.target.value }))} placeholder={s("Draft here before choosing the closest rubric…", "সবচেয়ে মেলে এমন বর্ণনা বাছার আগে এখানে খসড়া লেখো…")} rows={4} />}
                      <button type="button" className="text-button diagnostic-example-toggle" onClick={() => setShowExamples((current) => ({ ...current, [task.id]: !current[task.id] }))}>{showExamples[task.id] ? s("Hide support", "সাহায্য লুকাও") : s("Show a starter after trying", "চেষ্টার পরে শুরুর একটি নমুনা দেখো")}</button>
                      {showExamples[task.id] && <p className="diagnostic-example" lang="bn">{task.example}</p>}
                      <p className="diagnostic-rubric">{task.support}</p>
                      <div className="performance-options" aria-label={s("Choose the closest performance description", "যে বর্ণনাটি সবচেয়ে মেলে, সেটি বেছে নাও")}>
                        {performanceOptions.map((option) => <button type="button" key={option.score} className={answers[task.id] === option.score ? "selected" : ""} aria-pressed={answers[task.id] === option.score} onClick={() => setAnswer(task.id, option.score)}><span>{option.score}</span>{s(option.en, option.bn)}</button>)}
                      </div>
                    </>
                  )}
                </div>
              </section>
            ))}
          </div>
          {submitted && !allCurrentAnswered && <p className="placement-error" role="alert">{s("Choose one response for all three tasks before continuing.", "এগোনোর আগে তিনটি কাজেরই একটি করে উত্তর বেছে নাও।")}</p>}
        </div>
      ) : (
        <div className="diagnostic-results">
          <div className={`diagnostic-recommendation ${results.recommended.tone}`}>
            <span><small>{s("Suggested lesson band", "প্রস্তাবিত পাঠের ধাপ")}</small><strong>{results.recommended.code}</strong></span>
            <div><h3>{language === "bn" ? results.recommended.titleBn : <>{results.recommended.title} <em lang="bn">· {results.recommended.titleBn}</em></>}</h3><p>{s("Begin where the least-developed skill can participate successfully. Use stronger-skill sessions as an accelerated route, and move one band whenever the work feels consistently too easy or too hard.", "যে দক্ষতা সবচেয়ে কম এগিয়েছে, সেটিও যেখানে ভালোভাবে অংশ নিতে পারে, সেখান থেকে শুরু করো। বেশি এগোনো দক্ষতার সেশন দিয়ে তাড়াতাড়ি এগোতে পারো। কাজ বারবার খুব সহজ বা খুব কঠিন লাগলে এক ধাপ ওপরে বা নিচে যাও।")}</p></div>
          </div>
          <div className="skill-profile-grid">
            {skillOrder.map((skill) => {
              const band = levelBands.find((item) => item.id === results.levels[skill])!;
              return <article key={skill}><div><span>{skillMeta[skill].icon}</span><h4>{language === "bn" ? skillMeta[skill].bn : <>{skillMeta[skill].label}<small lang="bn">{skillMeta[skill].bn}</small></>}</h4><strong>{band.code}</strong></div><div className="skill-meter"><span style={{ width: `${(results.scores[skill] / 5) * 100}%` }} /></div><p>{band.descriptor}</p></article>;
            })}
          </div>
          <aside className="diagnostic-caution"><span aria-hidden="true">i</span><p>{language === "bn"
            ? <><strong>এই প্রোফাইল দিয়ে কথা শুরু করা যায়।</strong> শোনা আর পড়ায় তিনটি নমুনা কাজ দেখা হয়েছে; বলা আর লেখায় শিক্ষার্থী বা বড়দের নিজের ভাবনা। কয়েকটি পাঠের পরে আবার যাচাই করা ভালো, আর আনুষ্ঠানিক মূল্যায়নের জন্য একজন যোগ্য শিক্ষকের সাহায্য নেওয়া উচিত।</>
            : <><strong>Use this profile as a conversation starter.</strong> Listening and reading use three sampled tasks; speaking and writing use learner/adult reflection. Recheck after several lessons and seek a qualified educator for formal assessment.</>}</p></aside>
        </div>
      )}

      <footer className="diagnostic-footer">
        <button type="button" className="outline-button" onClick={skillIndex === 0 || showResults ? onClose : () => { setSkillIndex((value) => value - 1); setSubmitted(false); }}>← {skillIndex === 0 || showResults ? s("Close", "বন্ধ করি") : s("Previous skill", "আগের দক্ষতা")}</button>
        {!showResults && <button type="button" className="primary-button" onClick={moveNext}>{skillIndex === skillOrder.length - 1 ? s("Build my skill profile", "আমার দক্ষতার প্রোফাইল বানাও") : s("Next skill", "পরের দক্ষতা")} →</button>}
        {showResults && <button type="button" className="primary-button" onClick={() => onChoose(results.recommended.id)}>{s("Open suggested lessons", "প্রস্তাবিত পাঠ খোলো")} →</button>}
      </footer>
    </div>
  );
}

