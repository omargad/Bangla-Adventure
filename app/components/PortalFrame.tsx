"use client";
import type { ReactNode } from "react";
import { useLanguage } from "@/lib/use-language";
import PortalShell, { type PortalRole } from "./PortalShell";
export default function PortalFrame({ role, name, active, children }: { role: PortalRole; name: string; active?: string; children: ReactNode }) {
  const [language, toggleLanguage] = useLanguage();
  return <PortalShell role={role} name={name} active={active} language={language} toggleLanguage={toggleLanguage}>{children}</PortalShell>;
}
