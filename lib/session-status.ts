import { getSignedInAdult } from "./auth";
import { getSessionStudent } from "./student-auth";
import { accountHome } from "./roles";
import { ADULT_PASSWORD_PATH } from "./learning-policy";

export async function getSessionStatus() {
  // The key stays the same through a required password change, so open tabs are not sent away from the form.
  const adult = await getSignedInAdult();
  if (adult) return { authenticated: true, key: `adult:${adult.id}:${adult.role}`, role: adult.role, home: adult.mustChangePassword ? ADULT_PASSWORD_PATH : accountHome(adult) };
  const student = await getSessionStudent();
  if (student) return { authenticated: true, key: `student:${student.id}`, role: "student", home: "/student" };
  return { authenticated: false, key: "anonymous", role: null, home: "/welcome" };
}
