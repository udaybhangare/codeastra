import type { Metadata } from "next";
import { Suspense } from "react";
import { Incidents } from "@/components/incidents/incidents";

export const metadata: Metadata = { title: "Incidents" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Incidents />
    </Suspense>
  );
}
