// src/app/api/cards/route.ts
import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

/**
 * Production-grade inventory API:
 * - Reads CSV from data/inventory.deduped.csv (or INVENTORY_PATH env)
 * - DEDUPES in-memory on every GET (so the UI never shows duplicates again)
 * - Optionally can write a cleaned file on POST/DELETE/PUT operations
 *
 * IMPORTANT:
 * - This route returns an ARRAY by default (to match typical existing frontend code).
 * - Add `?meta=1` if you want metadata like duplicatesRemoved, totalRaw, etc.
 */

type CardRow = Record<string, string>;

const DEFAULT_CANDIDATE_PATHS = [
  "data/inventory.deduped.csv",
  "public/inventory.csv",
];

function normalizeStr(v: unknown): string {
  if (v == null) return "";
  return String(v)
    .replace(/\u00a0/g, " ") // non-breaking space
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeKey(v: unknown): string {
  return normalizeStr(v).toLowerCase();
}

function splitImageUrls(raw: string): string[] {
  // Your data uses "url | url" frequently
  return normalizeStr(raw)
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

function primaryImage(raw: string): string {
  const imgs = splitImageUrls(raw);
  return imgs[0] || "";
}

/**
 * A robust dedupe key that works for your inventory:
 * Prefer stable fields, but also fall back to Title + Primary Image.
 */
function makeDedupeKey(row: CardRow): string {
  const title = normalizeKey(row["Title"] ?? row["title"]);
  const player = normalizeKey(row["Player"] ?? row["player"]);
  const cardNumber = normalizeKey(
    row["Card Number"] ?? row["CardNumber"] ?? row["card_number"] ?? row["cardNumber"]
  );
  const set = normalizeKey(row["Set"] ?? row["set"]);
  const manufacturer = normalizeKey(row["Manufacturer"] ?? row["manufacturer"]);
  const season = normalizeKey(row["Season"] ?? row["season"]);
  const league = normalizeKey(row["League"] ?? row["league"]);
  const variant = normalizeKey(
    row["Variant"] ?? row["Parallel"] ?? row["parallel"] ?? row["Insert"] ?? row["insert"]
  );
  const img = normalizeKey(
    primaryImage(row["Image URL"] ?? row["ImageURL"] ?? row["image_url"] ?? row["imageUrl"] ?? "")
  );

  // If data is incomplete, title+img is still a great dedupe signal for your scans.
  const core =
    [
      title,
      player,
      cardNumber,
      set,
      manufacturer,
      season,
      league,
      variant,
      img,
    ]
      .filter(Boolean)
      .join("|") || `${title}|${img}`;

  return core;
}

/**
 * CSV parsing (handles commas inside quotes, escaped quotes, etc.)
 * No external deps needed.
 */
function parseCsv(content: string): { headers: string[]; rows: CardRow[] } {
  const text = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // Handle escaped quote ""
      const next = text[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "\n" && !inQuotes) {
      lines.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.length) lines.push(cur);

  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = splitCsvLine(nonEmpty[0]).map((h) => normalizeStr(h));
  const rows: CardRow[] = [];

  for (let li = 1; li < nonEmpty.length; li++) {
    const cols = splitCsvLine(nonEmpty[li]);
    const row: CardRow = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = normalizeStr(cols[c] ?? "");
    }
    rows.push(row);
  }

  return { headers, rows };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }
  out.push(cur);
  return out;
}

