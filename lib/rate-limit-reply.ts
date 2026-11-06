/**
 * The 429 answer of the sign-in, sign-up and account routes, saying how long to wait. The wait is the
 * limiter's own reset time (`retryAfterSeconds` from lib/rate-limit), rounded up to whole minutes or hours.
 */

/**
 * New accounts per hour from one connection, for adult and student sign-up alike. A school sign-up
 * session puts many families on one Wi-Fi address, so this is set for a room, not for one household.
 */
export const SIGN_UPS_PER_HOUR = 30;

/** Who is told to wait: adults are addressed politely (আপনি), students informally (তুমি). */
export type Voice = "adult" | "student";

/** How long until the limit resets, in both languages: "45 seconds", "15 minutes", "1 hour". */
export function waitDuration(retryAfterSeconds: number): { en: string; bn: string } {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  const [amount, en, bn] = seconds < 60 ? [seconds, "second", "সেকেন্ড"]
    : seconds < 3600 ? [Math.ceil(seconds / 60), "minute", "মিনিট"]
      : [Math.ceil(seconds / 3600), "hour", "ঘণ্টা"];
  return { en: `${amount} ${en}${amount === 1 ? "" : "s"}`, bn: `${amount.toLocaleString("bn-BD")} ${bn}` };
}

/** The message, in both languages, for a limit that resets in this many seconds. */
export function waitMessage(retryAfterSeconds: number, voice: Voice = "adult"): { error: string; errorBn: string } {
  const wait = waitDuration(retryAfterSeconds);
  return {
    error: `Too many attempts. Please wait ${wait.en} and try again.`,
    errorBn: `অনেকবার চেষ্টা করা হয়েছে। ${wait.bn} অপেক্ষা করে আবার ${voice === "student" ? "চেষ্টা করো" : "চেষ্টা করুন"}।`,
  };
}

/** 429 with the wait in the message, in `retryAfterSeconds` and in the Retry-After header. */
export function tooManyAttempts(retryAfterSeconds: number, voice: Voice = "adult"): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return Response.json(
    { ...waitMessage(seconds, voice), retryAfterSeconds: seconds },
    { status: 429, headers: { "Retry-After": String(seconds) } },
  );
}
