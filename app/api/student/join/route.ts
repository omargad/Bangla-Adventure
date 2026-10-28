export async function POST() {
  return Response.json({ error: "Your teacher or administrator allocates classes. You do not need a class code." }, { status: 410 });
}
