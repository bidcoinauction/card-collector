import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, string>;

function detectDelimiter(headerLine: string) {
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const c = splitCsvLine(headerLine, d).length;
    if (c > bestCount) {
      bestCount = c;
      best = d;
    }
  }
  return best;
}

function splitCsvLine(line: string, delimiter: string) {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === delimiter) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

function parseDelimited(text: string, delimiter: string) {
  const lines = text.split(/\r?\n/);

  // rebuild records, supporting newlines inside quotes
  const records: string[] = [];
  let buf = "";
  let inQuotes = false;

  for (const line of lines) {
    buf = buf ? `${buf}\n${line}` : line;

    // toggle quote state on odd number of quotes in this line
    const quoteCount = (line.match(/"/g) || []).length;
    if (quoteCount % 2 === 1) inQuotes = !inQuotes;

    if (!inQuotes) {
      if (buf.trim().length) records.push(buf);
      buf = "";
    }
  }
  if (buf.trim().length) records.push(buf);

  if (!records.length) return { headers: [], rows: [] as Row[] };

  const headerLine = records.shift()!;
  const headers = splitCsvLine(headerLine, delimiter).map((h) => h.trim());

  const rows: Row[] = records.map((rec) => {
    const cells = splitCsvLine(rec, delimiter);
    const row: Row = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = (cells[i] ?? "").trim();
    }
    return row;
  });

  return { headers, rows };
}

function readFirstExisting(paths: string[]) {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function s(v: unknown) {
  return String(v ?? "").trim();
}

function lc(v: unknown) {
  return s(v).toLowerCase();
}

function getAny(row: any, ...keys: string[]) {
  for (const k of keys) {
    if (row && row[k] != null && String(row[k]).trim() !== "") return row[k];
  }
  return "";
}

function toNum(v: unknown): number | null {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function makeFacets(rows: any[]) {
  const uniq = (arr: string[]) => Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b));

  const league = uniq(rows.map((r) => s(getAny(r, "league", "League"))));
  const set = uniq(rows.map((r) => s(getAny(r, "set", "Set"))));
  const team = uniq(rows.map((r) => s(getAny(r, "team", "Team"))));
  const season = uniq(rows.map((r) => s(getAny(r, "season", "Season", "year", "Year"))));

  return { league, set, team, season };
}

function matchesQuery(row: any, q: string) {
  const needle = lc(q);
  if (!needle) return true;

  const hay = [
    getAny(row, "title", "Title"),
    getAny(row, "player", "Player"),
    getAny(row, "set", "Set"),
    getAny(row, "team", "Team"),
    getAny(row, "league", "League"),
    getAny(row, "season", "Season", "year", "Year"),
  ]
    .map(lc)
    .join(" • ");

  return hay.includes(needle);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const q = s(url.searchParams.get("q") || "");
    const sort = s(url.searchParams.get("sort") || "recent");
    const dir = (s(url.searchParams.get("dir") || "desc").toLowerCase() === "asc" ? "asc" : "desc") as
      | "asc"
      | "desc";

    const league = s(url.searchParams.get("league") || "");
    const setV = s(url.searchParams.get("set") || "");
    const team = s(url.searchParams.get("team") || "");
    const season = s(url.searchParams.get("season") || "");

    const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
    const pageSize = Math.max(1, Math.min(200, Number(url.searchParams.get("pageSize") || 24) || 24));

 const candidates = [
  path.join(process.cwd(), "public", "inventory.csv"),
  path.join(process.cwd(), "data", "inventory.hybrid.csv"),
  path.join(process.cwd(), "data", "full_card_inventory.normalized.csv"),
];

    const chosen = readFirstExisting(candidates);

    if (!chosen) {
      return new Response(JSON.stringify({ error: "No inventory file found", tried: candidates }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const csv = fs.readFileSync(chosen, "utf8");
    const headerLine = (csv.split(/\r?\n/)[0] ?? "").trim();
    const delim = detectDelimiter(headerLine);
    const { rows } = parseDelimited(csv, delim);

    // Treat CSV rows as raw items (your AppShell can handle both schemas)
    let filtered: any[] = rows;

    if (q) filtered = filtered.filter((r) => matchesQuery(r, q));
    if (league) filtered = filtered.filter((r) => s(getAny(r, "league", "League")) === league);
    if (setV) filtered = filtered.filter((r) => s(getAny(r, "set", "Set")) === setV);
    if (team) filtered = filtered.filter((r) => s(getAny(r, "team", "Team")) === team);
    if (season) filtered = filtered.filter((r) => s(getAny(r, "season", "Season", "year", "Year")) === season);

    // facets should reflect the filtered dataset (so dropdowns stay relevant)
    const facets = makeFacets(filtered);

    // sorting (basic)
    const sign = dir === "asc" ? 1 : -1;

    if (sort === "value") {
      filtered = [...filtered].sort((a, b) => {
        const av = toNum(getAny(a, "marketAvg", "Market Avg (eBay 90d USD)", "market_avg")) ?? -Infinity;
        const bv = toNum(getAny(b, "marketAvg", "Market Avg (eBay 90d USD)", "market_avg")) ?? -Infinity;
        return (av - bv) * sign;
      });
    } else {
      // "recent" fallback: keep original order (CSV order), or reverse if asc
      filtered = dir === "asc" ? [...filtered].reverse() : filtered;
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);

    const start = (safePage - 1) * pageSize;
    const end = start + pageSize;
    const items = filtered.slice(start, end);

    return new Response(
      JSON.stringify({
        page: safePage,
        pageSize,
        total,
        totalPages,
        items,
        facets,
        source: path.relative(process.cwd(), chosen),
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}
