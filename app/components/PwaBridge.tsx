"use client";

import { useEffect, useState } from "react";
import { isPublicPath, loginDestination } from "@/lib/learning-policy";
import { useLanguage } from "@/lib/use-language";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function PwaBridge({ initialSessionKey, release }: { initialSessionKey: string; release: string }) {
  // Start online on the server and the first client render (Node's navigator has no onLine), then read the real state.
  const [online, setOnline] = useState(true);
  const [language] = useLanguage({ documentLang: false });
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  // A new release is live. The page offers a reload rather than reloading itself, so nothing typed or shown once is lost.
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
    }
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    const check = async () => {
      const url = new URL(window.location.href);
      if ((isPublicPath(url) && !document.querySelector(".portal-shell")) || document.querySelector(".welcome-gate") || !navigator.onLine) return;
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (!response.ok) return;
        const session = await response.json();
        if (!session.authenticated) window.location.replace(loginDestination(url.pathname + url.search));
        else if (session.key !== initialSessionKey) window.location.replace(session.home);
        else setUpdateReady(session.release !== release);
      } catch { return; }
    };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) void check(); };
    window.addEventListener("pageshow", restored);
    window.addEventListener("focus", check);
    void check();
    const interval = window.setInterval(check, 60000);
    return () => { window.removeEventListener("pageshow", restored); window.removeEventListener("focus", check); window.clearInterval(interval); };
  }, [initialSessionKey, release]);

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  }

  const [title, hint] = !online
    ? [s("You are offline", "ইন্টারনেট সংযোগ নেই"), s("Connect to the internet and sign in to open learning content.", "শেখার বিষয় খুলতে ইন্টারনেটে যুক্ত হয়ে সাইন ইন করতে হবে।")]
    : updateReady
      ? [s("A new version is ready", "নতুন সংস্করণ এসেছে"), s("Reload when you have finished what you are doing here.", "এখানের কাজ শেষ হলে পাতাটি আবার খুলুন।")]
      : installed
        ? [s("Bangla Adventures installed", "Bangla Adventures ইনস্টল হয়েছে"), s("The app can open from your device.", "এখন ডিভাইস থেকেই অ্যাপটি খোলা যাবে।")]
        : [s("Keep the river close", "নদীর পথ থাকুক হাতের কাছে"), s("Install the app for easier return visits.", "সহজে আবার ফিরতে অ্যাপটি ইনস্টল করে রাখা যায়।")];
  const shown = !online || updateReady || installPrompt !== null || installed;

  // The live region is always in the page, empty while there is nothing to say, so screen readers announce the banner.
  return (
    <div className="pwa-announcer" role="status" aria-live="polite" aria-atomic="true">
      {shown && (
        <div className={`pwa-status ${online ? "online" : "offline"}`} lang={language}>
          <span aria-hidden="true">{!online ? "↯" : updateReady ? "↻" : "⌂"}</span>
          <div><strong>{title}</strong><small>{hint}</small></div>
          {online && (updateReady
            ? <button type="button" onClick={() => window.location.reload()}>{s("Reload", "আবার খুলুন")}</button>
            : installPrompt && <button type="button" onClick={() => void install()}>{s("Install", "ইনস্টল")}</button>)}
        </div>
      )}
    </div>
  );
}
