#!/usr/bin/env node
/**
 * Add missing cards from an eBay bulk CSV into your inventory CSV, deduped by a stable key.
 *
 * Default:
 *  - inventory: public/inventory.csv
 *  - ebay bulk: data/ebay-bulk.csv
 * Output:
 *  - data/inventory.with-ebay.csv
 *  - data/inventory.with-ebay.report.json
 *
 * Usage:
 *  node scripts/add_from_ebay_bulk.js --ebay data/ebay-bulk.csv --inventory public/inventory.csv
 *  node scripts/add_from_ebay_bulk.js --write-in-place
 */

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const argVal = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : (args[i + 1] ?? def);
};

const INVENTORY_PATH = argVal("--inventory", path.resolve("public/inventory.csv"));
const EBAY_PATH = argVal("--ebay", path.resolve("data/ebay-bulk.csv"));

const OUT_CSV = argVal("--out", path.resolve("data/inventory.with-ebay.csv"));
const OUT_REPORT = argVal("--report", path.resolve("data/inventory.with-ebay.report.json"));
const WRITE_IN_PLACE = flag("--write-in-place");

// ----------------------------
// CSV parsing (no dependencies)
// ----------------------------
function detectDelimiter(headerLine) {
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const c = splitCSVLine(headerLine, d).length;
    if (c > bestCount) {
      bestCount = c;
      best = d;
    }
  }
  return best;
}

function splitCSVLine(line, delimiter) {
  const out = [];
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

function parseDelimited(text, delimiter = ",") {
  const lines = String(text ?? "").split(/\r?\n/);

  const records = [];
  let buf = "";
  let inQuotes = false;

  for (const line of lines) {
    buf = buf ? `${buf}\n${line}` : line;
    const quoteCount = (line.match(/"/g) || []).length;
    if (quoteCount % 2 === 1) inQuotes = !inQuotes;

    if (!inQuotes) {
      if (buf.trim().length) records.push(buf);
      buf = "";
    }
  }
  if (buf.trim().length) records.push(buf);

  if (!records.length) return { headers: [], rows: [] };

  const headerLine = records.shift();
  const headers = splitCSVLine(headerLine, delimiter).map((h) => h.trim());

  const rows = records.map((r) => {
    const cells = splitCSVLine(r, delimiter);
    const obj = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = (cells[i] ?? "").trim();
    return obj;
  });

  return { headers, rows };
}

function writeDelimited(rows, delimiter, outPath) {
  if (!rows.length) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, "");
    return { columns: [] };
  }

  const cols = [];
  const seen = new Set();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }

  const esc = (val) => {
    const s = String(val ?? "");
    const needs = s.includes('"') || s.includes("\n") || s.includes("\r") || s.includes(delimiter);
    if (!needs) return s;
    return `"${s.replace(/"/g, '""')}"`;
  };

  const lines = [];
  lines.push(cols.map(esc).join(delimiter));
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(delimiter));

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  return { columns: cols };
}

