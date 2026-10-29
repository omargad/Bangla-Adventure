import { getDb } from "../../../../db";
import { mediaAssets, userAuditEvents } from "../../../../db/schema";
import { lessons } from "../../../curriculum";
import { getSessionAdult, getStaffAccess } from "@/lib/auth";
import { canTeach } from "@/lib/roles";
import { putMediaObject } from "@/lib/storage";
import { lessonErrorResponse, readLessonBody, reviewRecording } from "@/lib/lesson-approval";

export const dynamic = "force-dynamic";
const maxBytes = 12 * 1024 * 1024;
const slots = /^(dialogue|reading|word-[1-6]|pattern-[1-2])$/;

export async function POST(request: Request) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required." }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  const lessonId = value(form.get("lessonId"), 60);
  const slot = value(form.get("slot"), 30);
  const speakerName = value(form.get("speakerName"), 80);
  const dialect = value(form.get("dialect"), 80) || "Bangladesh standard";
  const consentConfirmed = form.get("consentConfirmed") === "true";
  if (!(file instanceof File) || !lessons.some((lesson) => lesson.id === lessonId) || !slots.test(slot)) return Response.json({ error: "Choose a valid lesson, audio slot and file.", errorBn: "সঠিক পাঠ, অডিওর অংশ ও ফাইল বেছে নিন।" }, { status: 400 });
  if (!file.type.startsWith("audio/") || file.size <= 0 || file.size > maxBytes) return Response.json({ error: "Upload an audio file no larger than 12 MB.", errorBn: "১২ MB-এর বেশি নয় এমন একটি অডিও ফাইল দিন।" }, { status: 400 });
  if (!speakerName || !consentConfirmed) return Response.json({ error: "Speaker credit and recorded consent confirmation are required.", errorBn: "বক্তার নাম ও সম্মতির নিশ্চয়তা দিতে হবে।" }, { status: 400 });

  const extension = safeExtension(file.name, file.type);
  const objectKey = `human-audio/${lessonId}/${slot}/${crypto.randomUUID()}.${extension}`;
  await putMediaObject(objectKey, Buffer.from(await file.arrayBuffer()));
  const db = await getDb();
  const [asset] = await db.insert(mediaAssets).values({
    id: crypto.randomUUID(),
    ownerEmail: user.email,
    lessonId,
    slot,
    objectKey,
    originalName: file.name.slice(0, 180),
    contentType: file.type,
    byteSize: file.size,
    speakerName,
    dialect,
    consentConfirmed,
    reviewStatus: "pending",
  }).returning();
  await db.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId: user.id, targetId: lessonId, targetType: "lesson", action: "lesson-audio-uploaded", detailsJson: JSON.stringify({ recordingId: asset.id, slot }) });
  return Response.json({ asset }, { status: 201 });
}

/** Any teacher or administrator reviews any staff member's recording; see reviewRecording. */
export async function PATCH(request: Request) {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  const body = await readLessonBody(request);
  if (body instanceof Response) return body;
  try { return Response.json({ asset: await reviewRecording(actor.id, body) }); }
  catch (error) { return lessonErrorResponse(error); }
}

function value(input: FormDataEntryValue | unknown, maxLength: number) {
  return typeof input === "string" ? input.trim().slice(0, maxLength) : "";
}

function safeExtension(name: string, contentType: string) {
  const raw = name.split(".").at(-1)?.toLowerCase();
  if (raw && ["mp3", "wav", "ogg", "m4a", "webm", "aac"].includes(raw)) return raw;
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("mpeg")) return "mp3";
  return "webm";
}
