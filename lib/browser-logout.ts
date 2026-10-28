import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "../db";
import { adultSessions, studentSessions } from "../db/schema";
import { hashSessionToken } from "./password";
import { safeReturnPath } from "./safe-redirect";

export async function destroyBrowserSessions(): Promise<void> {
  const jar = await cookies();
  const adult = jar.get("ba_adult_session")?.value;
  const student = jar.get("ba_student_session")?.value;
  if (!adult && !student) return;
  const db = await getDb();
  db.transaction((tx) => {
    if (adult) tx.delete(adultSessions).where(eq(adultSessions.tokenHash, hashSessionToken(adult))).run();
    if (student) tx.delete(studentSessions).where(eq(studentSessions.tokenHash, hashSessionToken(student))).run();
  });
}

export function browserLogoutResponse(destination: string): NextResponse {
  const response = new NextResponse(null, { status: 303, headers: { Location: safeReturnPath(destination), "Clear-Site-Data": '"cache"', "Cache-Control": "private, no-store" } });
  for (const name of ["ba_adult_session", "ba_student_session"]) response.cookies.set(name, "", { httpOnly: true, path: "/", maxAge: 0, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return response;
}
