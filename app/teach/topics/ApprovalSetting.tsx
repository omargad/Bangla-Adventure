"use client";

import { useState } from "react";
import type { Bilingual } from "@/app/topics-content";
import { formatNumber, formatWhen, type Language } from "@/lib/topic-model";
import { call, failure } from "./shared";

export type Publishing = {
  /** A teacher's new or edited topic waits for an administrator before students see it. */
  teacherTopicsNeedApproval: boolean;
  changedByName: string | null; changedAt: string | null;
  /** What saving a topic does for the signed-in account. */
  onSave: "admin" | "setting" | "review";
};

/** What an administrator is told after turning the switch on or off. */
export function settingChangedMessage(on: boolean, waiting: number): Bilingual {
  if (on) return {
    en: "Approval for teachers' topics is on. Teachers' new topics and edits wait for an administrator again.",
    bn: "শিক্ষকদের বিষয়ের অনুমোদন চালু হয়েছে। শিক্ষকদের নতুন বিষয় ও সম্পাদনা আবার প্রশাসকের অপেক্ষায় থাকবে।",
  };
  const off = {
    en: "Approval for teachers' topics is off. Teachers' new topics and edits are now published to students as soon as they save them.",
    bn: "শিক্ষকদের বিষয়ের অনুমোদন বন্ধ হয়েছে। এখন থেকে শিক্ষকেরা সংরক্ষণ করলেই নতুন বিষয় ও সম্পাদনা শিক্ষার্থীদের কাছে প্রকাশিত হবে।",
  };
  if (!waiting) return off;
  return { en: `${off.en} ${stillWaiting(waiting, "en")}`, bn: `${off.bn} ${stillWaiting(waiting, "bn")}` };
}

/** Topics saved before approval was turned off keep waiting: turning it off publishes nothing by itself. */
export function stillWaiting(count: number, language: Language): string {
  return language === "bn"
    ? `${formatNumber(count, "bn")}টি বিষয় এখনো অনুমোদনের অপেক্ষায়: অনুমোদন বন্ধ করলে সেগুলো প্রকাশিত হয় না, প্রশাসককে নিচে সেগুলো পর্যালোচনা করতে হবে।`
    : `${count === 1 ? "1 topic is" : `${count} topics are`} still waiting for approval: turning approval off does not publish ${count === 1 ? "it" : "them"}, so an administrator still reviews ${count === 1 ? "it" : "them"} below.`;
}

/**
 * The administrator's switch for "Teachers' topics need an administrator's approval", on the Topics page.
 * The server checks the administrator again and records every change in Recent changes.
 */
export default function ApprovalSetting({ publishing, waiting, language, onChanged }: {
  publishing: Publishing; waiting: number; language: Language; onChanged: (message: Bilingual) => void;
}) {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Bilingual | null>(null);
  const on = publishing.teacherTopicsNeedApproval;

  async function change(next: boolean) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await call("/api/admin/approval-settings", { method: "PUT", body: JSON.stringify({ teacherTopicsNeedApproval: next }) });
      onChanged(settingChangedMessage(next, waiting));
    } catch (caught) { setError(failure(caught)); }
    finally { setBusy(false); }
  }

  return (
    <section className="teach-panel approval-setting" aria-label={s("Who needs approval", "কার অনুমোদন লাগবে")}>
      <h2>{s("Who needs approval", "কার অনুমোদন লাগবে")}</h2>
      <label className="approval-switch">
        <input type="checkbox" role="switch" checked={on} disabled={busy} onChange={(event) => void change(event.target.checked)} />
        <span><strong>{s("Teachers' topics need an administrator's approval", "শিক্ষকদের লেখা বিষয়ে প্রশাসকের অনুমোদন প্রয়োজন")}</strong>{" "}
          <span className={`topic-status topic-status-${on ? "approved" : "pending"}`}>{on ? s("On", "চালু") : s("Off", "বন্ধ")}</span></span>
      </label>
      <p className="teach-note">{on
        ? s("On: a topic a teacher writes or edits waits on this page until an administrator reads all of it and approves it.", "চালু: শিক্ষক কোনো বিষয় লিখলে বা সম্পাদনা করলে, প্রশাসক পুরোটা পড়ে অনুমোদন না দেওয়া পর্যন্ত তা এই পাতায় অপেক্ষায় থাকে।")
        : s("Off: a topic a teacher writes or edits is published to students as soon as they save it. Each one is still recorded in Recent changes, and you can withdraw a topic at any time. A teacher's edit of a withdrawn topic still waits for an administrator.", "বন্ধ: শিক্ষক কোনো বিষয় লিখলে বা সম্পাদনা করলে সংরক্ষণের সঙ্গে সঙ্গে তা শিক্ষার্থীদের কাছে প্রকাশিত হয়। প্রতিটি তবুও “সাম্প্রতিক পরিবর্তন”-এ লেখা থাকে, এবং আপনি যেকোনো সময় বিষয় সরিয়ে নিতে পারেন। সরিয়ে নেওয়া বিষয়ে শিক্ষকের সম্পাদনা তবুও প্রশাসকের অপেক্ষায় থাকে।")}
        {" "}{s("Your own topics, as an administrator, are always published as soon as you save them.", "প্রশাসক হিসেবে আপনার নিজের বিষয় সবসময় সংরক্ষণের সঙ্গে সঙ্গে প্রকাশিত হয়।")}</p>
      {!on && waiting > 0 && <p className="teach-note" role="note">{stillWaiting(waiting, language)}</p>}
      {publishing.changedAt && <p className="teach-note"><small>{s(`Last changed by ${publishing.changedByName ?? "a former staff member"}, ${formatWhen(publishing.changedAt, "en")}.`, `সর্বশেষ বদলেছেন ${publishing.changedByName ?? "একজন সাবেক কর্মী"}, ${formatWhen(publishing.changedAt, "bn")}।`)}</small></p>}
      {error && <p className="auth-error" role="alert">{error[language]}</p>}
    </section>
  );
}