// ----------------------------
// Normalization + keying
// ----------------------------
function deburr(str) {
  return String(str ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function norm(s) {
  return deburr(s)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function pickYear(v) {
  const s = String(v ?? "").trim();
  const m = s.match(/(19|20)\d{2}/);
  return m ? m[0] : "";
}

function extract4DigitYear(text) {
  const t = String(text ?? "");
  const m = t.match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : "";
}

function extractSeasonStartYear(text) {
  const t = String(text ?? "");
  const m = t.match(/\b((19|20)\d{2})\s*[-/]\s*\d{2}\b/);
  return m ? m[1] : "";
}

function extractCardNoFromTitle(title) {
  const t = String(title ?? "");
  const m = t.match(/\b(?:FIFA|UEFA|MLS|NBA|NFL|MLB|NHL)\s*#?\s*([A-Z0-9]{1,6})\b/i);
  if (m) return m[1];
  const m2 = t.match(/\b#\s*([A-Z0-9]{1,6})\b/i);
  return m2 ? m2[1] : "";
}

function guessSetFromTitle(title) {
  const t = String(title ?? "").trim();
  return t.replace(/^\s*\b(19|20)\d{2}(?:\s*[-/]\s*\d{2})?\s*/i, "").trim();
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

function keyFromInventoryRow(row) {
  // Your inventory.csv uses CSV-style columns
  const title = row["Title"] || row["title"] || "";
  const player = norm(row["Player"] || row["player"] || "");
  const setRaw = firstNonEmpty(row["Set"], row["set"], guessSetFromTitle(title));
  const cardRaw = firstNonEmpty(row["Card Number"], row["card_number"], extractCardNoFromTitle(title));
  const yearRaw = firstNonEmpty(
    row["Year"],
    row["Season"],
    extract4DigitYear(setRaw),
    extract4DigitYear(title),
    extractSeasonStartYear(row["Season"])
  );

  return `${player}|${norm(setRaw)}|${norm(cardRaw)}|${pickYear(yearRaw)}`;
}

function keyFromEbayRow(row) {
  // eBay exports vary a lot. We try common columns plus Title.
  const title =
    row["Title"] ||
    row["Item title"] ||
    row["Custom label"] ||
    row["Custom label (SKU)"] ||
    row["Product"] ||
    "";

  const player = norm(row["Player"] || row["player"] || "");
  const setRaw = firstNonEmpty(row["Set"], row["set"], guessSetFromTitle(title));
  const cardRaw = firstNonEmpty(
    row["Card Number"],
    row["Card #"],
    row["Card No"],
    row["card_number"],
    extractCardNoFromTitle(title)
  );

  const yearRaw = firstNonEmpty(
    row["Year"],
    row["Season"],
    extract4DigitYear(setRaw),
    extract4DigitYear(title),
    extractSeasonStartYear(row["Season"])
  );

  return `${player}|${norm(setRaw)}|${norm(cardRaw)}|${pickYear(yearRaw)}`;
}

// ----------------------------
// Mapping eBay -> Inventory row
// ----------------------------
function ebayToInventoryRow(ebayRow) {
  // You can expand this mapping once we see the column names in your file.
  const title =
    ebayRow["Title"] ||
    ebayRow["Item title"] ||
    ebayRow["Custom label"] ||
    ebayRow["Product"] ||
    "";

  // Try to pass through expected inventory columns
  const out = {
    Title: title,
    Player: ebayRow["Player"] || "",
    Set: ebayRow["Set"] || "",
    "Card Number": ebayRow["Card Number"] || ebayRow["Card #"] || ebayRow["Card No"] || "",
    Season: ebayRow["Season"] || ebayRow["Year"] || "",
    Team: ebayRow["Team"] || "",
    League: ebayRow["League"] || "",
    Features: ebayRow["Features"] || "",
    Images:
      ebayRow["Images"] ||
      ebayRow["Image"] ||
      ebayRow["Image URL"] ||
      ebayRow["image_url"] ||
      "",
    "Custom label (SKU)":
      ebayRow["Custom label (SKU)"] ||
      ebayRow["Custom label"] ||
      "",
    Notes: ebayRow["Notes"] || "",
  };

  // If the eBay sheet doesn't have fields but the Title does, we still keep Title.
  return out;
}

function main() {
  if (!fs.existsSync(INVENTORY_PATH)) {
    console.error(`❌ Inventory not found: ${INVENTORY_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(EBAY_PATH)) {
    console.error(`❌ eBay bulk file not found: ${EBAY_PATH}`);
    console.error(`   Put it at ${EBAY_PATH} or pass --ebay <path>`);
    process.exit(1);
  }

  const invText = fs.readFileSync(INVENTORY_PATH, "utf8");
  const ebayText = fs.readFileSync(EBAY_PATH, "utf8");

  const invDelim = detectDelimiter(invText.split(/\r?\n/)[0] || ",");
  const ebayDelim = detectDelimiter(ebayText.split(/\r?\n/)[0] || ",");

  const inv = parseDelimited(invText, invDelim);
  const ebay = parseDelimited(ebayText, ebayDelim);

  const invRows = inv.rows;
  const ebayRows = ebay.rows;

  const invKeys = new Set();
  const invKeyCounts = new Map();

  for (const r of invRows) {
    const k = keyFromInventoryRow(r);
    invKeys.add(k);
    invKeyCounts.set(k, (invKeyCounts.get(k) || 0) + 1);
  }

  const added = [];
  const skipped = [];
  const duplicatesInsideEbay = [];

  const ebaySeen = new Set();

  for (const r of ebayRows) {
    const k = keyFromEbayRow(r);
    if (ebaySeen.has(k)) {
      duplicatesInsideEbay.push({ key: k, sample: r });
      continue;
    }
    ebaySeen.add(k);

    if (invKeys.has(k)) {
      skipped.push({ key: k, reason: "already_in_inventory", sample: r });
      continue;
    }

    const outRow = ebayToInventoryRow(r);
    // If player is missing, try to keep something minimally useful
    if (!String(outRow.Player || "").trim()) outRow.Player = r["player"] || "";
    added.push({ key: k, row: outRow });
    invKeys.add(k);
  }

  const merged = [...invRows, ...added.map((x) => x.row)];

  const outPath = WRITE_IN_PLACE ? INVENTORY_PATH : OUT_CSV;
  writeDelimited(merged, ",", outPath);

  const report = {
    inputs: {
      inventory: INVENTORY_PATH,
      ebay: EBAY_PATH,
      inventory_rows: invRows.length,
      ebay_rows: ebayRows.length,
    },
    results: {
      added: added.length,
      skipped: skipped.length,
      duplicates_inside_ebay: duplicatesInsideEbay.length,
      output_rows: merged.length,
      wrote: outPath,
    },
    samples: {
      added: added.slice(0, 25),
      skipped: skipped.slice(0, 25),
      duplicates_inside_ebay: duplicatesInsideEbay.slice(0, 10),
    },
  };

  fs.mkdirSync(path.dirname(OUT_REPORT), { recursive: true });
  fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2), "utf8");

  console.log(`✅ Inventory rows: ${invRows.length}`);
  console.log(`✅ eBay rows: ${ebayRows.length}`);
  console.log(`➕ Added: ${added.length}`);
  console.log(`⏭️  Skipped: ${skipped.length}`);
  console.log(`🔁 Duplicates within eBay: ${duplicatesInsideEbay.length}`);
  console.log(`📝 Wrote: ${outPath}`);
  console.log(`📄 Report: ${OUT_REPORT}`);
}

main();
