import { learningReturnPath } from "@/lib/learning-policy";
import Welcome from "./Welcome";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome | Bangla Adventures" };

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  return <Welcome destination={learningReturnPath(returnTo)} />;
}
