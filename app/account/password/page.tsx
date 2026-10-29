import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSignedInAdult } from "@/lib/auth";
import { ADULT_PASSWORD_PATH, passwordChangeReturnPath } from "@/lib/learning-policy";
import AdultPasswordForm from "./AdultPasswordForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Choose your password | Bangla Adventures",
  description: "Replace the temporary password an administrator gave you with one only you know.",
  robots: { index: false, follow: false },
};

// Uses getSignedInAdult: this page is how an adult clears the administrator-issued password block.
export default async function AdultPasswordPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  const destination = passwordChangeReturnPath(returnTo);
  const adult = await getSignedInAdult();
  if (!adult) redirect(`/grown-ups?returnTo=${encodeURIComponent(`${ADULT_PASSWORD_PATH}?returnTo=${encodeURIComponent(destination)}`)}`);
  // A voluntary change lives on the account page.
  if (!adult.mustChangePassword) redirect("/account");
  return <AdultPasswordForm name={adult.displayName} email={adult.email} destination={destination} />;
}
