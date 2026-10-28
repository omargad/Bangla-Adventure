import { readFileSync } from "node:fs";
import path from "node:path";

const PUBLIC_ROUTES = ["welcome", "grown-ups", "student", "safety"];
const PUBLIC_COMPONENTS = [
  "/app/welcome/Welcome.tsx", "/app/grown-ups/GrownUpsContent.tsx", "/app/grown-ups/AuthCard.tsx",
  "/app/student/StudentPortal.tsx", "/app/safety/SafetyContent.tsx", "/app/components/PwaBridge.tsx",
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
