"use client";
import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { fmtInt } from "@/lib/format";
import type { Showback } from "@/lib/portal";
import { showbackRows } from "@/lib/portal-view";

const money = (cur: string, n: number) => (cur === "USD" ? `$${n.toFixed(2)}` : `${cur} ${n.toFixed(2)}`);

/** What your usage would cost at demo rates. Each row shows its share of the bill as a bar. */
export function ShowbackTable({ sb }: { sb: Showback | null }) {
  return (
    <Card
      id="showback"
      className="scroll-mt-24 pb-5"
      eyebrow="Showback · last hour"
      title="What your usage would cost"
      actions={
        <Tooltip content={<span className="block max-w-[240px] whitespace-normal">Showback shows what your usage is worth. Nothing is charged: these are demo rates.</span>}>
          <button type="button" aria-label="What is showback?" className="inline-flex size-9 items-center justify-center rounded-full text-ink-3 outline-none hover:text-ink focus-visible:shadow-[var(--ring)]">
            <Info className="size-5" aria-hidden />
          </button>
        </Tooltip>
      }
    >
      <div className="px-5 pt-3">
        {!sb ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]">
                <caption className="sr-only">Cost by resource at demo rates</caption>
                <thead>
                  <tr className="text-left text-[13px] font-semibold tracking-[0.02em] text-ink-2 uppercase">
                    <th scope="col" className="py-2 pr-3">Resource</th>
                    <th scope="col" className="hidden py-2 pr-3 sm:table-cell">Share</th>
                    <th scope="col" className="py-2 pr-3 text-right">Used</th>
                    <th scope="col" className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {showbackRows(sb).map((r, i) => (
                    <tr key={`${r.label}-${i}`} className="border-t border-line even:bg-paper-2/50">
                      <th scope="row" className="py-3 pr-3 text-left font-semibold">{r.label}</th>
                      <td className="hidden w-[30%] py-3 pr-3 sm:table-cell">
                        <div className="h-2.5 rounded-full bg-paper-2" aria-hidden>
                          <div className="h-full rounded-full bg-ultra" style={{ width: `${Math.max(2, Math.round(r.share * 100))}%` }} />
                        </div>
                      </td>
                      <td className="num py-3 pr-3 text-right text-ink-2">{r.quantity !== undefined ? `${fmtInt(r.quantity)} ${r.unit ?? ""}` : "–"}</td>
                      <td className="num py-3 text-right font-semibold">{money(sb.currency, r.amount)}</td>
                    </tr>
                  ))}
                  {sb.lines.length === 0 && (
                    <tr className="border-t border-line"><td colSpan={4} className="py-4 text-ink-2">No billable usage in the last hour.</td></tr>
                  )}
                  <tr className="border-t border-line">
                    <th scope="row" className="py-3 pr-3 text-left font-medium text-ink-2">Free allowance credit</th>
                    <td className="hidden sm:table-cell" />
                    <td />
                    <td className="num py-3 text-right text-ok-ink">−{money(sb.currency, sb.free_allowance_credit)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-[48ch] text-[13px] text-ink-2">Demo rates, not a real invoice. {sb.disclaimer}</p>
              <span className="num inline-flex h-12 items-center gap-2 rounded-full bg-lime px-5 text-[20px] font-medium text-lime-ink">
                <span className="text-[13px] font-semibold tracking-[0.02em] uppercase">Total</span>
                <NumberTicker value={sb.total} format={(n) => money(sb.currency, n)} />
              </span>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
