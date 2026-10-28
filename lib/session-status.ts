import { getSessionAdult } from "./auth";
import { getSessionStudent } from "./student-auth";
import { accountHome } from "./roles";

export async function getSessionStatus() {
  const adult = await getSessionAdult();
  if (adult) return { authenticated: true, key: `adult:${adult.id}:${adult.role}`, role: adult.role, home: accountHome(adult) };
  const student = await getSessionStudent();
  if (student) return { authenticated: true, key: `student:${student.id}`, role: "student", home: "/student" };
  return { authenticated: false, key: "anonymous", role: null, home: "/welcome" };
}
