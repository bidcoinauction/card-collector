#!/usr/bin/env node
/**
 * Stricter dedupe for public/inventory.csv
 *
 * Key strategy (in order):
 *  1) SKU (Custom label (SKU)) if present
 *  2) player|set|card_number|year|variant (variant parsed from Features/title)
 *  3) title_norm|first_image (fallback for missing structure)
 *
 * Keeps best row by completeness scoring.
 *
 * Usage:
 *  node scripts/dedupe_inventory_strict.js
 *  node scripts/dedupe_inventory_strict.js --in public/inventory.csv --out public/inventory.csv --write
 */

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : (args[i + 1] ?? def);
};
const hasFlag = (name) => args.includes(name);

const IN_PATH = path.resolve(argVal("--in", "public/inventory.csv"));
const OUT_PATH = path.resolve(argVal("--out", "public/inventory.deduped.strict.csv"));
const WRITE_IN_PLACE = hasFlag("--write");

// ---------------- CSV helpers ----------------
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

function writeCSV(rows, outPath) {
  if (!rows.length) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, "", "utf8");
    return;
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
    const needs = s.includes('"') || s.includes("\n") || s.includes("\r") || s.includes(",");
    if (!needs) return s;
    return `"${s.replace(/"/g, '""')}"`;
  };

  const lines = [];
  lines.push(cols.map(esc).join(","));
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(","));

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
}

// ---------------- Normalization/keying ----------------
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

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

function parseImagesField(v) {
  const s = String(v ?? "").trim();
  if (!s) return [];
  // common delimiters: | ; , newline
  const parts = s
    .split(/\s*(?:\||;|\n|\r)\s*/g)
    .flatMap((p) => p.split(/\s*,\s*/g));
  return parts.map((x) => x.trim()).filter(Boolean);
}

function safeUrl(u) {
  const raw = String(u ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).toString();
  } catch {
    return encodeURI(raw);
  }
}

function variantFromText(text) {
  const t = norm(text);
  if (!t) return "";
  // keep this modest; we just want to distinguish obvious parallels/serials
  const tokens = [];

  const hit = (re, label) => {
    if (re.test(t)) tokens.push(label);
  };

  hit(/\bauto(graph|)\b|\bautographs?\b/, "auto");
  hit(/\brelic\b|\bpatch\b|\bjersey\b/, "relic");
  hit(/\bnumbered\b|\b\/\d{2,4}\b|\b\d{1,4}\s*\/\s*\d{2,4}\b/, "numbered");

  // common colors/parallels
  hit(/\bgold\b/, "gold");
  hit(/\borange\b/, "orange");
  hit(/\bred\b/, "red");
  hit(/\bblue\b/, "blue");
  hit(/\bgreen\b/, "green");
  hit(/\bpink\b/, "pink");
  hit(/\bblack\b/, "black");
  hit(/\bpurple\b/, "purple");
  hit(/\bsilver\b/, "silver");
  hit(/\bcracked ice\b|\bice\b/, "ice");
  hit(/\bmojo\b/, "mojo");
  hit(/\brefractor\b/, "refractor");
  hit(/\bprizm\b/, "prizm");
  hit(/\bmosaic\b/, "mosaic");
  hit(/\bfoil\b/, "foil");

  return tokens.join("+");
}

function completenessScore(r) {
  // prefer rows with: images, player, set, card#, season/year, team, league, features
  const fields = [
    "Images",
    "Player",
    "Set",
    "Card Number",
    "Season",
    "Year",
    "Team",
    "League",
    "Features",
    "Custom label (SKU)",
    "Last Sold Raw (USD)",
    "Market Avg (eBay 90d USD)",
  ];

  let score = 0;
  for (const f of fields) {
    const v = String(r[f] ?? "").trim();
    if (v) score += 1;
  }

  // extra weight if has at least one image
  const imgs = parseImagesField(r["Images"]);
  if (imgs.length) score += 3;

  // extra weight if has numeric pricing
  const mv = String(r["Market Avg (eBay 90d USD)"] ?? "").trim();
  const lv = String(r["Last Sold Raw (USD)"] ?? "").trim();
  if (mv) score += 1;
  if (lv) score += 1;

  return score;
}

function keyForRow(r) {
  const sku = String(r["Custom label (SKU)"] ?? "").trim();
  if (sku) return `sku:${sku}`;

  const title = firstNonEmpty(r["Title"], "");
  const player = norm(firstNonEmpty(r["Player"], ""));
  const set = norm(firstNonEmpty(r["Set"], ""));
  const cardNo = norm(firstNonEmpty(r["Card Number"], ""));
  const year = pickYear(firstNonEmpty(r["Year"], r["Season"], title));

  const features = firstNonEmpty(r["Features"], "");
  const variant = variantFromText(`${features} ${title}`);

  const imgs = parseImagesField(r["Images"]).map(safeUrl).filter(Boolean);
  const firstImg = imgs[0] ? safeUrl(imgs[0]) : "";

  // If we have structured identity, use it (plus variant)
  if (player || set || cardNo || year) {
    const base = `${player}|${set}|${cardNo}|${year}|${variant}`.trim();
    // If base is very weak (missing most parts), include image/title fallback
    const weak = [player, set, cardNo, year].filter(Boolean).length <= 1;
    return weak ? `weak:${norm(title)}|${firstImg}` : `k:${base}`;
  }

  // fallback: title + first image
  return `t:${norm(title)}|${firstImg}`;
}

function main() {
  if (!fs.existsSync(IN_PATH)) {
    console.error(`❌ Input not found: ${IN_PATH}`);
    process.exit(1);
  }

  const text = fs.readFileSync(IN_PATH, "utf8");
  const delim = detectDelimiter((text.split(/\r?\n/)[0] ?? "").trim());
  const { rows } = parseDelimited(text, delim);

  const groups = new Map(); // key -> { bestRow, bestScore, keptIndex, dups: [] }
  const removed = [];
  const kept = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const k = keyForRow(r);
    const score = completenessScore(r);

    const cur = groups.get(k);
    if (!cur) {
      groups.set(k, { bestRow: r, bestScore: score, keptIndex: i, dups: [] });
      continue;
    }

    // Decide which to keep
    if (score > cur.bestScore) {
      removed.push({ key: k, removedIndex: cur.keptIndex, keptIndex: i });
      cur.dups.push(cur.bestRow);
      cur.bestRow = r;
      cur.bestScore = score;
      cur.keptIndex = i;
    } else {
      removed.push({ key: k, removedIndex: i, keptIndex: cur.keptIndex });
      cur.dups.push(r);
    }
  }

  for (const [, v] of groups) kept.push(v.bestRow);

  // write output
  const outPath = WRITE_IN_PLACE ? IN_PATH : OUT_PATH;
  writeCSV(kept, outPath);

  const reportPath = path.resolve("data/inventory.deduped.strict.report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        inputs: { in: IN_PATH, rows: rows.length },
        results: { kept: kept.length, removed: removed.length, out: outPath, report: reportPath },
        sampleRemoved: removed.slice(0, 50),
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`✅ Read: ${rows.length}`);
  console.log(`🧹 Kept: ${kept.length}`);
  console.log(`🗑️  Removed: ${removed.length}`);
  console.log(`💾 Wrote: ${outPath}`);
  console.log(`📄 Report: ${reportPath}`);
}

main();
