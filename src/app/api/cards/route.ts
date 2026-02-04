// src/app/api/cards/route.ts
import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // prevent build-time caching

const CANDIDATE_PATHS = [
  "public/inventory.csv",
  "data/inventory.csv",
  "inventory.csv",
];

type AnyRow = Record<string, string | undefined>;

function splitImages(raw?: string) {
  const s = (raw ?? "").trim();
  if (!s) return { front: "", back: "", all: [] as string[] };

  const parts = s
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);

  return {
    front: parts[0] ?? "",
    back: parts[1] ?? "",
    all: parts,
  };
}

function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function get(row: AnyRow, ...keys: string[]) {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function stableKey(card: {
  title: string;
  player: string;
  cardNumber: string;
  set: string;
  season: string;
  league: string;
  variant: string;
  imageFront: string;
  imageBack: string;
}) {
  return [
    card.title,
    card.player,
    card.cardNumber,
    card.set,
    card.season,
    card.league,
    card.variant,
    card.imageFront,
    card.imageBack,
  ]
    .map((x) => (x ?? "").trim().toLowerCase())
    .join("|");
}

// Minimal CSV parser that supports quoted fields
function parseCSV(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (c === '"') {
      const next = text[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (c === "," || c === "\n" || c === "\r")) {
      if (c === ",") {
        row.push(cur);
        cur = "";
        continue;
      }

      // newline handling
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";

      // ignore empty trailing lines
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }

    cur += c;
  }

  // last cell
  row.push(cur);
  if (row.some((x) => x.trim() !== "")) rows.push(row);

  if (rows.length === 0) return { headers: [] as string[], data: [] as AnyRow[] };

  const headers = rows[0].map(normalizeHeader);

  const data: AnyRow[] = rows.slice(1).map((r) => {
    const obj: AnyRow = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });

  return { headers, data };
}

async function readFirstExistingCSV() {
  const root = process.cwd();
  for (const rel of CANDIDATE_PATHS) {
    const abs = path.join(root, rel);
    try {
      const text = await fs.readFile(abs, "utf8");
      return { text, rel };
    } catch {
      // try next
    }
  }
  throw new Error(`No inventory.csv found in: ${CANDIDATE_PATHS.join(", ")}`);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.max(0, Number(url.searchParams.get("limit") ?? "0"));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0"));

    const { text, rel } = await readFirstExistingCSV();
    const { data } = parseCSV(text);

    // Normalize rows -> cards
    const cardsRaw = data.map((r) => {
      // accept both "title" and "Title"
      const title = get(r, "title", "Title", "name", "card title");
      const player = get(r, "player", "Player");
      const cardNumber = get(r, "card number", "cardnumber", "number", "#", "Card Number");
      const set = get(r, "set", "Set");
      const manufacturer = get(r, "manufacturer", "Manufacturer", "brand");
      const season = get(r, "season", "Season", "year");
      const league = get(r, "league", "League");
      const variant = get(r, "variant", "Variant", "parallel", "insert");

      const imagesRaw = get(r, "images", "image", "image url", "imageurl", "Images");
      const imgs = splitImages(imagesRaw);

      // If your frontend wants one thumbnail field, give it
      const imageUrl = imgs.front || imgs.back || "";

      return {
        id: "", // set after dedupe
        title,
        player,
        cardNumber,
        set,
        manufacturer,
        season,
        league,
        variant,
        images: imgs.all,
        imageFront: imgs.front,
        imageBack: imgs.back,
        imageUrl,
        // keep these available if UI expects them later:
        condition: get(r, "condition", "Condition") || "raw",
        value: Number(get(r, "value", "Value", "price") || "0") || 0,
      };
    });

    // Deduplicate
    const map = new Map<string, any>();
    for (const c of cardsRaw) {
      const key = stableKey(c);
      if (!key.replace(/\|/g, "")) continue; // skip fully empty lines

      // keep first occurrence
      if (!map.has(key)) map.set(key, c);
    }

    const cards = Array.from(map.values()).map((c, idx) => ({
      ...c,
      id: `${idx + 1}`,
    }));

    const sliced =
      limit > 0 ? cards.slice(offset, offset + limit) : cards;

    const res = NextResponse.json(
      {
        cards: sliced,
        total: cards.length,
        source: rel,
      },
      { status: 200 }
    );

    res.headers.set("x-inventory-source", rel);
    res.headers.set("x-inventory-count", String(cards.length));
    res.headers.set("cache-control", "no-store");

    return res;
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to read inventory" },
      { status: 500 }
    );
  }
}
