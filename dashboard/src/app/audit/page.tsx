import type { Metadata } from "next";
import { Audit } from "@/components/audit/audit";

export const metadata: Metadata = { title: "Audit log" };

export default function Page() {
  return <Audit />;
}
