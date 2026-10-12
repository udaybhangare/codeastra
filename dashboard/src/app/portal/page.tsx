import type { Metadata } from "next";
import { Portal } from "@/components/portal/portal";

export const metadata: Metadata = { title: "Bulkhead Tenant Portal" };

export default function Page() {
  return <Portal />;
}
