import type { Metadata } from "next";
import localFont from "next/font/local";
import type { Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import "./portal.css";
import PwaBridge from "./components/PwaBridge";
import { getSessionStatus } from "@/lib/session-status";
import { currentRelease } from "@/lib/release";
import { siteTitle } from "@/lib/site-title";
import { chosenLanguage, LANGUAGE_COOKIE } from "@/lib/language-choice";
import { LanguageProvider } from "@/lib/use-language";

// Geist and Geist Mono 1.900, copied from the geist npm package (SIL Open Font License, app/fonts/OFL.txt)
// so the build downloads no fonts. next/font/local names each font family after its constant, here
// "Geist" and "GeistMono"; the CSS reaches them only through the two variables.
const Geist = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const GeistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  preload: false,
});

export const metadata: Metadata = {
  title: siteTitle[0],
  description:
    "A bilingual platform for community-school kids outside Bangladesh: classroom topics on history, festivals, literature and arts sourced from official NCTB textbooks — plus an optional Bangla language corner.",
  manifest: "/manifest.webmanifest",
  applicationName: "Bangla Adventures",
  appleWebApp: { capable: true, title: "Bangla Adventures", statusBarStyle: "default" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#075b4c",
  colorScheme: "light",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [session, cookieStore] = await Promise.all([getSessionStatus(), cookies()]);
  // The reader's English/Bangla choice (kept by lib/use-language.ts), so each page is rendered in it from the first paint.
  const language = chosenLanguage(cookieStore.get(LANGUAGE_COOKIE)?.value) ?? "en";
  return (
    <html lang={language} className={`${Geist.variable} ${GeistMono.variable}`}>
      <body className="antialiased">
        <LanguageProvider initialLanguage={language}>
          {children}
          <PwaBridge initialSessionKey={session.key} release={currentRelease()} />
        </LanguageProvider>
      </body>
    </html>
  );
}