function toCsv(headers: string[], rows: CardRow[]): string {
  const esc = (v: string) => {
    const s = normalizeStr(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const headerLine = headers.map(esc).join(",");
  const body = rows
    .map((r) => headers.map((h) => esc(r[h] ?? "")).join(","))
    .join("\n");

  return `${headerLine}\n${body}\n`;
}

async function resolveInventoryPath(): Promise<string> {
  const envPath = process.env.INVENTORY_PATH?.trim();
  const candidates = envPath ? [envPath, ...DEFAULT_CANDIDATE_PATHS] : DEFAULT_CANDIDATE_PATHS;

  for (const rel of candidates) {
    const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
    try {
      await fs.access(abs);
      return abs;
    } catch {
      // keep trying
    }
  }

  // Default to first candidate if none exist (so errors are clear)
  return path.join(process.cwd(), DEFAULT_CANDIDATE_PATHS[0]);
}

async function readInventory(): Promise<{ headers: string[]; rows: CardRow[]; filePath: string }> {
  const filePath = await resolveInventoryPath();
  const raw = await fs.readFile(filePath, "utf8");
  const { headers, rows } = parseCsv(raw);
  return { headers, rows, filePath };
}

function dedupeRows(rows: CardRow[]): {
  deduped: CardRow[];
  removed: CardRow[];
} {
  const seen = new Map<string, CardRow>();
  const removed: CardRow[] = [];

  for (const r of rows) {
    const key = makeDedupeKey(r);
    if (!key) {
      // If the row is extremely empty, keep it (but this is rare)
      const fallback = JSON.stringify(r);
      if (!seen.has(fallback)) seen.set(fallback, r);
      else removed.push(r);
      continue;
    }

    if (seen.has(key)) {
      removed.push(r);
      continue;
    }

    // Normalize a couple common fields so the UI behaves consistently
    const imgField =
      r["Image URL"] ?? r["ImageURL"] ?? r["image_url"] ?? r["imageUrl"] ?? "";
    if (imgField) {
      // standardize spacing around pipes
      const joined = splitImageUrls(imgField).join(" | ");
      if ("Image URL" in r) r["Image URL"] = joined;
      else if ("ImageURL" in r) r["ImageURL"] = joined;
      else if ("image_url" in r) r["image_url"] = joined;
      else r["imageUrl"] = joined;
    }

    seen.set(key, r);
  }

  return { deduped: Array.from(seen.values()), removed };
}

/**
 * GET /api/cards
 * - returns an ARRAY of cards by default
 * - add ?meta=1 to return { cards, meta }
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const wantMeta = url.searchParams.get("meta") === "1";

    const { headers, rows } = await readInventory();
    const { deduped, removed } = dedupeRows(rows);

    const payload = wantMeta
      ? {
          cards: deduped,
          meta: {
            totalRaw: rows.length,
            totalDeduped: deduped.length,
            duplicatesRemoved: removed.length,
            headers,
          },
        }
      : deduped;

    // Disable caching so you see changes immediately during dev
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "Failed to load inventory",
        detail: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cards
 * Body:
 *   { card: {...} }  OR  { cards: [{...}, {...}] }
 *
 * Adds cards, then writes a *deduped* CSV back to disk.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const incoming: CardRow[] = Array.isArray(body?.cards)
      ? body.cards
      : body?.card
      ? [body.card]
      : [];

    if (incoming.length === 0) {
      return NextResponse.json(
        { error: "No card(s) provided. Send {card:{...}} or {cards:[...]}" },
        { status: 400 }
      );
    }

    const { headers, rows, filePath } = await readInventory();
    const normalizedIncoming = incoming.map((r) => {
      const out: CardRow = {};
      for (const [k, v] of Object.entries(r || {})) out[k] = normalizeStr(v);
      return out;
    });

    // Ensure new fields don't get dropped:
    const headerSet = new Set(headers);
    for (const r of normalizedIncoming) {
      for (const k of Object.keys(r)) {
        if (!headerSet.has(k)) {
          headers.push(k);
          headerSet.add(k);
        }
      }
    }

    const merged = [...normalizedIncoming, ...rows];
    const { deduped, removed } = dedupeRows(merged);

    await fs.writeFile(filePath, toCsv(headers, deduped), "utf8");

    return NextResponse.json(
      {
        ok: true,
        wroteTo: path.relative(process.cwd(), filePath),
        added: normalizedIncoming.length,
        totalRawAfterMerge: merged.length,
        totalAfterDedupedWrite: deduped.length,
        duplicatesRemovedOnWrite: removed.length,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to update inventory", detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/cards
 * Body:
 *   { match: { Title?: "...", Player?: "...", "Card Number"?: "...", ... } }
 * Removes rows that match ALL provided fields (case-insensitive).
 */
export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const match: Record<string, string> = body?.match || {};

    const keys = Object.keys(match);
    if (keys.length === 0) {
      return NextResponse.json(
        { error: "Provide { match: {field:value,...} } to delete." },
        { status: 400 }
      );
    }

    const { headers, rows, filePath } = await readInventory();

    const normMatch: Record<string, string> = {};
    for (const k of keys) normMatch[k] = normalizeKey(match[k]);

    const kept: CardRow[] = [];
    let removedCount = 0;

    for (const r of rows) {
      const isHit = keys.every((k) => normalizeKey(r[k] ?? "") === normMatch[k]);
      if (isHit) removedCount++;
      else kept.push(r);
    }

    const { deduped } = dedupeRows(kept);
    await fs.writeFile(filePath, toCsv(headers, deduped), "utf8");

    return NextResponse.json(
      {
        ok: true,
        wroteTo: path.relative(process.cwd(), filePath),
        removed: removedCount,
        totalAfterWrite: deduped.length,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to delete card(s)", detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
