"use client";

import Link from "next/link";
import { useLanguage } from "../../lib/use-language";
import AuthCard from "./AuthCard";
import { isAdminReturnPath } from "@/lib/safe-redirect";

export default function GrownUpsContent({ destination, initialMode = "sign-in", currentAccount }: { destination: string; initialMode?: "sign-in" | "sign-up"; currentAccount?: string }) {
  const [language, toggleLanguage] = useLanguage({ title: ["Grown-up sign in | Bangla Adventures", "বড়দের সাইন ইন | Bangla Adventures"] });
  const s = (en: string, bn: string) => (language === "bn" ? bn : en);
  const teacher = destination === "/teach" || destination === "/studio";
  const administrator = isAdminReturnPath(destination);

  return (
    <main className="adult-app auth-app" lang={language}>
      <header className="adult-header">
        <Link className="adult-brand" href="/">
          <span>বা</span>
          <span>
            <strong>Bangla Adventures</strong>
            <small>{administrator ? s("Administrator sign in", "প্রশাসকের সাইন ইন") : teacher ? s("Teacher sign in", "শিক্ষকের সাইন ইন") : s("Parent sign in", "অভিভাবকের সাইন ইন")}</small>
          </span>
        </Link>
        <nav aria-label={s("Platform information", "প্ল্যাটফর্মের তথ্য")}>
          <Link href="/">{s("Learner site", "শেখার সাইট")}</Link>
          <Link className="active" href="/grown-ups">{s("Grown-up sign in", "বড়দের সাইন ইন")}</Link>
          <Link href="/safety">{s("Safety & access", "নিরাপত্তা ও প্রবেশ")}</Link>
        </nav>
        <div className="adult-account">
          <button type="button" className="explore-lang" onClick={toggleLanguage}>
            {s("বাংলায় দেখুন", "View in English")}
          </button>
        </div>
      </header>
      <div className="auth-layout">
        <section className="auth-intro">
          <p className="adult-eyebrow">{s("For parents, carers and educators", "অভিভাবক, যত্নকারী ও শিক্ষকদের জন্য")}</p>
          <h1>{administrator ? s("Administrator sign in", "প্রশাসকের সাইন ইন") : teacher ? s("A little preparation. A world of discovery.", "ছোট্ট প্রস্তুতি। আবিষ্কারের এক নতুন জগৎ।") : s("Help your child’s next adventure begin.", "আপনার শিশুর নতুন অভিযানে পাশে থাকুন।")}</h1>
          {currentAccount && <p className="auth-note">{s("Currently signed in as", "বর্তমানে সাইন ইন করেছেন")}: <strong>{currentAccount}</strong>. {s("Enter the account you want to use below.", "নিচে যে অ্যাকাউন্ট ব্যবহার করতে চান তার তথ্য দিন।")}</p>}
          {administrator && <p>{s("Use the account assigned the administrator role. Creating a new account does not grant administration permissions.", "প্রশাসকের ভূমিকা দেওয়া অ্যাকাউন্ট ব্যবহার করুন। নতুন অ্যাকাউন্ট খুললেই প্রশাসকের অনুমতি পাওয়া যায় না।")}</p>}
          <p>
            {s(
              "Sign in or create an account to access learning content. Parents can monitor only the children linked to them by an administrator, without changing schoolwork or results. Teachers request approval to create classes and set activities.",
              "শেখার বিষয়বস্তু দেখতে সাইন ইন করুন বা অ্যাকাউন্ট তৈরি করুন। প্রশাসকের মাধ্যমে যুক্ত সন্তানদের অগ্রগতি অভিভাবকেরা দেখতে পারবেন, কাজ বা ফলাফল বদলাতে পারবেন না। শিক্ষকেরা অনুমোদনের পর ক্লাস ও কার্যক্রম তৈরি করেন।",
            )}
          </p>
          <ul>
            <li>{teacher ? s("Create classes and share activities after administrator approval.", "প্রশাসকের অনুমোদনের পর ক্লাস ও কার্যক্রম তৈরি করুন।") : s("Ask an administrator to link your child's student account.", "সন্তানের শিক্ষার্থী অ্যাকাউন্ট যুক্ত করতে প্রশাসককে বলুন।")}</li>
            <li>{teacher ? s("Review your own students' work and results.", "নিজের শিক্ষার্থীদের কাজ ও ফলাফল দেখুন।") : s("View your children's classes, pending activities and results.", "সন্তানের ক্লাস, বাকি কার্যক্রম ও ফলাফল দেখুন।")}</li>
            <li>{s("Parents cannot edit learning records or access other families' children.", "অভিভাবকেরা শেখার তথ্য বদলাতে বা অন্য পরিবারের সন্তানের তথ্য দেখতে পারবেন না।")}</li>
          </ul>
        </section>
        <AuthCard returnTo={destination} language={language} initialMode={initialMode} requireAdmin={administrator} />
      </div>
    </main>
  );
}
