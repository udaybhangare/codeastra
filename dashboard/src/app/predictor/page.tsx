import type { Metadata } from "next";
import { Predictor } from "@/components/predictor/predictor";

export const metadata: Metadata = { title: "Predictor" };

export default function Page() {
  return <Predictor />;
}
