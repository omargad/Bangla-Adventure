import { requireTeacher } from "@/lib/auth";
import ContentStudio from "./ContentStudio";
import PortalFrame from "../components/PortalFrame";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const user = await requireTeacher("/studio");
  return <PortalFrame role={user.role} name={user.displayName} active="studio"><ContentStudio adultName={user.displayName} /></PortalFrame>;
}
