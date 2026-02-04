import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic"; // avoid caching on Vercel

// Try multiple likely inventory locations so deploy can't "go empty" silently.
const CANDIDATE_FILES = [
  "public/inventory.csv",
  "data/inventory.deduped.csv",
  "data/inventory.csv",
  "inventory.csv",
  "inventory.deduped.csv",
];

type CardRow = Record<string, string>;

function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

// Minimal CSV parser that supports quoted fields with commas.
function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines: string[] = [];
  let cur = "";
  let inQuotes = false;

  // Normalize newlines; keep line integrity even with quoted newlines
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if ((ch === "\n") && !inQuotes) {
      lines.push(cur);
      cur = "";
      continue;
    }

    if (ch === "\r") continue;
    cur += ch;
  }
  if (cur.length) lines.push(cur);

  const splitLine = (line: string) => {
    const out: string[] = [];
    let field = "";
    let q = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];

      if (ch === '"') {
        if (q && next === '"') {
          field += '"';
          i++;
        } else {
          q = !q;
        }
        continue;
      }

      if (ch === "," && !q) {
        out.push(field);
        field = "";
        continue;
      }

      field += ch;
    }
    out.push(field);
    return out.map((s) => s.trim());
  };

  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = splitLine(nonEmpty[0]);
  const rows = nonEmpty.slice(1).map(splitLine);
  return { headers, rows };
}

function pickValue(row: CardRow, keys: string[]) {
  for (const k of keys) {
    const v = row[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function buildDedupKey(card: any) {
  // Strong-ish key that survives small formatting differences
  const parts = [
    card.title,
    card.player,
    card.cardNumber,
    card.set,
    card.manufacturer,
    card.season,
    card.league,
    card.variant,
    card.imageUrl,
  ]
    .map((v: any) => String(v || "").trim().toLowerCase())
    .map((v: string) => v.replace(/\s+/g, " "));
  return parts.join("||");
}

export async function GET() {
  try {
    const cwd = process.cwd();

    let chosen: string | null = null;
    let csvText: string | null = null;

    for (const rel of CANDIDATE_FILES) {
      const abs = path.join(cwd, rel);
      try {
        csvText = await fs.readFile(abs, "utf8");
        if (csvText && csvText.trim().length > 0) {
          chosen = rel;
          break;
        }
      } catch {
        // try next
      }
    }

    if (!chosen || !csvText) {
      return NextResponse.json(
        {
          error:
            "Inventory file not found or empty. Expected one of: " +
            CANDIDATE_FILES.join(", "),
        },
        { status: 500 }
      );
    }

    const { headers, rows } = parseCSV(csvText);
    if (!headers.length) {
      return NextResponse.json(
        { error: `CSV had no headers in ${chosen}` },
        { status: 500 }
      );
    }

    const normHeaders = headers.map(normalizeHeader);

    const mappedRows: CardRow[] = rows
      .filter((r) => r.some((c) => String(c || "").trim().length > 0))
      .map((r) => {
        const obj: CardRow = {};
        for (let i = 0; i < normHeaders.length; i++) {
          obj[normHeaders[i]] = (r[i] ?? "").trim();
        }
        return obj;
      });

    const cards = [];
    const seen = new Set<string>();

    for (const r of mappedRows) {
      // Support both:
      // - single "image url" / "images" field (pipes)
      // - separate front/back urls
      const front = pickValue(r, ["front image url", "front", "front_url", "fronturl"]);
      const back = pickValue(r, ["back image url", "back", "back_url", "backurl"]);
      const combined = pickValue(r, ["image url", "images", "image", "img", "imageurl"]);

      let imageUrl = "";
      if (combined) {
        imageUrl = combined;
      } else if (front && back) {
        imageUrl = `${front} | ${back}`;
      } else {
        imageUrl = front || back || "";
      }

      const card = {
        title: pickValue(r, ["title", "card title"]),
        player: pickValue(r, ["player", "name"]),
        cardNumber: pickValue(r, ["card number", "number", "#"]),
        set: pickValue(r, ["set", "collection"]),
        manufacturer: pickValue(r, ["manufacturer", "brand"]),
        season: pickValue(r, ["season", "year"]),
        league: pickValue(r, ["league"]),
        variant: pickValue(r, ["variant", "parallel", "insert"]),
        imageUrl,
      };

      // Skip totally empty lines
      if (!card.title && !card.player && !card.imageUrl) continue;

      const key = buildDedupKey(card);
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push(card);
    }

    const res = NextResponse.json(cards);
    res.headers.set("x-inventory-source", chosen);
    res.headers.set("x-inventory-count", String(cards.length));
    return res;
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || String(err) },
      { status: 500 }
    );
  }
}

