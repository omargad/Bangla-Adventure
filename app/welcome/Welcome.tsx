"use client";

import Link from "next/link";
import Image from "next/image";
import { useLanguage } from "@/lib/use-language";

export default function Welcome({ destination }: { destination: string }) {
  const [language, toggleLanguage] = useLanguage();
  const s = (en: string, bn: string) => language === "bn" ? bn : en;
  const target = encodeURIComponent(destination);
  return <main className="welcome-gate" lang={language}>
    <a className="skip-link" href="#choose-account">{s("Skip to sign in", "সাইন ইনে যান")}</a>
    <header className="adult-header">
      <Link className="adult-brand" href="/"><span>বা</span><span><strong>Bangla Adventures</strong><small>{s("Learn. Discover. Belong.", "শিখি। জানি। আপন হই।")}</small></span></Link>
      <nav aria-label={s("Welcome navigation", "স্বাগতম পাতার মেনু")}><Link href="/safety">{s("Safety & privacy", "নিরাপত্তা ও গোপনীয়তা")}</Link><button className="outline-button" onClick={toggleLanguage}>{s("বাংলা", "English")}</button></nav>
    </header>
    <section className="welcome-hero">
      <div><p className="adult-eyebrow">{s("A little curiosity. A world of discovery.", "ছোট্ট কৌতূহল। আবিষ্কারের নতুন জগৎ।")}</p><h1>{s("Your Bangla adventure starts with you.", "তোমার বাংলা অভিযান শুরু হোক।")}</h1><p>{s("A welcoming place to explore Bangla, stories and the culture of Bangladesh. Sign in or create an account to open your learning space.", "বাংলা, গল্প ও বাংলাদেশের সংস্কৃতি জানার একটি জায়গা। শেখার অংশ খুলতে সাইন ইন করো অথবা অ্যাকাউন্ট তৈরি করো।")}</p><a className="primary-button" href="#choose-account">{s("Let's get started", "শুরু করা যাক")} <span aria-hidden="true">→</span></a><div className="welcome-access-note"><svg width="20" height="22" viewBox="0 0 20 22" fill="none" aria-hidden="true"><rect x="3" y="9" width="14" height="11" rx="3" stroke="currentColor" strokeWidth="2"/><path d="M6 9V6a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2"/><circle cx="10" cy="14" r="1.5" fill="currentColor"/></svg><span>{s("Lessons and activities are available after sign-in.", "সাইন ইনের পর পাঠ ও কার্যক্রম দেখা যাবে।")}</span></div></div>
      <div className="welcome-illustration"><Image src="/hero-quest-map.png" width={1584} height={990} priority alt={s("A friendly illustrated river adventure in Bangladesh", "বাংলাদেশের নদীপথের অভিযানের ছবি")} /><span>{s("A new adventure is waiting", "নতুন অভিযান অপেক্ষা করছে")}</span></div>
    </section>
    <section className="welcome-accounts" id="choose-account" aria-labelledby="welcome-account-title">
      <div className="welcome-section-heading"><p className="adult-eyebrow">{s("Your own space to grow", "বেড়ে ওঠার নিজের জায়গা")}</p><h2 id="welcome-account-title">{s("How will you join us?", "কীভাবে যোগ দেবে?")}</h2></div>
      <div className="welcome-account-grid">
        <article className="welcome-role-card welcome-student"><span className="welcome-role-mark" aria-hidden="true">অ</span><h3>{s("I'm a student", "আমি শিক্ষার্থী")}</h3><p>{s("Open your lessons, try activities and find your classroom. Use your username, or ask a grown-up to help create your account.", "পাঠ দেখো, কার্যক্রম করো আর নিজের ক্লাসে যাও। ব্যবহারকারীর নাম দিয়ে সাইন ইন করো, অথবা অ্যাকাউন্ট তৈরিতে বড়দের সাহায্য নাও।")}</p><Link className="primary-button" href={`/student?returnTo=${target}`}>{s("Student sign in", "শিক্ষার্থীর সাইন ইন")}</Link><Link className="outline-button" href={`/student?mode=sign-up&returnTo=${target}`}>{s("Create student account", "শিক্ষার্থীর অ্যাকাউন্ট তৈরি")}</Link></article>
        <article className="welcome-role-card"><span className="welcome-role-mark" aria-hidden="true">বা</span><h3>{s("I'm a parent", "আমি অভিভাবক")}</h3><p>{s("Follow your children's classes and results in your family dashboard. An administrator links your account to your children.", "পরিবারের ড্যাশবোর্ডে সন্তানের ক্লাস ও ফলাফল দেখুন। প্রশাসক আপনার অ্যাকাউন্টের সঙ্গে সন্তানদের যুক্ত করবেন।")}</p><Link className="primary-button" href="/grown-ups?returnTo=%2Ffamily">{s("Parent sign in", "অভিভাবকের সাইন ইন")}</Link><Link className="outline-button" href="/grown-ups?mode=sign-up&returnTo=%2Ffamily">{s("Create parent account", "অভিভাবকের অ্যাকাউন্ট তৈরি")}</Link></article>
        <article className="welcome-role-card welcome-teacher"><span className="welcome-role-mark" aria-hidden="true">ক</span><h3>{s("I'm a teacher", "আমি শিক্ষক")}</h3><p>{s("Create a space for your class and follow your learners' work. Teacher access requires administrator approval.", "নিজের ক্লাস তৈরি করুন এবং শিক্ষার্থীদের কাজ দেখুন। শিক্ষক হিসেবে প্রবেশের জন্য প্রশাসকের অনুমোদন প্রয়োজন।")}</p><Link className="primary-button" href="/grown-ups?returnTo=%2Fteach">{s("Teacher sign in", "শিক্ষকের সাইন ইন")}</Link><Link className="outline-button" href="/grown-ups?mode=sign-up&returnTo=%2Fteach">{s("Request teacher account", "শিক্ষকের অ্যাকাউন্টের আবেদন")}</Link></article>
      </div>
    </section>
    <footer className="welcome-footer"><strong>Bangla Adventures</strong><span>{s("English and Bangla. Learn at your own pace.", "ইংরেজি ও বাংলা। নিজের গতিতে শিখুন।")}</span><Link href="/safety">{s("Privacy & access information", "গোপনীয়তা ও প্রবেশের তথ্য")}</Link></footer>
  </main>;
}
