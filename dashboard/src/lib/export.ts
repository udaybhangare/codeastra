import type { BundleFile } from "./runs";

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function exportJson(f: BundleFile) {
  download(`bulkhead-${f.scenario}-${f.seed ?? "seed"}.json`, new Blob([JSON.stringify(f, null, 2)], { type: "application/json" }));
}

// Rasterise the Recharts <svg> elements inside `root` side by side.
// CSS variables are resolved first because a standalone SVG image can't see them.
export async function exportPng(root: HTMLElement, name: string) {
  const css = getComputedStyle(document.documentElement);
  const resolve = (s: string) => s.replace(/var\((--[\w-]+)\)/g, (_, v) => css.getPropertyValue(v).trim() || "currentColor");
  const bg = css.getPropertyValue("--surface").trim() || "#fff";
  const fg = css.getPropertyValue("--ink").trim() || "#000";
  const svgs = [...root.querySelectorAll("svg.recharts-surface")] as SVGSVGElement[];
  if (svgs.length === 0) return;
  const imgs = await Promise.all(
    svgs.map(async (svg) => {
      const r = svg.getBoundingClientRect();
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(r.width));
      clone.setAttribute("height", String(r.height));
      const src = resolve(new XMLSerializer().serializeToString(clone)).replace("<svg", `<svg style="color:${fg};font-family:sans-serif"`);
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}`;
      await img.decode();
      return { img, w: r.width, h: r.height };
    }),
  );
  const scale = 2;
  const W = imgs.reduce((a, i) => a + i.w, 0);
  const H = Math.max(...imgs.map((i) => i.h));
  const c = document.createElement("canvas");
  c.width = W * scale;
  c.height = H * scale;
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  let x = 0;
  for (const i of imgs) {
    ctx.drawImage(i.img, x, 0, i.w, i.h);
    x += i.w;
  }
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
  if (blob) download(name, blob);
}

/** Download one throttle decision (event + evidence + actions) as JSON. */
export function exportEventJson(e: unknown, name: string) {
  download(name, new Blob([JSON.stringify(e, null, 2)], { type: "application/json" }));
}

/** Download plain CSV text. */
export function exportCsv(csv: string, name: string) {
  download(name, new Blob([csv], { type: "text/csv;charset=utf-8" }));
}
