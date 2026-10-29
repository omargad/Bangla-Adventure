import { getSessionAdult, getStaffAccess } from "@/lib/auth";
import { getSessionStudent, passwordChangeRequired } from "@/lib/student-auth";
import { addLibrarySource, adminLibraryCatalog, getLibraryCatalog, libraryErrorResponse, resetLibrarySource, updateLibrarySource } from "@/lib/library-catalog";

export const dynamic = "force-dynamic";

// The NCTB textbook catalogue (client requirement R13): app/library-content.ts is
// the yearly baseline and knowledge_sources holds the administrator's changes
// (this year's links per book or class, hidden books, added sources). Reading is
// open to every signed-in user; only administrators change it, and every change
// is audited (lib/library-catalog.ts). Teachers add sources to their own classes.

const MAX_BODY = 20_000;

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY) return Response.json({ error: "This change is too large.", errorBn: "পরিবর্তনটি খুব বড়।" }, { status: 413 });
  try {
    const body = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch { /* answered below */ }
  return Response.json({ error: "Provide the source fields.", errorBn: "উৎসের তথ্যগুলো দিন।" }, { status: 400 });
}

const bookId = (value: unknown) => (typeof value === "string" && /^[a-z0-9-]{1,60}$/.test(value) ? value : "");
const badId = () => Response.json({ error: "Source id must be lowercase letters, digits and dashes.", errorBn: "উৎসের আইডি শুধু ছোট হাতের ইংরেজি অক্ষর, সংখ্যা ও ড্যাশ হতে পারে।" }, { status: 400 });

/** The books readers see; ?scope=admin gives administrators every book with who changed it last. */
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("scope") === "admin") {
    const actor = await getStaffAccess("admin");
    if (actor instanceof Response) return actor;
    try { return Response.json({ books: await adminLibraryCatalog() }); } catch (error) { return libraryErrorResponse(error); }
  }
  const adult = await getSessionAdult();
  const student = adult ? null : await getSessionStudent();
  if (!adult && !student) return Response.json({ error: "Sign in to view the textbook library.", errorBn: "পাঠ্যবইয়ের লাইব্রেরি দেখতে সাইন ইন করুন।" }, { status: 401 });
  // Like every other learning API, a student still on a temporary password chooses their own first.
  if (student?.mustChangePassword) return passwordChangeRequired();
  return Response.json({ books: await getLibraryCatalog() });
}

/** An administrator adds a source that is not in the shipped catalogue. */
export async function POST(request: Request) {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  try {
    const data = typeof body.data === "object" && body.data !== null ? body.data as Record<string, unknown> : body;
    return Response.json({ ok: true, ...(await addLibrarySource(actor, data)) }, { status: 201 });
  } catch (error) { return libraryErrorResponse(error); }
}

/** An administrator changes one book; fields the change leaves out are kept. */
export async function PUT(request: Request) {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  const id = bookId(body.id);
  if (!id) return badId();
  if (typeof body.data !== "object" || body.data === null || Array.isArray(body.data)) {
    return Response.json({ error: "Provide the source fields to store.", errorBn: "সংরক্ষণের জন্য উৎসের তথ্য দিন।" }, { status: 400 });
  }
  try { return Response.json({ ok: true, ...(await updateLibrarySource(actor, id, body.data as Record<string, unknown>)) }); }
  catch (error) { return libraryErrorResponse(error); }
}

/** An administrator undoes every change to a book. */
export async function DELETE(request: Request) {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  const id = bookId(body.id);
  if (!id) return badId();
  try { return Response.json(await resetLibrarySource(actor, id)); } catch (error) { return libraryErrorResponse(error); }
}
