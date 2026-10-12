"use client";
import { liveApi } from "@/lib/api";
import { cn } from "@/lib/utils";

export function PageFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-medium">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {!liveApi && (
        <div className="rounded-md border border-info/40 bg-info/10 px-3 py-2 text-sm text-info">
          Mock mode: this page reads the admin REST API, which needs a live backend (NEXT_PUBLIC_WS_URL=auto).
        </div>
      )}
      {children}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div role="alert" className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">Could not load: {error}</div>;
}

export function Panel({ title, className, children }: { title?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-lg border border-border bg-card p-3", className)}>
      {title && <h2 className="mb-2 text-sm font-medium text-muted-foreground">{title}</h2>}
      {children}
    </section>
  );
}
