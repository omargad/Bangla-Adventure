import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { Viewport } from "next";
import "./globals.css";
import "./portal.css";
import PwaBridge from "./components/PwaBridge";
import { getSessionStatus } from "@/lib/session-status";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "Bangla Adventures | Bangladesh's culture, history & literature for kids",
  description:
    "A bilingual platform for community-school kids outside Bangladesh: classroom topics on history, festivals, literature and arts sourced from official NCTB textbooks — plus an optional Bangla language corner.",
  manifest: "/manifest.webmanifest",
  applicationName: "Bangla Adventures",
  appleWebApp: { capable: true, title: "Bangla Adventures", statusBarStyle: "default" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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
  const session = await getSessionStatus();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="antialiased">
        {children}
        <PwaBridge initialSessionKey={session.key} release={process.env.NEXT_DIST_DIR ?? "development"} />
      </body>
    </html>
  );
}
