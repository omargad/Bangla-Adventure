import type { ReactNode } from "react";
import PasswordChangeGate from "../components/PasswordChangeGate";
export default function Layout({ children }: { children: ReactNode }) { return <PasswordChangeGate>{children}</PasswordChangeGate>; }
