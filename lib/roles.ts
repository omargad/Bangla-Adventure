export type AdultRole = "parent" | "teacher" | "admin";
export type AccountStatus = "active" | "suspended";
export type TeacherStatus = "none" | "pending" | "approved" | "rejected";
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
