import assert from "node:assert/strict";
import test from "node:test";

const { classServerError } = await import("../lib/class-errors.ts");
const { UserManagementError } = await import("../lib/user-management.ts");

test("class routes answer a database failure with a fixed bilingual message and keep the detail in the server log", async (t) => {
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args));
  const failure = classServerError(new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: classes.join_code"));
  assert.equal(failure.status, 500);
  const body = await failure.json();
  assert.deepEqual(body, { error: "Class information is not available right now. Please try again in a moment.", errorBn: "ক্লাসের তথ্য এখন পাওয়া যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।" });
  assert.ok(!JSON.stringify(body).includes("SQLITE"), "no database detail reaches the browser");
  assert.match(String(logged[0]?.[1]?.message), /UNIQUE constraint failed/, "but it is logged");

  assert.deepEqual(await classServerError(new Error("no such table: classes")).json(), { error: "The classroom service is still being set up.", errorBn: "ক্লাসরুম সেবাটি এখনো চালু করা হচ্ছে।" });
  const gradesFailed = { error: "Grades are not available right now. Please try again in a moment.", errorBn: "গ্রেডের তথ্য এখন পাওয়া যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।" };
  assert.deepEqual(await classServerError(new Error("disk I/O error"), "grades").json(), gradesFailed);
  assert.deepEqual(await classServerError("not an error", "grades").json(), gradesFailed);

  const refused = classServerError(new UserManagementError("Choose an approved teacher.", 404, "একজন অনুমোদিত শিক্ষক বেছে নিন।"));
  assert.equal(refused.status, 404);
  assert.deepEqual(await refused.json(), { error: "Choose an approved teacher.", errorBn: "একজন অনুমোদিত শিক্ষক বেছে নিন।" });
});
