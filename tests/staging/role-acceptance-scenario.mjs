import { randomBytes } from "node:crypto";
import path from "node:path";
import { expect } from "@playwright/test";

export const ROLE_SCREENSHOTS = [
  "admin-pending-users.png", "admin-class-publication.png", "teacher-students.png",
  "teacher-results.png", "teacher-attendance.png", "teacher-announcements.png", "teacher-lessons.png",
  "student-learning.png", "student-results.png", "student-topic.png", "student-lesson.png", "parent-learning.png",
];
export const ROLE_PHASES = ["verify-clean-clone", "browser-start", "fixture-signups", "bootstrap-admin", "admin-login", "account-approvals", "role-logins", "curriculum-review", "class-setup", "activity-review", "class-records", "topic-review", "student-work", "role-screens", "final-assertions", "cleanup"];
export const ROLE_OPERATIONS = ["navigate", "hydrate-form", "fill-identity", "fill-password", "submit", "destination", "server-session", "cookie", "reload", "loaded-data", "api", "screenshot", "guard", "bootstrap"];
export const SAFE_ROLE_ERRORS = new Set(["acceptance-api-status", "acceptance-assertion-failed", "browser-operation-failed", "guard-refused"]);
// Only these fixed category names are reported for unexpected browser errors, never their text.
export const ROLE_ISSUE_KINDS = ["page", "console", "http", "request"];
const check = (value) => { if (!value) throw new Error("acceptance-assertion-failed"); };

export function acceptanceIdentities(id) {
  check(/^[a-f0-9]{24}$/.test(id));
  return {
    admin: { kind: "adult", role: "admin", email: `qa-${id}-admin@example.invalid`, displayName: "QA Administrator", accountType: "parent" },
    teacher: { kind: "adult", role: "teacher", email: `qa-${id}-teacher@example.invalid`, displayName: "QA Tim Marco", accountType: "teacher" },
    parent: { kind: "adult", role: "parent", email: `qa-${id}@example.invalid`, displayName: "QA Frank Samo", accountType: "parent" },
    students: ["QA Camel", "QA Arif", "QA Nadia", "QA Waiting Student"].map((displayName, i) => ({ kind: "student", role: "student", username: `qa-${id}-student${i ? `-${i + 1}` : ""}`, displayName })),
  };
}

/**
 * One connected scenario used unchanged by fresh production-server CI and guarded disposable VPS QA.
 * @param {{browser: import('@playwright/test').Browser, baseURL: string, qaId: string, outputDirectory: string,
 * guard: (page: import('@playwright/test').Page, expected: {users: number, pendingTopics: number, pendingLessons: number}) => Promise<void>,
 * bootstrapAdmin: () => Promise<void>, onPhase?: (value: string) => void,
 * onOperation?: (value: string) => void, onStatus?: (value: number) => void, onIssue?: (kind: string) => void}} options
 */
