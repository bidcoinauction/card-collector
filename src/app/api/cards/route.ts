import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

type Card = {
  id: string;
  title: string;
  player: string;
  cardNumber: string;
  set: string;
  manufacturer: string;
  season: string;
  league: string;
  variant: string;
  images: string[];
  imageFront: string;
  imageBack: string;
  imageUrl: string;

  // aliases (for frontend compatibility)
  image: string;
  img: string;
  thumbnail: string;
  frontImage: string;
  backImage: string;

  condition: string;
  value: number;
};

const CANDIDATE_PATHS = [
  "public/inventory.csv",
  "data/inventory.csv",
  "inventory.csv",
];

function readFirstExistingFile(): { filePath: string; csv: string } | null {
  for (const rel of CANDIDATE_PATHS) {
    const abs = path.join(process.cwd(), rel);
    if (fs.existsSync(abs)) {
      return { filePath: rel, csv: fs.readFileSync(abs, "utf8") };
    }
  }
  return null;
}

async function readInventoryCsv(reqUrl: string): Promise<{ filePath: string; csv: string }> {
  const local = readFirstExistingFile();
  if (local) return local;

  const publicUrl = new URL("/inventory.csv", reqUrl);
  const res = await fetch(publicUrl.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `No inventory.csv found. Tried: ${CANDIDATE_PATHS.join(", ")} and ${publicUrl.toString()}`
    );
  }
  return { filePath: publicUrl.pathname, csv: await res.text() };
}

function splitCsvLine(line: string): string[] {
  // Minimal CSV parser with quotes support
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      // handle escaped quote ""
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }

    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function normalizeKey(k: string) {
  return k.trim().toLowerCase().replace(/\s+/g, " ");
}

function get(row: Record<string, string>, ...keys: string[]) {
  for (const k of keys) {
    const v = row[normalizeKey(k)];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function parseImages(raw: string): { all: string[]; front: string; back: string } {
  const parts = String(raw || "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  const front = parts[0] || "";
  const back = parts[1] || parts[0] || "";
  return { all: parts, front, back };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
    const pageSize = Math.max(1, Math.min(5000, Number(url.searchParams.get("pageSize") || "0")));

    const { filePath, csv } = await readInventoryCsv(req.url);

    const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 2) {
      return NextResponse.json(
        { cards: [], items: [], count: 0, total: 0, totalPages: 1, source: filePath, page, pageSize: pageSize || null },
        { headers: { "x-inventory-count": "0", "x-inventory-source": filePath } }
      );
    }

    const header = splitCsvLine(lines[0]).map(normalizeKey);

    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]);
      const row: Record<string, string> = {};
      for (let c = 0; c < header.length; c++) {
        row[header[c]] = cols[c] ?? "";
      }
      rows.push(row);
    }

    const allCards: Card[] = rows.map((r, idx) => {
      const title = get(r, "title", "Title");
      const player = get(r, "player", "Player");
      const cardNumber = get(r, "card number", "Card Number", "cardNumber");
      const set = get(r, "set", "Set");
      const manufacturer = get(r, "manufacturer", "Manufacturer");
      const season = get(r, "season", "Season");
      const league = get(r, "league", "League");
      const variant = get(r, "variant", "Variant");

      const imagesRaw = get(r, "images", "Images", "image", "imageUrl", "image url");
      const imgs = parseImages(imagesRaw);

      const imageUrl = imgs.front;
      const image = imageUrl;

      const condition = get(r, "condition", "Condition") || "raw";
      const value = Number(get(r, "value", "Value", "price") || "0") || 0;

      return {
        id: String(idx + 1),
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

        // aliases for frontend compatibility
        image,
        img: image,
        thumbnail: image,
        frontImage: imgs.front,
        backImage: imgs.back,

        condition,
        value,
      };
    });

    const count = allCards.length;

    // If pageSize is 0, return all (keeps backwards compatibility)
    let cards = allCards;
    if (pageSize > 0) {
      const start = (page - 1) * pageSize;
      cards = allCards.slice(start, start + pageSize);
    }

    const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(count / pageSize)) : 1;

    return NextResponse.json(
      { cards, items: cards, count, total: count, totalPages, source: filePath, page, pageSize: pageSize || null },
      {
        headers: {
          "x-inventory-count": String(count),
          "x-inventory-source": filePath,
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to load inventory" },
      { status: 500 }
    );
  }
}
