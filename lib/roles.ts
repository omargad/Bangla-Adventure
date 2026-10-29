export type AdultRole = "parent" | "teacher" | "admin";
export type AccountStatus = "active" | "suspended";
export type TeacherStatus = "none" | "pending" | "approved" | "rejected";
export type ApprovalStatus = "pending" | "approved" | "declined";
export type AccountAccess = { role: string; status: string; teacherStatus: string };

export function isRole(value: unknown): value is AdultRole {
  return value === "parent" || value === "teacher" || value === "admin";
}

export function isStatus(value: unknown): value is AccountStatus {
  return value === "active" || value === "suspended";
}

export function canManageUsers(account: AccountAccess | null): boolean {
  return account?.status === "active" && account.role === "admin";
}

export function canTeach(account: AccountAccess | null): boolean {
  return canManageUsers(account) || (account?.status === "active" && account.role === "teacher" && account.teacherStatus === "approved");
}

export function accountHome(account: AccountAccess): string {
  if (canManageUsers(account)) return "/admin";
  return canTeach(account) || account.teacherStatus === "pending" ? "/teach" : "/family";
}

/**
 * What sign-up, sign-in and recovery tell someone whose account an administrator has not approved,
 * as [English, Bangla]. Students are addressed as children, adults formally.
 */
export function approvalNotice(status: Exclude<ApprovalStatus, "approved">, audience: "adult" | "student"): [string, string] {
  if (status === "pending") return audience === "student"
    ? ["Your account is waiting for an administrator to approve it. You can sign in once it is approved.", "তোমার অ্যাকাউন্টটি প্রশাসকের অনুমোদনের অপেক্ষায় আছে। অনুমোদন পেলে সাইন ইন করতে পারবে।"]
    : ["Your account is waiting for an administrator to approve it. You can sign in once it is approved.", "আপনার অ্যাকাউন্টটি প্রশাসকের অনুমোদনের অপেক্ষায় আছে। অনুমোদনের পর সাইন ইন করতে পারবেন।"];
  return audience === "student"
    ? ["An administrator has not approved this account. Ask your teacher or a grown-up for help.", "প্রশাসক এই অ্যাকাউন্টটি অনুমোদন করেননি। শিক্ষক বা বড়দের সাহায্য নাও।"]
    : ["An administrator has not approved this account. Please contact your administrator.", "প্রশাসক এই অ্যাকাউন্টটি অনুমোদন করেননি। অনুগ্রহ করে প্রশাসকের সঙ্গে যোগাযোগ করুন।"];
}