export async function runRoleAcceptance({ browser, baseURL, qaId, outputDirectory, guard, bootstrapAdmin, onPhase = () => {}, onOperation = () => {}, onStatus = () => {}, onIssue = () => {} }) {
  const identities = acceptanceIdentities(qaId);
  const state = { users: 0, pendingTopics: 15, pendingLessons: 18 };
  const contexts = [], issues = [], expectedFailures = new Set();
  const credentials = new Map();
  let screenshotCount = 0, lastLoginStatus = 0;
  const phase = (name) => { check(ROLE_PHASES.includes(name)); onPhase(name); };
  const operation = (name) => { check(ROLE_OPERATIONS.includes(name)); onOperation(name); };
  const guarded = async (page) => { operation("guard"); await guard(page, { ...state }); };
  const flag = (kind) => { issues.push(kind); onIssue(kind); };
  const urlOf = (url) => new URL(url, baseURL);

  async function newHandle(identity) {
    const context = await browser.newContext({ baseURL, viewport: { width: 1365, height: 1000 }, locale: "en-AU", timezoneId: "UTC", serviceWorkers: "block" });
    contexts.push(context);
    await context.route("**/*", (route) => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.on("pageerror", () => flag("page"));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      // Expected permission-denial probes are checked by URL/status below; their generic browser messages add no error.
      if (/^Failed to load resource: the server responded with a status of (401|403|404|409)/.test(message.text())) return;
      flag("console");
    });
    page.on("response", (response) => {
      if (response.status() < 400) return;
      const url = new URL(response.url());
      if (url.origin !== baseURL) return;
      const key = `${response.request().method()} ${url.pathname} ${response.status()}`;
      if (!expectedFailures.has(key)) flag("http");
    });
    page.on("requestfailed", (request) => {
      if (new URL(request.url()).origin === baseURL && request.failure()?.errorText !== "net::ERR_ABORTED") flag("request");
    });
    await page.goto("/welcome");
    return { page, context, identity };
  }

  async function api(handle, endpoint, body, method = "POST", expected = 200) {
    await guarded(handle.page);
    operation("api");
    if (expected >= 400) expectedFailures.add(`${method} ${urlOf(endpoint).pathname} ${expected}`);
    const result = await handle.page.evaluate(async ({ endpoint, body, method }) => {
      const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, cache: "no-store", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json();
      return { status: response.status, data };
    }, { endpoint, body, method });
    onStatus(result.status);
    if (result.status !== expected) throw new Error("acceptance-api-status");
    return result.data;
  }

  async function signup(handle, identity) {
    const password = randomBytes(24).toString("base64url");
    const endpoint = identity.kind === "adult" ? "/api/auth/sign-up" : "/api/student/sign-up";
    const payload = identity.kind === "adult"
      ? { email: identity.email, displayName: identity.displayName, password, accountType: identity.accountType }
      : { username: identity.username, displayName: identity.displayName, password };
    const result = await api(handle, endpoint, payload, "POST", 201);
    check(result.pendingApproval === true && typeof (result.adult?.id ?? result.student?.id) === "string");
    identity.id = result.adult?.id ?? result.student?.id;
    credentials.set(identity.id, password);
    state.users += 1;
  }

  async function login(handle, record = true) {
    const { page, context, identity } = handle, adult = identity.kind === "adult";
    const home = adult ? identity.role === "admin" ? "/admin" : identity.role === "teacher" ? "/teach" : "/family" : "/student";
    await guarded(page);
    operation("navigate");
    // Every grown-up hydrates through the parent form before the role-specific redirect.
    await page.goto(adult ? `/grown-ups?returnTo=${encodeURIComponent(home)}` : "/student");
    operation("hydrate-form");
    if (identity.role !== "admin") {
      const name = page.getByLabel(identity.role === "teacher" ? "Your name (shown to learners)" : adult ? "Your name" : "Student name", { exact: true });
      await expect(async () => {
        await page.getByRole("tab", { name: "Create account", exact: true }).click();
        await expect(name).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 15_000, intervals: [250, 500, 1000] });
      await page.getByRole("tab", { name: "Sign in", exact: true }).click();
      await expect(name).toHaveCount(0);
    } else {
      // Admin mode deliberately has no account-creation tab. The password-visibility toggle is not needed:
      // load finishes before these existing CI-tested controlled inputs are filled.
      await page.waitForLoadState("networkidle");
    }
    operation("fill-identity");
    await page.getByLabel(adult ? "Email" : "Username", { exact: true }).fill(identity.email ?? identity.username);
    operation("fill-password");
    await page.getByLabel("Password", { exact: true }).fill(credentials.get(identity.id));
    operation("submit");
    const endpoint = adult ? "/api/auth/sign-in" : "/api/student/sign-in";
    const [response] = await Promise.all([
      page.waitForResponse((response) => response.url() === baseURL + endpoint && response.request().method() === "POST"),
      page.getByRole("button", { name: "Sign in", exact: true }).click(),
    ]);
    onStatus(response.status());
    lastLoginStatus = response.status();
    if (response.status() !== 200) throw new Error("acceptance-api-status");
    operation("destination");
    if (adult) await page.waitForURL(baseURL + home);
    else await expect(page.getByRole("heading", { name: "My Learning", exact: true })).toBeVisible();
    operation("server-session");
    const session = await api(handle, "/api/auth/session", undefined, "GET");
    check(session.authenticated === true && session.role === identity.role);
    operation("cookie");
    const name = adult ? "ba_adult_session" : "ba_student_session";
    const cookie = (await context.cookies()).find((cookie) => cookie.name === name && cookie.domain === "127.0.0.1");
    check(cookie?.secure === true && cookie.httpOnly === true && cookie.sameSite === "Lax" && cookie.path === "/");
    check(await page.evaluate((name) => !document.cookie.split(";").some((part) => part.trim().startsWith(`${name}=`)), name));
    operation("reload");
    await page.reload();
    const renewed = await api(handle, "/api/auth/session", undefined, "GET");
    check(renewed.authenticated === true && renewed.role === identity.role);
    check((await context.cookies()).find((item) => item.name === name && item.domain === "127.0.0.1")?.value === cookie.value);
    if (record) roleResults.push({ role: identity.role, realFormLogin: true, secureHttpOnlyCookie: true, cookieSurvivedReload: true, serverSessionAuthenticated: true, fullyLoadedScreens: true });
  }

  async function capture(handle, filename, ready) {
    check(ROLE_SCREENSHOTS.includes(filename));
    operation("loaded-data");
    await ready();
    await expect(handle.page.getByText(/^Loading(?:[\s…]|$)/).filter({ visible: true })).toHaveCount(0);
    check(await handle.page.locator('input[type="password"]').count() === 0);
    operation("screenshot");
    await handle.page.evaluate((role) => {
      document.getElementById("private-qa-banner")?.remove();
      const banner = document.createElement("div");
      banner.id = "private-qa-banner";
      banner.textContent = `DISPOSABLE QA — FICTIONAL ${role.toUpperCase()} — TEST DATA ONLY`;
      banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#132d46;color:white;padding:12px;text-align:center;font:bold 14px sans-serif";
      document.body.prepend(banner); document.body.style.paddingTop = "44px";
    }, handle.identity.role);
    await handle.page.screenshot({ path: path.join(outputDirectory, filename), fullPage: true, animations: "disabled" });
    screenshotCount += 1;
  }

  async function openClass(handle, name, section) {
    operation("navigate");
    await handle.page.goto("/teach");
    await handle.page.getByRole("button", { name: new RegExp(name) }).click();
    await expect(handle.page.getByRole("region", { name, exact: true })).toBeVisible();
    if (section) await handle.page.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: section, exact: true }).click();
  }

  const roleResults = [];
  try {
    phase("browser-start");
    const admin = await newHandle(identities.admin), teacher = await newHandle(identities.teacher), parent = await newHandle(identities.parent), student = await newHandle(identities.students[0]);
    phase("fixture-signups");
    for (const identity of [identities.admin, identities.teacher, identities.parent, ...identities.students]) await signup(admin, identity);
    phase("bootstrap-admin"); operation("bootstrap");
    await guarded(admin.page);
    await bootstrapAdmin();
    phase("admin-login"); await login(admin);
    const initial = await api(admin, "/api/admin/users", undefined, "GET");
    check(initial.approvals.total === 6);
    await capture(admin, "admin-pending-users.png", async () => {
      await expect(admin.page.getByRole("row").filter({ hasText: identities.teacher.email }).first()).toBeVisible();
      await expect(admin.page.getByText("Loading users…", { exact: true })).toHaveCount(0);
    });
    phase("account-approvals");
    for (const identity of [identities.teacher, identities.parent, ...identities.students.slice(0, 3)]) {
      const decided = await api(admin, `/api/admin/users/${identity.id}`, { kind: identity.kind, action: "approve" }, "PATCH");
      check(decided.user.approvalStatus === "approved");
    }
    const users = await api(admin, "/api/admin/users", undefined, "GET");
    check(users.approvals.total === 1 && users.approvals.users[0].id === identities.students[3].id);
    phase("role-logins"); await login(teacher); await login(parent); await login(student);
    const studentTwo = await newHandle(identities.students[1]); await login(studentTwo, false);

    phase("curriculum-review");
    const topicId = "pohela-boishakh", lessonId = "hello-me";
    const topic = (await api(teacher, `/api/topics/${topicId}`, undefined, "GET")).topic;
    if (topic.approvedVersion === null) {
      await api(admin, `/api/topics/${topicId}/versions/${topic.head.version}`, { decision: "approve", confirmedRead: true, note: "Disposable QA acceptance fixture only; not native-language publication sign-off." });
      state.pendingTopics = 14;
    }
    const lesson = await api(teacher, `/api/studio/lessons/${lessonId}`, undefined, "GET");
    if (!lesson.approvedSnapshot) {
      await api(admin, `/api/studio/lessons/${lessonId}`, { decision: "approve", confirmedRead: true, contentFingerprint: lesson.contentFingerprint, note: "Disposable QA acceptance fixture only; not native-language publication sign-off." });
      state.pendingLessons = 17;
    }

    phase("class-setup");
    const className = `QA River Explorers ${qaId.slice(0, 6)}`;
    const created = await api(teacher, "/api/classes", { name: className }, "POST", 201), classId = created.class.id;
    await api(teacher, `/api/classes/${classId}/students`, { studentIds: identities.students.slice(0, 3).map((student) => student.id) });
    await api(admin, "/api/admin/family-links", { studentId: identities.students[0].id, parentEmail: identities.parent.email, confirmed: true });
    const questions = [
      { prompt: "Which month starts the Bengali year?", options: ["Boishakh", "Poush"], answer: 0 },
      { prompt: "Which vehicle travels on a river?", options: ["Train", "Boat"], answer: 1 },
    ];
    const activityTitle = "Boishakh and River Journeys";
    const pending = await api(teacher, `/api/classes/${classId}/activities`, { title: activityTitle, instructions: "Read our Boishakh topic, discuss a river journey, then answer both questions.", topicId, questions }, "POST", 201);
    const activityId = pending.activity.id;
    await api(teacher, `/api/classes/${classId}/activities`, { title: "Our River Story — next lesson", instructions: "Prepare a short river story for our next class. This is waiting for Admin review.", topicId, questions }, "POST", 201);
    phase("activity-review");
    const before = await api(student, "/api/student/feed", undefined, "GET");
    check(before.classes.length === 1 && before.classes[0].activities.length === 0);
    await api(teacher, `/api/classes/${classId}/activities`, { activityId, approvalStatus: "approved", revision: pending.activity.revision }, "PATCH", 403);
    await openClass(admin, className, "Activities & quizzes");
    const review = admin.page.getByRole("region", { name: "Activities and submissions", exact: true }).getByRole("article").filter({ hasText: activityTitle });
    await review.getByText("Preview instructions and questions", { exact: true }).click();
    await expect(review).toContainText(questions[0].prompt); await expect(review).toContainText(questions[1].prompt);
    await guarded(admin.page);
    await review.getByRole("checkbox", { name: "I have reviewed all the content above.", exact: true }).check();
    const [reviewResponse] = await Promise.all([
      admin.page.waitForResponse((response) => response.url() === `${baseURL}/api/classes/${classId}/activities` && response.request().method() === "PATCH"),
      review.getByRole("button", { name: "Approve and publish", exact: true }).click(),
    ]);
    onStatus(reviewResponse.status()); check(reviewResponse.status() === 200);
    await capture(admin, "admin-class-publication.png", async () => {
      await expect(review).toContainText("Approved by Admin · published");
      await expect(admin.page.getByRole("region", { name: "Activities and submissions", exact: true }).getByText("Awaiting Admin approval · not published", { exact: true })).toBeVisible();
    });
    const after = await api(student, "/api/student/feed", undefined, "GET");
    check(after.classes[0].activities.length === 1 && after.classes[0].activities[0].id === activityId);

    phase("class-records");
    const allNotice = "River journeys: bring your Bangla reading worksheet.", parentNotice = "Parents: ask your child to explain a river journey.", studentNotice = "Students only: practise your quiz before Friday.";
    for (const [body, audience] of [[allNotice, "all"], [parentNotice, "parents"], [studentNotice, "students"]]) await api(teacher, `/api/classes/${classId}/announcements`, { body, audience }, "POST", 201);
    const today = new Date(), prior = new Date(today.getTime() - 7 * 86400_000);
    for (const [date, allPresent] of [[prior.toISOString().slice(0, 10), false], [today.toISOString().slice(0, 10), true]]) {
      await api(teacher, `/api/classes/${classId}/attendance`, { date, marks: identities.students.slice(0, 3).map((student, index) => ({ studentId: student.id, present: allPresent || index !== 1 })) }, "PUT");
    }

    phase("topic-review");
    const currentTopic = (await api(teacher, `/api/topics/${topicId}`, undefined, "GET")).topic;
    const edited = { ...currentTopic.head.content, title: { ...currentTopic.head.content.title, en: "QA Boishakh River Journey" }, baseVersion: currentTopic.head.version };
    const submitted = await api(teacher, `/api/topics/${topicId}`, edited, "PUT"); state.pendingTopics = 15;
    const hidden = await api(student, "/api/curriculum", undefined, "GET");
    check(hidden.topics.find((topic) => topic.id === topicId)?.title.en !== edited.title.en);
    await api(teacher, `/api/topics/${topicId}/versions/${submitted.version}`, { decision: "approve", confirmedRead: true }, "POST", 403);
    await api(admin, `/api/topics/${topicId}/versions/${submitted.version}`, { decision: "approve", confirmedRead: true, note: "Disposable QA class scenario; not native-language publication sign-off." }); state.pendingTopics = 14;
    const visible = await api(student, "/api/curriculum", undefined, "GET");
    check(visible.topics.find((topic) => topic.id === topicId)?.title.en === edited.title.en);

    phase("student-work");
    await student.page.goto("/student");
    await expect(student.page.getByRole("heading", { name: "My Learning", exact: true })).toBeVisible();
    await student.page.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: "My activities", exact: true }).click();
    await student.page.getByRole("button", { name: new RegExp(activityTitle) }).click();
    await student.page.getByRole("radio", { name: "Boishakh", exact: true }).check();
    await student.page.getByRole("radio", { name: "Boat", exact: true }).check();
    await guarded(student.page);
    await student.page.getByRole("button", { name: "Submit answers", exact: true }).click();
    await expect(student.page.getByText("You got 2 out of 2.", { exact: true })).toBeVisible();
    await api(studentTwo, "/api/student/submit", { activityId, answers: [0, 0] });
    await api(student, "/api/student/topic-progress", { topicId });
    const studentFeed = await api(student, "/api/student/feed", undefined, "GET");
    const parentFeed = await api(parent, "/api/family", undefined, "GET");
    const grades = await api(teacher, `/api/classes/${classId}/grades`, undefined, "GET");
    check(studentFeed.metrics.completedActivities === 1 && studentFeed.metrics.averagePercent === 100 && studentFeed.metrics.attendedSessions === 2 && studentFeed.metrics.recordedSessions === 2);
    check(parentFeed.children.length === 1 && parentFeed.children[0].id === identities.students[0].id && parentFeed.children[0].metrics.averagePercent === 100 && parentFeed.children[0].metrics.attendedSessions === 2);
    check(grades.rows.length === 2 && grades.rows.some((row) => row.studentName === identities.students[0].displayName && row.score === 2 && row.total === 2) && grades.rows.some((row) => row.studentName === identities.students[1].displayName && row.score === 1 && row.total === 2));
    check(studentFeed.classes[0].announcements.some((notice) => notice.body === studentNotice) && !studentFeed.classes[0].announcements.some((notice) => notice.body === parentNotice));
    check(parentFeed.announcements.some((notice) => notice.body === parentNotice) && !parentFeed.announcements.some((notice) => notice.body === studentNotice));
    await api(parent, `/api/classes/${classId}/students`, undefined, "GET", 403);
    await api(student, "/api/admin/users", undefined, "GET", 401);
    await guarded(student.page);
    const audio = await student.page.evaluate(async () => { const response = await fetch("/audio/hello-bn.ogg"); return { status: response.status, type: response.headers.get("content-type"), bytes: (await response.arrayBuffer()).byteLength }; });
    check(audio.status === 200 && audio.type?.startsWith("audio/") && audio.bytes > 100);

    phase("role-screens");
    await openClass(teacher, className, "Students");
    await capture(teacher, "teacher-students.png", async () => {
      for (const identity of identities.students.slice(0, 3)) await expect(teacher.page.getByText(identity.displayName, { exact: true }).first()).toBeVisible();
      await expect(teacher.page.getByText(identities.students[3].displayName, { exact: true })).toHaveCount(0);
    });
    const nav = teacher.page.getByRole("navigation", { name: "Portal navigation" });
    await nav.getByRole("button", { name: "Results", exact: true }).click();
    await capture(teacher, "teacher-results.png", async () => {
      const book = teacher.page.getByRole("region", { name: "Gradebook", exact: true });
      await expect(book.getByRole("row").filter({ hasText: identities.students[0].displayName })).toContainText("2/2");
      await expect(book.getByRole("row").filter({ hasText: identities.students[1].displayName })).toContainText("1/2");
    });
    await nav.getByRole("button", { name: "Attendance", exact: true }).click();
    await capture(teacher, "teacher-attendance.png", async () => {
      await expect(teacher.page.getByRole("table", { name: "Attendance by session" }).getByRole("row")).toHaveCount(3);
      await expect(teacher.page.getByRole("region", { name: "Attendance", exact: true })).toContainText("3 of 3 present");
    });
    await nav.getByRole("button", { name: "Announcements", exact: true }).click();
    await capture(teacher, "teacher-announcements.png", async () => { for (const notice of [allNotice, parentNotice, studentNotice]) await expect(teacher.page.getByText(notice, { exact: true })).toBeVisible(); });
    await teacher.page.goto("/studio?lesson=hello-me");
    await capture(teacher, "teacher-lessons.png", async () => {
      await expect(teacher.page.getByRole("region", { name: "Lesson details", exact: true })).toContainText("Approved");
      await expect(teacher.page.getByRole("region", { name: "Student view preview", exact: true })).toBeVisible();
    });
    await student.page.goto("/student");
    await capture(student, "student-learning.png", async () => {
      await expect(student.page.getByRole("heading", { name: "QA Boishakh River Journey", exact: true })).toBeVisible();
      await expect(student.page.getByRole("region", { name: "Class announcements" })).toContainText(allNotice);
      await expect(student.page.getByText(parentNotice, { exact: true })).toHaveCount(0);
    });
    await student.page.getByRole("navigation", { name: "Portal navigation" }).getByRole("button", { name: "My results", exact: true }).click();
    await capture(student, "student-results.png", async () => { await expect(student.page.getByText(activityTitle, { exact: true })).toBeVisible(); await expect(student.page.getByText("2/2", { exact: true })).toBeVisible(); });
    await student.page.goto(`/topics?topic=${topicId}`);
    await capture(student, "student-topic.png", async () => { await expect(student.page.getByRole("heading", { level: 1, name: "QA Boishakh River Journey", exact: true })).toBeVisible(); });
    await student.page.goto("/adventure?module=hello-me");
    await capture(student, "student-lesson.png", async () => {
      await expect(student.page.getByRole("navigation", { name: "Lesson sections", exact: true })).toBeVisible();
      await expect(student.page.getByRole("button", { name: /Listen/ }).first()).toBeVisible();
    });
    await parent.page.goto("/family");
    await capture(parent, "parent-learning.png", async () => {
      await expect(parent.page.getByRole("region", { name: identities.students[0].displayName, exact: true })).toContainText(activityTitle);
      await expect(parent.page.getByRole("region", { name: identities.students[0].displayName, exact: true })).toContainText("2 / 2");
      for (const identity of identities.students.slice(1)) await expect(parent.page.getByText(identity.displayName, { exact: true })).toHaveCount(0);
      await expect(parent.page.getByText(parentNotice, { exact: true })).toBeVisible();
      await expect(parent.page.getByText(studentNotice, { exact: true })).toHaveCount(0);
    });
    phase("final-assertions");
    await guarded(admin.page);
    check(screenshotCount === ROLE_SCREENSHOTS.length && issues.length === 0);
    return {
      roles: roleResults, screenshotCount, loginResponseStatus: lastLoginStatus,
      scenario: { fixtureAdults: 3, fixtureStudents: 4, enrolledStudents: 3, pendingAccounts: 1, classes: 1, publishedActivities: 1, pendingActivities: 1, submissions: 2, attendanceSessions: 2, attendanceMarks: 6, announcements: 3, linkedChildren: 1, accountApprovalFlow: true, teacherCannotPublish: true, activityHiddenUntilApproved: true, topicEditHiddenUntilApproved: true, parentOnlyLinkedChild: true, audienceFiltering: true, resultsMatchAcrossRoles: true, bundledAudioAvailable: true, lessonAvailable: true, unexpectedBrowserErrors: 0, fullyLoadedDashboards: true },
    };
  } finally {
    credentials.clear();
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  }
}
