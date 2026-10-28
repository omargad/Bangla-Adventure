export async function POST() {
  return Response.json({ error: "Class-code enrolment has been retired. Sign in to your student account; staff allocate classes." }, { status: 410 });
}
