"use client";

import { useEffect, useId, useState } from "react";
import type { Bilingual } from "@/app/topics-content";
import type { ApprovalField, ApprovalSettings } from "@/lib/approval-settings";
import { formatNumber, formatWhen, type Language } from "@/lib/topic-model";
import { call, failure } from "./shared";

export type Publishing = {
  /** A teacher's new or edited topic waits for an administrator before students see it. */
  teacherTopicsNeedApproval: boolean;
  changedByName: string | null; changedAt: string | null;
  /** What saving a topic does for the signed-in account. */
  onSave: "admin" | "setting" | "review";
};

/** What is still waiting for an administrator, as GET /api/admin/approval-settings reports it. */
export type Waiting = { topics: number; activities: number; sources: number };
/** What GET and PUT /api/admin/approval-settings answer. */
export type ApprovalAnswer = { settings: ApprovalSettings; waiting: Waiting };
type Answer = ApprovalAnswer;

const waitingOf: Record<ApprovalField, keyof Waiting> = { teacherTopicsNeedApproval: "topics", teacherActivitiesNeedApproval: "activities", teacherSourcesNeedApproval: "sources" };

/** What an administrator is told after turning the topics switch on or off. */
export function settingChangedMessage(on: boolean, waiting: number, onTopicsPage = true): Bilingual {
  if (on) return {
    en: "Approval for teachers' topics is on. Teachers' new topics and edits wait for an administrator again.",
    bn: "শিক্ষকদের বিষয়ের অনুমোদন চালু হয়েছে। শিক্ষকদের নতুন বিষয় ও সম্পাদনা আবার প্রশাসকের অপেক্ষায় থাকবে।",
  };
  const off = {
    en: "Approval for teachers' topics is off. Teachers' new topics and edits are now published to students as soon as they save them.",
    bn: "শিক্ষকদের বিষয়ের অনুমোদন বন্ধ হয়েছে। এখন থেকে শিক্ষকেরা সংরক্ষণ করলেই নতুন বিষয় ও সম্পাদনা শিক্ষার্থীদের কাছে প্রকাশিত হবে।",
  };
  if (!waiting) return off;
  return { en: `${off.en} ${stillWaiting(waiting, "en", onTopicsPage)}`, bn: `${off.bn} ${stillWaiting(waiting, "bn", onTopicsPage)}` };
}

/**
 * Topics saved before approval was turned off keep waiting: turning it off publishes nothing by itself. On the Topics
 * page they are listed below; elsewhere the administrator is sent to the Topics page.
 */
export function stillWaiting(count: number, language: Language, onTopicsPage = true): string {
  const where = onTopicsPage ? { en: "below", bn: "নিচে" } : { en: "on the Topics page", bn: "“বিষয়” পাতায়" };
  return language === "bn"
    ? `${formatNumber(count, "bn")}টি বিষয় এখনো অনুমোদনের অপেক্ষায়: অনুমোদন বন্ধ করলে সেগুলো প্রকাশিত হয় না, প্রশাসককে ${where.bn} সেগুলো পর্যালোচনা করতে হবে।`
    : `${count === 1 ? "1 topic is" : `${count} topics are`} still waiting for approval: turning approval off does not publish ${count === 1 ? "it" : "them"}, so an administrator still reviews ${count === 1 ? "it" : "them"} ${where.en}.`;
}

/** Class activities or class sources saved before approval was turned off keep waiting, in their classes. */
export function classStillWaiting(kind: "activities" | "sources", count: number, language: Language): string {
  const one = count === 1;
  if (language === "bn") {
    const what = kind === "activities" ? "ক্লাসের কার্যক্রম" : "ক্লাসের উৎস";
    const where = kind === "activities" ? "“সব ক্লাস” থেকে ক্লাস খুলে “কার্যক্রম ও কুইজ”-এ" : "“সব ক্লাস” থেকে ক্লাস খুলে “ক্লাসের উৎস”-এ";
    return `${formatNumber(count, "bn")}টি ${what} এখনো অনুমোদনের অপেক্ষায়: অনুমোদন বন্ধ করলে সেগুলো প্রকাশিত হয় না, প্রশাসককে ${where} সেগুলো পর্যালোচনা করতে হবে।`;
  }
  const noun = kind === "activities" ? (one ? "class activity is" : "class activities are") : (one ? "class source is" : "class sources are");
  const where = kind === "activities" ? "Activities & quizzes" : "Class sources";
  return `${one ? "1" : count} ${noun} still waiting for approval: turning approval off does not publish ${one ? "it" : "them"}, so an administrator still reviews ${one ? "it" : "them"} in ${one ? "its class" : "their classes"} (All classes, then ${where}).`;
}

