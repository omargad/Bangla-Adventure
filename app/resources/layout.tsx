import type { ReactNode } from "react";
import LearningLayout from "../components/LearningLayout";
export default function Layout({ children }: { children: ReactNode }) { return <LearningLayout active="references">{children}</LearningLayout>; }
