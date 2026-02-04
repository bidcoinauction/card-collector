// src/app/api/cards/route.ts
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = Record<string, string>;

/**
 * Robust CSV parsing:
 * - supports quoted fields
 * - supports commas/tabs/semicolons
 * - supports newlines inside quotes
 */
function detectDelimiter(headerLine: string) {
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestCount = 0;

  for (const d of candidates) {
    const count = splitCsvLine(headerLine, d).length;
    if (count > bestCount) {
      bestCount = count;
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
      // escaped quote
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

  // Rebuild records respecting quotes across newlines
  const records: string[] = [];
  let buf = "";
  let inQuotes = false;

  for (const line of lines) {
    // append line to buffer
    buf = buf ? `${buf}\n${line}` : line;

    // toggle quote state on odd number of quotes (rough but effective w/ escaped quotes handled in split)
    // This works well in practice for CSV exports.
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

function normalizeKey(s: unknown) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function makeId(row: Row) {
  // Try common id fields first
  const direct =
    row.id ||
    row.ID ||
    row.card_id ||
    row.CardID ||
    row["Card ID"] ||
    row.uuid ||
    row.UUID;

  if (direct) return String(direct);

  // Otherwise build a stable-ish id from common card identity fields
  const player = normalizeKey(row.player ?? row.Player);
  const set = normalizeKey(row.set ?? row.Set);
  const card = normalizeKey(row.card_number ?? row["Card Number"] ?? row["Card #"] ?? row["Card No"]);
  const year = normalizeKey(row.year ?? row.Year ?? row.Season);
  const serial = normalizeKey(row.serial_number ?? row["Serial Number"]);
  const variant = normalizeKey(row.parallel ?? row.variant ?? row.insert);

  return [player, set, card, year, serial, variant].filter(Boolean).join("|");
}

export async function GET(req: Request) {
  try {
    // Prefer your hybrid output first, then normalized, then raw inventory
    const candidates = [
      path.join(process.cwd(), "data", "inventory.hybrid.csv"),
      path.join(process.cwd(), "data", "full_card_inventory.normalized.csv"),
      path.join(process.cwd(), "public", "inventory.csv"),
    ];

    const chosen = readFirstExisting(candidates);

    if (!chosen) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "No inventory file found",
          tried: candidates,
        }),
        { status: 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
      );
    }

    const csv = fs.readFileSync(chosen, "utf8");
    const firstLine = (csv.split(/\r?\n/)[0] ?? "").trim();
    const delim = detectDelimiter(firstLine);
    const { rows } = parseDelimited(csv, delim);

    // Add stable id field for UI keying (does not remove anything)
    const cards = rows.map((r) => ({ ...r, id: makeId(r) }));

    return new Response(JSON.stringify({ ok: true, source: path.relative(process.cwd(), chosen), count: cards.length, cards }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: err?.message || String(err),
      }),
      { status: 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );
  }
}
