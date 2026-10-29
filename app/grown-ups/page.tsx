import { redirect } from "next/navigation";
import { getSignedInAdult } from "../../lib/auth";
import { isAdminReturnPath, safeReturnPath } from "../../lib/safe-redirect";
import { passwordChangeDestination } from "../../lib/learning-policy";
import GrownUpsContent from "./GrownUpsContent";
import { accountHome } from "../../lib/roles";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Grown-up sign in | Bangla Adventures",
  description:
    "Sign in or create a grown-up account to manage learner profiles, assignments and the content studio.",
};

export default async function GrownUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; mode?: string; switchAccount?: string }>;
}) {
  const { returnTo, mode, switchAccount } = await searchParams;
  const adult = await getSignedInAdult();
  const destination = safeReturnPath(returnTo, switchAccount === "1" ? "/family" : adult ? accountHome(adult) : "/family");
  const needsAdminAccount = isAdminReturnPath(destination) && adult?.role !== "admin";
  if (adult && switchAccount !== "1" && !needsAdminAccount) redirect(adult.mustChangePassword ? passwordChangeDestination(destination) : destination);

  return <GrownUpsContent destination={destination} initialMode={mode === "sign-up" ? "sign-up" : "sign-in"} currentAccount={adult ? `${adult.email} (${adult.role})` : undefined} />;
}
