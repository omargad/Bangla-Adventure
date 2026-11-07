import { getStaffAccess } from "@/lib/auth";
import { publishingFor, TEACHER_SOURCE_APPROVAL } from "@/lib/approval-settings";
import { addClassSource, classSourceErrorResponse, listClassSources, removeClassSource, reviewClassSource, updateClassSource } from "@/lib/class-sources";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

const classNotFound = () => Response.json({ error: "Class not found.", errorBn: "ক্লাসটি পাওয়া যায়নি।" }, { status: 404 });
const sourceNotFound = () => Response.json({ error: "Source not found.", errorBn: "উৎসটি পাওয়া যায়নি।" }, { status: 404 });

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  const text = await request.text().catch(() => "");
  if (text.length > 5_000) return Response.json({ error: "This source is too long.", errorBn: "উৎসটি খুব বড়।" }, { status: 413 });
  try {
    const body = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch { /* answered below */ }
  return Response.json({ error: "Provide the source fields.", errorBn: "উৎসের তথ্যগুলো দিন।" }, { status: 400 });
}
const sourceId = (body: Record<string, unknown>) => (typeof body.sourceId === "string" ? body.sourceId.slice(0, 80) : "");

/**
 * The sources of a class this teacher (or any administrator) manages, what saving a source does for this account now
 * (`onSave`: "admin", "setting" while "Teachers' class sources need an administrator's approval" is off, or "review"),
 * and whether teachers' sources wait for approval (`teachersNeedApproval`).
 */
export async function GET(_request: Request, context: RouteContext) {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  try {
    const sources = await listClassSources(actor, id);
    return sources ? Response.json({ sources, ...(await publishingFor(actor.id, TEACHER_SOURCE_APPROVAL)) }) : classNotFound();
  } catch (error) { return classSourceErrorResponse(error); }
}

/** Add a source that only this class's students and their parents see. */
export async function POST(request: Request, context: RouteContext) {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  try {
    const source = await addClassSource(actor, id, body);
    return source ? Response.json({ source }, { status: 201 }) : classNotFound();
  } catch (error) { return classSourceErrorResponse(error); }
}

/** Change a source's title, link or note. */
export async function PATCH(request: Request, context: RouteContext) {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  if (!sourceId(body)) return sourceNotFound();
  try {
    if (!(await listClassSources(actor, id))) return classNotFound();
    const source = body.approvalStatus !== undefined
      ? await reviewClassSource(actor, id, sourceId(body), body)
      : await updateClassSource(actor, id, sourceId(body), body);
    return source ? Response.json({ source }) : sourceNotFound();
  } catch (error) { return classSourceErrorResponse(error); }
}

export async function DELETE(request: Request, context: RouteContext) {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  try {
    if (!(await listClassSources(actor, id))) return classNotFound();
    return (await removeClassSource(actor, id, sourceId(body))) ? Response.json({ ok: true }) : sourceNotFound();
  } catch (error) { return classSourceErrorResponse(error); }
}