/** What an administrator is told after turning one of the switches on or off, with what is still waiting. */
export function switchChangedMessage(field: ApprovalField, on: boolean, waiting: number, onTopicsPage = true): Bilingual {
  if (field === "teacherTopicsNeedApproval") return settingChangedMessage(on, waiting, onTopicsPage);
  const activities = field === "teacherActivitiesNeedApproval";
  if (on) return activities
    ? { en: "Approval for teachers' class activities is on. Teachers' new activities wait for an administrator again.", bn: "শিক্ষকদের ক্লাসের কার্যক্রমের অনুমোদন চালু হয়েছে। শিক্ষকদের নতুন কার্যক্রম আবার প্রশাসকের অপেক্ষায় থাকবে।" }
    : { en: "Approval for teachers' class sources is on. Teachers' new and edited sources wait for an administrator again.", bn: "শিক্ষকদের ক্লাসের উৎসের অনুমোদন চালু হয়েছে। শিক্ষকদের নতুন ও সম্পাদিত উৎস আবার প্রশাসকের অপেক্ষায় থাকবে।" };
  const off = activities
    ? { en: "Approval for teachers' class activities is off. An activity a teacher adds to their own class is now published to the class as soon as they save it.", bn: "শিক্ষকদের ক্লাসের কার্যক্রমের অনুমোদন বন্ধ হয়েছে। এখন থেকে শিক্ষক নিজের ক্লাসে কার্যক্রম সংরক্ষণ করলেই তা ক্লাসে প্রকাশিত হবে।" }
    : { en: "Approval for teachers' class sources is off. A source a teacher adds or edits in their own class is now shown to the class as soon as they save it.", bn: "শিক্ষকদের ক্লাসের উৎসের অনুমোদন বন্ধ হয়েছে। এখন থেকে শিক্ষক নিজের ক্লাসে উৎস যোগ বা সম্পাদনা করে সংরক্ষণ করলেই তা ক্লাসে দেখা যাবে।" };
  if (!waiting) return off;
  const kind = activities ? "activities" : "sources";
  return { en: `${off.en} ${classStillWaiting(kind, waiting, "en")}`, bn: `${off.bn} ${classStillWaiting(kind, waiting, "bn")}` };
}

