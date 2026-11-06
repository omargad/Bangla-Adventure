/** The age bands a learner profile may have; creating and editing a profile accept the same ones. */
export const AGE_BANDS: ReadonlySet<string> = new Set(["6-8", "9-12", "13-15", "16+", "not-specified"]);

export const isAgeBand = (value: unknown): value is string => typeof value === "string" && AGE_BANDS.has(value);

export const INVALID_AGE_BAND = { error: "Choose one of the listed age bands.", errorBn: "তালিকার একটি বয়সসীমা বেছে নিন।" };
