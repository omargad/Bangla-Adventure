import type { Topic } from "../app/topics-content";

export type NarrationLanguage = "bn" | "en";
export const NARRATION_CHUNK_CHARACTERS = 1500;

/** The server and player split identically; no characters or Unicode surrogate pairs are lost. */
export function splitNarration(text: string): string[] {
  const characters = Array.from(text);
  const parts: string[] = [];
  for (let start = 0; start < characters.length;) {
    let end = Math.min(start + NARRATION_CHUNK_CHARACTERS, characters.length);
    if (end < characters.length) {
      for (let at = end - 1; at >= start + NARRATION_CHUNK_CHARACTERS / 2; at--) {
        if (/[\s.!?।]/u.test(characters[at])) { end = at + 1; break; }
      }
    }
    parts.push(characters.slice(start, end).join(""));
    start = end;
  }
  return parts;
}

function slotIndex(slot: string, prefix: string): number | null {
  const match = new RegExp(`^${prefix}:(0|[1-9][0-9]?)$`).exec(slot);
  return match ? Number(match[1]) : null;
}

/** Only learner-visible text is spoken. Quiz answers and source metadata are never included. */
export function topicNarrationText(topic: Pick<Topic, "title" | "tagline" | "sections" | "funFacts">, slot: string, language: NarrationLanguage): string | null {
  if (slot === "intro") return `${topic.title[language]}. ${topic.tagline[language]}`;
  const section = slotIndex(slot, "section");
  if (section !== null && topic.sections[section]) {
    const value = topic.sections[section];
    return `${value.heading[language]}. ${value.body[language]}`;
  }
  const fact = slotIndex(slot, "fact");
  return fact !== null ? topic.funFacts[fact]?.[language] ?? null : null;
}

export type NarratedActivity = { title: string; instructions: string; questions?: Array<{ prompt: string }>; questionsJson?: string };

export function activityNarrationText(activity: NarratedActivity, slot: string): string | null {
  if (slot === "instructions") return `${activity.title}. ${activity.instructions}`;
  const index = slotIndex(slot, "question");
  if (index === null) return null;
  let questions: unknown = activity.questions;
  if (!questions && activity.questionsJson) {
    try { questions = JSON.parse(activity.questionsJson); } catch { return null; }
  }
  if (!Array.isArray(questions)) return null;
  const question: unknown = questions[index];
  if (!question || typeof question !== "object" || !("prompt" in question) || typeof question.prompt !== "string") return null;
  return question.prompt;
}

export function detectNarrationLanguage(text: string): NarrationLanguage {
  return /[\u0980-\u09ff]/u.test(text) ? "bn" : "en";
}