/** Each switch's label and what it means on and off, in both languages. */
const SWITCHES: Array<{ field: ApprovalField; label: Bilingual; on: Bilingual; off: Bilingual }> = [
  {
    field: "teacherTopicsNeedApproval",
    label: { en: "Teachers' topics need an administrator's approval", bn: "শিক্ষকদের লেখা বিষয়ে প্রশাসকের অনুমোদন প্রয়োজন" },
    on: { en: "On: a topic a teacher writes or edits waits on the Topics page until an administrator reads all of it and approves it.", bn: "চালু: শিক্ষক কোনো বিষয় লিখলে বা সম্পাদনা করলে, প্রশাসক পুরোটা পড়ে অনুমোদন না দেওয়া পর্যন্ত তা “বিষয়” পাতায় অপেক্ষায় থাকে।" },
    off: { en: "Off: a topic a teacher writes or edits is published to students as soon as they save it. Each one is still recorded in Recent changes, and you can withdraw a topic at any time. A teacher's edit of a withdrawn topic still waits for an administrator.", bn: "বন্ধ: শিক্ষক কোনো বিষয় লিখলে বা সম্পাদনা করলে সংরক্ষণের সঙ্গে সঙ্গে তা শিক্ষার্থীদের কাছে প্রকাশিত হয়। প্রতিটি তবুও “সাম্প্রতিক পরিবর্তন”-এ লেখা থাকে, এবং আপনি যেকোনো সময় বিষয় সরিয়ে নিতে পারেন। সরিয়ে নেওয়া বিষয়ে শিক্ষকের সম্পাদনা তবুও প্রশাসকের অপেক্ষায় থাকে।" },
  },
  {
    field: "teacherActivitiesNeedApproval",
    label: { en: "Teachers' class activities need an administrator's approval", bn: "শিক্ষকদের ক্লাসের কার্যক্রমে প্রশাসকের অনুমোদন প্রয়োজন" },
    on: { en: "On: an activity or quiz a teacher adds to their class waits in Activities & quizzes until an administrator approves it.", bn: "চালু: শিক্ষক নিজের ক্লাসে কোনো কার্যক্রম বা কুইজ দিলে, প্রশাসক অনুমোদন না দেওয়া পর্যন্ত তা “কার্যক্রম ও কুইজ”-এ অপেক্ষায় থাকে।" },
    off: { en: "Off: an activity or quiz a teacher adds to their own class is published to the class as soon as they save it, and students answer it while it is open. Each one is still recorded in Recent changes, and you can withdraw an activity at any time.", bn: "বন্ধ: শিক্ষক নিজের ক্লাসে কোনো কার্যক্রম বা কুইজ দিলে সংরক্ষণের সঙ্গে সঙ্গে তা ক্লাসে প্রকাশিত হয়, এবং খোলা থাকা পর্যন্ত শিক্ষার্থীরা উত্তর দিতে পারে। প্রতিটি তবুও “সাম্প্রতিক পরিবর্তন”-এ লেখা থাকে, এবং আপনি যেকোনো সময় কার্যক্রম সরিয়ে নিতে পারেন।" },
  },
  {
    field: "teacherSourcesNeedApproval",
    label: { en: "Teachers' class sources need an administrator's approval", bn: "শিক্ষকদের ক্লাসের উৎসে প্রশাসকের অনুমোদন প্রয়োজন" },
    on: { en: "On: a link a teacher adds or edits in Class sources waits until an administrator approves it.", bn: "চালু: শিক্ষক “ক্লাসের উৎস”-এ কোনো লিংক যোগ বা সম্পাদনা করলে, প্রশাসক অনুমোদন না দেওয়া পর্যন্ত তা অপেক্ষায় থাকে।" },
    off: { en: "Off: a link a teacher adds or edits in their own class is shown to the class's students and their parents as soon as they save it. Each one is still recorded in Recent changes, and you can withdraw a source at any time. A teacher's edit of a source you sent back or withdrew still waits for an administrator.", bn: "বন্ধ: শিক্ষক নিজের ক্লাসে কোনো লিংক যোগ বা সম্পাদনা করলে সংরক্ষণের সঙ্গে সঙ্গে তা ক্লাসের শিক্ষার্থী ও তাদের অভিভাবকদের কাছে দেখা যায়। প্রতিটি তবুও “সাম্প্রতিক পরিবর্তন”-এ লেখা থাকে, এবং আপনি যেকোনো সময় উৎস সরিয়ে নিতে পারেন। আপনি যে উৎস ফেরত পাঠিয়েছেন বা সরিয়ে নিয়েছেন, তাতে শিক্ষকের সম্পাদনা তবুও প্রশাসকের অপেক্ষায় থাকে।" },
  },
];

/**
 * The administrator's "Who needs approval" panel: one switch each for teachers' topics, class activities and class
 * sources. It reads and changes the settings through /api/admin/approval-settings, which checks the administrator
 * again and records every change in Recent changes. It is shown on the Topics page and on Administration › Who needs
 * approval; `onChanged` lets the page show the message (and reload what depends on the settings), otherwise the
 * panel shows it itself. A page that loads the settings itself (the Topics page, with its list) passes them as
 * `answer` and keeps them with `onAnswer`; otherwise the panel loads them. A page whose own heading already says "Who
 * needs approval" passes `heading={false}`.
 *
 * Each switch is named by its label alone (the On/Off badge is hidden from screen readers, as the switch's checked
 * state already says it) and described by what on or off means. While a change is being saved the switches stay
 * enabled, so keyboard focus stays where it is; further presses are ignored until the answer arrives.
 */
