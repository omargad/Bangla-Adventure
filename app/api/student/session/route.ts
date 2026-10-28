import { getSessionStudent } from "@/lib/student-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const student = await getSessionStudent();
  if (!student) return Response.json({ error: "Student sign in required." }, { status: 401 });
  return Response.json({ student });
}
