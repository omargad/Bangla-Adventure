"use client";

import { useEffect, useState } from "react";
import { isPublicPath, loginDestination } from "@/lib/learning-policy";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function PwaBridge({ initialSessionKey, release }: { initialSessionKey: string; release: string }) {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
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
        else if (session.release !== release) window.location.reload();
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

  if (online && !installPrompt && !installed) return null;

  return (
    <div className={`pwa-status ${online ? "online" : "offline"}`} role="status">
      <span aria-hidden="true">{online ? "⌂" : "↯"}</span>
      <div><strong>{online ? installed ? "Bangla Adventures installed" : "Keep the river close" : "You are offline"}</strong><small>{online ? installed ? "The app can open from your device." : "Install the app for easier return visits." : "Connect to the internet and sign in to open learning content."}</small></div>
      {online && installPrompt && <button type="button" onClick={() => void install()}>Install</button>}
    </div>
  );
}