export default function ApprovalSetting({ language, onTopicsPage = false, onChanged, answer: given, onAnswer, heading = true }: {
  language: Language; onTopicsPage?: boolean; onChanged?: (message: Bilingual) => void;
  answer?: Answer; onAnswer?: (answer: Answer) => void; heading?: boolean;
}) {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const id = useId();
  const [own, setOwn] = useState<Answer | null>(null);
  const answer = given ?? own;
  const setAnswer = (next: Answer) => { if (given) onAnswer?.(next); else setOwn(next); };
  const loaded = Boolean(given);
  const [busy, setBusy] = useState<ApprovalField | null>(null);
  const [error, setError] = useState<Bilingual | null>(null);
  const [message, setMessage] = useState<Bilingual | null>(null);

  useEffect(() => {
    if (loaded) return;
    const controller = new AbortController();
    call<Answer>("/api/admin/approval-settings", { signal: controller.signal }).then(setOwn).catch((caught) => { if (!controller.signal.aborted) setError(failure(caught)); });
    return () => controller.abort();
  }, [loaded]);

  async function change(field: ApprovalField, next: boolean) {
    if (busy) return;
    setBusy(field); setError(null); setMessage(null);
    try {
      const changed = await call<Answer>("/api/admin/approval-settings", { method: "PUT", body: JSON.stringify({ [field]: next }) });
      setAnswer(changed);
      const note = switchChangedMessage(field, next, changed.waiting[waitingOf[field]], onTopicsPage);
      if (onChanged) onChanged(note); else setMessage(note);
    } catch (caught) { setError(failure(caught)); }
    finally { setBusy(null); }
  }

  const waitingNote = (field: ApprovalField, count: number) => field === "teacherTopicsNeedApproval"
    ? stillWaiting(count, language, onTopicsPage)
    : classStillWaiting(field === "teacherActivitiesNeedApproval" ? "activities" : "sources", count, language);

  return (
    <section className="teach-panel approval-setting" aria-label={s("Who needs approval", "কার অনুমোদন লাগবে")} aria-busy={busy !== null}>
      {heading && <h2>{s("Who needs approval", "কার অনুমোদন লাগবে")}</h2>}
      {message && <p className="teach-message" role="status">{message[language]}</p>}
      {!answer && !error && <p role="status">{s("Loading the approval settings…", "অনুমোদনের সেটিং লোড হচ্ছে…")}</p>}
      {answer && SWITCHES.map(({ field, label, on: onText, off: offText }) => {
        const on = answer.settings[field];
        const waiting = answer.waiting[waitingOf[field]];
        const last = answer.settings.lastChanged?.[field] ?? null;
        const noteId = `${id}-${field}-note`, waitingId = `${id}-${field}-waiting`;
        const waits = !on && waiting > 0;
        return (
          <div className="approval-setting-item" key={field} data-setting={field}>
            <label className="approval-switch">
              <input type="checkbox" role="switch" checked={on} aria-describedby={waits ? `${noteId} ${waitingId}` : noteId}
                onChange={(event) => void change(field, event.target.checked)} />
              <span><strong>{label[language]}</strong>{" "}
                <span className={`topic-status topic-status-${on ? "approved" : "pending"}`} aria-hidden="true">{on ? s("On", "চালু") : s("Off", "বন্ধ")}</span></span>
            </label>
            <p className="teach-note" id={noteId}>{on
              ? (field === "teacherTopicsNeedApproval" && onTopicsPage ? s("On: a topic a teacher writes or edits waits on this page until an administrator reads all of it and approves it.", "চালু: শিক্ষক কোনো বিষয় লিখলে বা সম্পাদনা করলে, প্রশাসক পুরোটা পড়ে অনুমোদন না দেওয়া পর্যন্ত তা এই পাতায় অপেক্ষায় থাকে।") : onText[language])
              : offText[language]}</p>
            {waits && <p className="teach-note" role="note" id={waitingId}>{waitingNote(field, waiting)}</p>}
            {last && <p className="teach-note"><small>{s(`Last changed by ${last.changedByName ?? "a former staff member"}, ${formatWhen(last.changedAt, "en")}.`, `সর্বশেষ বদলেছেন ${last.changedByName ?? "একজন সাবেক কর্মী"}, ${formatWhen(last.changedAt, "bn")}।`)}</small></p>}
          </div>
        );
      })}
      <p className="teach-note">{s("Each switch is on by default, and turning one on again affects only what teachers save from then on. Your own topics, class activities and class sources, as an administrator, are always published as soon as you save them.", "প্রতিটি সুইচ শুরুতে চালু থাকে, আর আবার চালু করলে শুধু এরপর শিক্ষকেরা যা সংরক্ষণ করবেন তাতেই প্রভাব পড়ে। প্রশাসক হিসেবে আপনার নিজের বিষয়, ক্লাসের কার্যক্রম ও ক্লাসের উৎস সবসময় সংরক্ষণের সঙ্গে সঙ্গে প্রকাশিত হয়।")}</p>
      {error && <p className="auth-error" role="alert">{error[language]}</p>}
    </section>
  );
}
