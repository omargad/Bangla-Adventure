/**
 * CSV output helpers shared by server exports and browser downloads, so this
 * module must stay free of Node-only imports.
 */

/** Quote a cell and neutralise spreadsheet formulas (=, +, -, @) by prefixing an apostrophe. */
export function csvCell(cell: string | number): string {
  const value = String(cell);
  const prefix = typeof cell === "string" && /^\s*[-=+@]/.test(value) ? "'" : "";
  return `"${prefix}${value.replaceAll('"', '""')}"`;
}

export function csvRows(rows: Array<Array<string | number>>): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

/**
 * A `Content-Disposition` value that downloads `name` + `suffix`, e.g. a class name plus
 * "-grades.csv". `filename` is an ASCII slug for clients without RFC 6266 support, or
 * `fallback` when the name has no ASCII letters or digits; `filename*` carries the
 * original name in UTF-8, so a Bangla-only class name keeps its name.
 */
export function attachmentDisposition(name: string, suffix: string, fallback: string): string {
  const slug = name.normalize("NFKD").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || fallback;
  // Path, quote and control characters (and unpaired surrogates, which cannot be encoded) become "-".
  const original = Array.from(name, (char) => (char.length === 1 && char >= "\ud800" && char <= "\udfff" ? "-" : char)).join("")
    .replace(/[\u0000-\u001f\u007f"*/:<>?\\|]+/g, "-").replace(/^[\s-]+|[\s-]+$/g, "") || slug;
  const encoded = encodeURIComponent(`${original}${suffix}`).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${slug}${suffix}"; filename*=UTF-8''${encoded}`;
}
