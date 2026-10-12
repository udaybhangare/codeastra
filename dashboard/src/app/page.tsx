import type { Metadata } from "next";
import { LandingRoot } from "@/components/landing/LandingRoot";

export const metadata: Metadata = {
  title: "Bulkhead — one noisy neighbor shouldn't sink the ship",
  description: "Bulkhead seals every tenant in its own compartment, so one bad actor can't drown everyone else.",
};

export default function Landing() {
  return <LandingRoot />;
}
