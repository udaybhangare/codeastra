import { Suspense } from "react";
import { Incidents } from "@/components/incidents/incidents";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Incidents />
    </Suspense>
  );
}
