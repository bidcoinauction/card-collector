import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { parseCsv } from "@/lib/csv";
import { buildPredicate, buildSorter, parseTokens } from "@/lib/query";
import { CardRow } from "@/lib/types";

let cache: { mtimeMs: number; rows: CardRow[] } | null = null;

async function loadCards(): Promise<CardRow[]> {
  const p = path.join(process.cwd(), "public", "inventory.csv");
  const stat = await fs.stat(p);
  if (cache && cache.mtimeMs === stat.mtimeMs) return cache.rows;

  const text = await fs.readFile(p, "utf-8");
  const rows = parseCsv(text);
  cache = { mtimeMs: stat.mtimeMs, rows };
  return rows;
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const q = url.searchParams.get("q") ?? "";
  const sort = url.searchParams.get("sort") ?? "recent";
  const dir = (url.searchParams.get("dir") ?? "desc") as "asc" | "desc";

  const league = url.searchParams.get("league") ?? "";
  const set = url.searchParams.get("set") ?? "";
  const team = url.searchParams.get("team") ?? "";
  const season = url.searchParams.get("season") ?? "";

  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(60, Math.max(12, Number(url.searchParams.get("pageSize") ?? "24")));

  const auto = url.searchParams.get("auto") === "1";
  const rc = url.searchParams.get("rc") === "1";

  const cards = await loadCards();
  const tokens = parseTokens(q);
  const predicate = buildPredicate({ q, tokens, league, set, team, season, auto, rc });

  const filtered = cards.filter(predicate);

  if (sort !== "recent") {
    filtered.sort(buildSorter(sort, dir));
  }

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;

  const slice = filtered.slice(start, end);

  const facet = (key: keyof CardRow) => {
    const s = new Set<string>();
    for (const c of cards) {
      const v = (c[key] ?? "").toString().trim();
      if (v) s.add(v);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  };

  return NextResponse.json({
    page: safePage,
    pageSize,
    total,
    totalPages,
    items: slice,
    facets: {
      league: facet("League"),
      set: facet("Set"),
      team: facet("Team"),
      season: facet("Season"),
    },
  });
}
