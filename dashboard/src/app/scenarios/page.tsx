import type { Metadata } from "next";
import { ScenarioLab } from "@/components/lab/scenario-lab";

export const metadata: Metadata = { title: "Scenario Lab" };

export default function Page() {
  return <ScenarioLab />;
}
