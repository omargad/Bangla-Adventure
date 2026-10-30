"use client";
import { createElement, type ReactNode } from "react";
import { useLanguageTitle } from "@/lib/use-language";
import { usePortalLanguage } from "./PortalShell";

type Text = [en: string, bn: string];

// Server-rendered pages inside the portal take the language from it through these.

/** Text in the portal's language. */
export function Say({ en, bn }: { en: string; bn: string }) {
  return usePortalLanguage() === "bn" ? bn : en;
}

/**
 * An element whose accessible name follows the portal's language. It carries that language itself, so
 * the name is read correctly inside an English-only block; mark its English content with lang="en".
 */
export function Labelled({ as, label: [en, bn], children, ...props }: { as: "nav" | "section" | "aside" | "div" | "td"; label: Text; children?: ReactNode; className?: string; role?: string }) {
  const language = usePortalLanguage();
  return createElement(as, { ...props, lang: language, "aria-label": language === "bn" ? bn : en }, children);
}

/** The tab title in the portal's language: the page's metadata title and its Bangla version. */
export function PageTitle({ title }: { title: Text }) {
  useLanguageTitle(usePortalLanguage(), title);
  return null;
}
