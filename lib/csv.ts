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
