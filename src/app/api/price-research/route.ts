import { NextResponse } from "next/server";

/**
 * Stub route: returns mock sold comps so the UI is real.
 * Later: replace with your eBay scraper/API integration.
 *
 * GET /api/price-research?q=...&limit=...
 */
function median(nums: number[]) {
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(20, Math.max(5, Number(url.searchParams.get("limit") ?? "10")));

  // Deterministic mock data based on query
  const seed = Array.from(q).reduce((a, c) => a + c.charCodeAt(0), 0) || 1337;
  const base = (seed % 70) + 10;

  const sold = Array.from({ length: limit }).map((_, i) => {
    const wobble = Math.sin((seed + i) * 0.37) * 8 + Math.cos((seed + i) * 0.21) * 4;
    const price = Math.max(2, Math.round((base + wobble + i * 0.35) * 100) / 100);

    return {
      title: `${q || "Card"} — Sold Listing ${i + 1}`,
      price,
      date: new Date(Date.now() - (i + 2) * 86400000).toISOString().slice(0, 10),
      url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1`,
      thumb: "",
    };
  });

  const prices = sold.map((s) => s.price);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

  return NextResponse.json({
    query: q,
    count: sold.length,
    stats: {
      average: Math.round(avg * 100) / 100,
      median: median(prices),
      lowest: Math.min(...prices),
      highest: Math.max(...prices),
    },
    sold,
  });
}
