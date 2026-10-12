import type { Metadata } from "next";
import { Tenants } from "@/components/tenants/tenants";

export const metadata: Metadata = { title: "Tenants" };

export default function Page() {
  return <Tenants />;
}
