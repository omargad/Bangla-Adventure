import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** The files in public/, as the paths a browser asks for (/audio/hello-bn.ogg), read once in production. */
let publicFiles: { files: Set<string>; readAt: number } | undefined;
const DEVELOPMENT_REFRESH_MS = 2_000;

function listPublicFiles(directory: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...listPublicFiles(path.join(directory, entry.name), name));
    else if (entry.isFile()) found.push(name);
  }
  return found;
}

/**
 * True when the path names a file Next serves from public/. Only these and /_next/ build files count as
 * files in proxy.ts; any other path with a dot in it is a page or an API and gets their checks.
 */
export function isPublicFile(pathname: string, directory = path.join(process.cwd(), "public")): boolean {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return false; }
  const now = Date.now();
  const stale = !publicFiles || (process.env.NODE_ENV !== "production" && now - publicFiles.readAt > DEVELOPMENT_REFRESH_MS);
  if (stale) {
    let files: string[] = [];
    try { files = listPublicFiles(directory); } catch { /* no public/ folder: nothing is a public file */ }
    publicFiles = { files: new Set(files), readAt: now };
  }
  return publicFiles!.files.has(decoded);
}

/** Test hook: read public/ again on the next call. */
export function forgetPublicFiles(): void {
  publicFiles = undefined;
}

const PUBLIC_ROUTES = ["welcome", "grown-ups", "student", "safety"];
const PUBLIC_COMPONENTS = [
  "/app/welcome/Welcome.tsx", "/app/grown-ups/GrownUpsContent.tsx", "/app/grown-ups/AuthCard.tsx",
  "/app/student/StudentPortal.tsx", "/app/safety/SafetyContent.tsx", "/app/components/PwaBridge.tsx",
  // The root layout's LanguageProvider, on every page.
  "/lib/use-language.ts",
];
let cached: Set<string> | undefined;

export function isPublicScript(pathname: string): boolean {
  if (!pathname.startsWith("/_next/static/") || !pathname.endsWith(".js")) return false;
  if (cached && process.env.NODE_ENV === "production") return cached.has(pathname);
  const scripts = new Set<string>();
  const directory = path.join(process.cwd(), process.env.NEXT_DIST_DIR ?? ".next");
  const add = (files: unknown) => {
    if (Array.isArray(files)) for (const file of files) {
      if (typeof file === "string" && file.startsWith("static/") && file.endsWith(".js") && !file.includes("..")) scripts.add(`/_next/${file}`);
    }
  };
  try {
    const manifest = JSON.parse(readFileSync(path.join(directory, "build-manifest.json"), "utf8"));
    for (const key of ["rootMainFiles", "polyfillFiles", "lowPriorityFiles", "devFiles"]) add(manifest[key]);
  } catch { return false; }
  let complete = true;
  for (const route of PUBLIC_ROUTES) {
    try {
      const source = readFileSync(path.join(directory, "server", "app", route, "page_client-reference-manifest.js"), "utf8");
      const marker = /globalThis\.__RSC_MANIFEST\[[^\]]+\]\s*=\s*/.exec(source);
      if (!marker) { complete = false; continue; }
      const manifest = JSON.parse(source.slice(marker.index + marker[0].length).trim().replace(/;$/, ""));
      for (const [name, entry] of Object.entries(manifest.clientModules ?? {})) {
        if (PUBLIC_COMPONENTS.some((component) => name.replaceAll("\\", "/").endsWith(component))) add((entry as { chunks?: unknown }).chunks);
      }
    } catch { complete = false; }
  }
  if (complete && process.env.NODE_ENV === "production") cached = scripts;
  return scripts.has(pathname);
}
