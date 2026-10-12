import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { ToastViewport } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

const display = Bricolage_Grotesque({ variable: "--font-display", subsets: ["latin"], weight: ["600", "700", "800"] });
const body = Instrument_Sans({ variable: "--font-body", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Bulkhead Admin Console",
  description: "Live multi-tenant isolation and noisy-neighbor defense",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}>
      <body className="h-full bg-paper text-ink">
        <TooltipProvider>
          <AppShell>{children}</AppShell>
          <ToastViewport />
        </TooltipProvider>
      </body>
    </html>
  );
}
