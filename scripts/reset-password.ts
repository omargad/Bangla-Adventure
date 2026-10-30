import { resetPasswordOnServer } from "../lib/user-management";

const args = process.argv.slice(2);
const account = args[0]?.trim().toLowerCase() ?? "";
const wellFormed = account.includes("@") ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account) : /^[a-z0-9._-]{3,40}$/.test(account);
if (args.length !== 1 || !wellFormed) {
  console.error("Usage: npm run admin:reset-password -- <adult-email-or-student-username>");
  process.exit(1);
}
const reset = await resetPasswordOnServer(account);
if (!reset) {
  console.error("No active account matched.");
  process.exit(1);
}
/**
 * Names come from public sign-up forms, so a name could carry terminal escapes that hide or rewrite this
 * output. Control characters and bidi overrides are shown as �; ZWJ and ZWNJ stay, as Bangla spelling needs them.
 */
const printable = (text: string) => text.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, "\ufffd");
// The password appears here once and nowhere else: only its hash is stored and the audit row leaves it out.
const { user, temporaryPassword, approvalStatus } = reset;
console.log(`Temporary password for ${printable(user.displayName)} (${printable(user.kind === "adult" ? user.email : user.username)}): ${temporaryPassword}`);
console.log(user.kind === "adult"
  ? "Sign in with it at /grown-ups and choose a new password straight away; fresh recovery codes are then shown once. Every earlier session has been signed out."
  : "Sign in with it at /student and choose a new password straight away. Every earlier session has been signed out.");
if (approvalStatus !== "approved") console.log(`This account is ${approvalStatus === "pending" ? "still waiting for approval" : "declined"}, so sign-in stays closed until an administrator approves it.`);
