"use client";

import { useState } from "react";
import type { Bilingual } from "@/app/topics-content";
import { call, failure } from "@/app/teach/topics/shared";
import { formatWhen, type Language } from "@/lib/topic-model";
import { gateLabel, optionLabel, specialistGates, specialistStatuses } from "./labels";

export type SpecialistCheck = {
  id: string; reviewType: string; status: string; reviewerName: string; notes: string;
  reviewedAt: string | null; updatedAt: string; recordedBy: string | null;
};

/**
 * The optional specialist checks (language, culture, learning design,
 * accessibility, media, legal) that used to be six required gates. Everyone's
 * records are shown; they never change what students see.
 */
export default function SpecialistChecks({ lessonId, language, checks, onChanged }: { lessonId: string; language: Language; checks: SpecialistCheck[]; onChanged: () => void }) {
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const [reviewType, setReviewType] = useState(specialistGates[0].id);
  const [status, setStatus] = useState("in-review");
  const [reviewerName, setReviewerName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Bilingual | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true); setError(null); setSaved(false);
    try {
      await call("/api/studio/reviews", { method: "POST", body: JSON.stringify({ lessonId, reviewType, status, reviewerName, notes }) });
      setSaved(true);
      onChanged();
    } catch (caught) { setError(failure(caught)); }
    finally { setSaving(false); }
  }

  return (
    <details className="teach-panel specialist-checks">
      <summary>{s("Detailed specialist checks (optional)", "বিশেষজ্ঞদের বিস্তারিত যাচাই (ঐচ্ছিক)")} ({checks.length.toLocaleString(language === "bn" ? "bn-BD" : "en-AU")})</summary>
      <p className="teach-note">{s(
        "Optional records from language, culture, learning-design, accessibility, media or legal specialists. Every staff member’s records are listed. They do not change what students see: only the lesson decision above does.",
        "ভাষা, সংস্কৃতি, শেখার নকশা, ব্যবহারযোগ্যতা, মিডিয়া বা আইন বিশেষজ্ঞদের ঐচ্ছিক রেকর্ড। সব কর্মীর রেকর্ড এখানে দেখা যায়। এগুলো শিক্ষার্থীরা কী দেখবে তা বদলায় না: শুধু ওপরের পাঠের সিদ্ধান্তই তা ঠিক করে।",
      )}</p>
      {checks.length === 0 ? <p>{s("No specialist checks recorded for this lesson.", "এই পাঠের জন্য কোনো বিশেষজ্ঞ যাচাই লেখা নেই।")}</p> : <div className="portal-table"><table>
        <thead><tr><th>{s("Check", "যাচাই")}</th><th>{s("Status", "অবস্থা")}</th><th>{s("Reviewer", "পর্যালোচক")}</th><th>{s("Recorded by", "লিখেছেন")}</th><th>{s("Notes", "নোট")}</th><th>{s("Updated", "হালনাগাদ")}</th></tr></thead>
        <tbody>{checks.map((check) => (
          <tr key={check.id}>
            <td>{gateLabel(check.reviewType, language)}</td>
            <td>{optionLabel(specialistStatuses, check.status, language)}</td>
            <td>{check.reviewerName || "—"}</td>
            <td>{check.recordedBy ?? s("a former staff member", "একজন সাবেক কর্মী")}</td>
            <td>{check.notes || "—"}</td>
            <td>{formatWhen(check.updatedAt, language)}</td>
          </tr>
        ))}</tbody>
      </table></div>}
      <div className="portal-editor">
        <h4>{s("Record your check", "আপনার যাচাই লিখুন")}</h4>
        <div className="topic-editor-row">
          <label>{s("Check", "যাচাই")}<select value={reviewType} onChange={(event) => setReviewType(event.target.value)}>{specialistGates.map((gate) => <option key={gate.id} value={gate.id}>{gate.label[language]}</option>)}</select></label>
          <label>{s("Status", "অবস্থা")}<select value={status} onChange={(event) => setStatus(event.target.value)}>{Object.keys(specialistStatuses).map((key) => <option key={key} value={key}>{optionLabel(specialistStatuses, key, language)}</option>)}</select></label>
          <label>{s("Reviewer name", "পর্যালোচকের নাম")}<input maxLength={80} value={reviewerName} onChange={(event) => setReviewerName(event.target.value)} /></label>
        </div>
        <p className="teach-note">{specialistGates.find((gate) => gate.id === reviewType)?.description[language]}</p>
        <label>{s("Notes", "নোট")}<textarea rows={3} maxLength={1500} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <div className="access-actions"><button type="button" className="outline-button" disabled={saving} onClick={() => void save()}>{s("Save check", "যাচাই সংরক্ষণ")}</button></div>
        {saved && <p className="teach-message" role="status">{s("Check saved.", "যাচাই সংরক্ষিত হয়েছে।")}</p>}
        {error && <p className="auth-error" role="alert">{error[language]}</p>}
      </div>
    </details>
  );
}
