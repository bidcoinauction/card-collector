#!/usr/bin/env node
/**
 * Hybrid Inventory Merge
 *
 * Merges:
 *  - OLD:  public/inventory.csv              (research / source-of-truth columns)
 *  - NEW:  data/full_card_inventory.normalized.csv (clean app schema)
 *
 * Output:
 *  - data/inventory.hybrid.csv
 *  - data/inventory.hybrid.tsv
 *  - data/inventory.hybrid.report.json
 *
 * Usage:
 *  node scripts/merge_hybrid_inventory.js
 *  node scripts/merge_hybrid_inventory.js --fill-blanks
 *  node scripts/merge_hybrid_inventory.js --old public/inventory.csv --new data/full_card_inventory.normalized.csv
 */

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const argVal = (name, def) => {
  const i = args.indexOf(name);
  if (i === -1) return def;
  return args[i + 1] ?? def;
};

const OLD_PATH = argVal("--old", path.resolve("public/inventory.csv"));
const NEW_PATH = argVal("--new", path.resolve("data/full_card_inventory.normalized.csv"));
const OUT_CSV = argVal("--out-csv", path.resolve("data/inventory.hybrid.csv"));
const OUT_TSV = argVal("--out-tsv", path.resolve("data/inventory.hybrid.tsv"));
const OUT_REPORT = argVal("--out-report", path.resolve("data/inventory.hybrid.report.json"));

const FILL_BLANKS = flag("--fill-blanks");

// ----------------------------
// CSV parsing (no dependencies)
// ----------------------------
function detectDelimiter(headerLine) {
  // naive: pick delimiter that yields most columns
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
        // escaped quote
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
  return out.map((s) => s.trim());
}

function parseDelimited(text, delimiter = ",") {
  const lines = String(text ?? "").split(/\r?\n/);

  // accumulate records, respecting quotes across newlines
  const rows = [];
  let buf = "";
  let inQuotes = false;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    // count quotes to detect if we cross a record boundary
    // (handles escaped quotes by ignoring doubled quotes)
    const quoteCount = (line.match(/"/g) || []).length;
    // rough but works well: toggles on odd counts; doubled quotes are two chars anyway
    const toggles = quoteCount % 2 === 1;

    if (buf) buf += "\n" + line;
    else buf = line;

    if (toggles) inQuotes = !inQuotes;

    if (!inQuotes) {
      // complete record
      if (buf.trim().length) rows.push(buf);
      buf = "";
    }
  }
  if (buf.trim().length) rows.push(buf);

  if (!rows.length) return { headers: [], data: [] };

  const headerLine = rows.shift();
  const headers = splitCSVLine(headerLine, delimiter);

  const data = rows.map((r) => {
    const cells = splitCSVLine(r, delimiter);
    const obj = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = cells[i] ?? "";
    }
    return obj;
  });

  return { headers, data };
}

// ----------------------------
// Text normalization utilities
// ----------------------------
function deburr(str) {
  // remove accents/diacritics (basic)
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
  // allow "2023-24" -> 2023
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
  // "2023-24" -> 2023 (start year)
  const m = t.match(/\b((19|20)\d{2})\s*[-/]\s*\d{2}\b/);
  return m ? m[1] : "";
}

function extractCardNoFromTitle(title) {
  const t = String(title ?? "");
  // e.g. "FIFA 221" / "UEFA 86" -> 221 / 86
  const m = t.match(/\b(?:FIFA|UEFA|MLS|NBA|NFL|MLB|NHL)\s*#?\s*([A-Z0-9]{1,6})\b/i);
  if (m) return m[1];

  // e.g. "#221" -> 221
  const m2 = t.match(/\b#\s*([A-Z0-9]{1,6})\b/i);
  return m2 ? m2[1] : "";
}

function guessSetFromTitle(title) {
  const t = String(title ?? "").trim();
  // Remove leading year or season like "2024-25" / "2024"
  return t.replace(/^\s*\b(19|20)\d{2}(?:\s*[-/]\s*\d{2})?\s*/i, "").trim();
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

// ----------------------------
// Field mapping between old and new
// (old headers are from your inventory.
//  new headers are from normalized schema)
// ----------------------------
const OLD_FIELD_GUESSES = {
  title: ["Title", "title"],
  player: ["Player", "player"],
  set: ["Set", "set"],
  card_number: ["Card Number", "CardNumber", "card_number", "Card #", "Card No"],
  year: ["Season", "Year", "year"],
  team: ["Team", "team"],
  league: ["League", "league"],
  images: ["Images", "Image", "image", "image_url"],
};

function getField(row, guesses) {
  for (const g of guesses) {
    if (g in row) return row[g];
  }
  return "";
}

// ----------------------------
// Keying + scoring
// ----------------------------
function keyFromOld(row) {
  const title = getField(row, OLD_FIELD_GUESSES.title);

  const player = norm(getField(row, OLD_FIELD_GUESSES.player));

  // Prefer explicit Set/Card columns; fallback to parsing Title when blank.
  const setRaw = firstNonEmpty(
    getField(row, OLD_FIELD_GUESSES.set),
    guessSetFromTitle(title)
  );

  const cardRaw = firstNonEmpty(
    getField(row, OLD_FIELD_GUESSES.card_number),
    extractCardNoFromTitle(title)
  );

  // Prefer a 4-digit year from Set/Title before falling back to Season ranges ("2023-24").
  const yearRaw = firstNonEmpty(
    getField(row, OLD_FIELD_GUESSES.year),
    extract4DigitYear(setRaw),
    extract4DigitYear(title),
    extractSeasonStartYear(getField(row, OLD_FIELD_GUESSES.year))
  );

  const set = norm(setRaw);
  const card = norm(cardRaw);
  const year = pickYear(yearRaw);

  // primary key focuses on player+set+card_number+year
  return `${player}|${set}|${card}|${year}`;
}

function keyFromNew(row) {
  const player = norm(row.player);
  const set = norm(row.set);
  const card = norm(row.card_number);
  const year = pickYear(row.year);
  return `${player}|${set}|${card}|${year}`;
}

function scoreMatch(oldRow, newRow) {
  // Higher is better; keep this simple and transparent.
  let score = 0;

  const oldPlayer = norm(getField(oldRow, OLD_FIELD_GUESSES.player));
  const oldSet = norm(getField(oldRow, OLD_FIELD_GUESSES.set));
  const oldCard = norm(getField(oldRow, OLD_FIELD_GUESSES.card_number));
  const oldYear = pickYear(getField(oldRow, OLD_FIELD_GUESSES.year));
  const oldTeam = norm(getField(oldRow, OLD_FIELD_GUESSES.team));
  const oldLeague = norm(getField(oldRow, OLD_FIELD_GUESSES.league));

  const newPlayer = norm(newRow.player);
  const newSet = norm(newRow.set);
  const newCard = norm(newRow.card_number);
  const newYear = pickYear(newRow.year);
  const newTeam = norm(newRow.team);
  const newLeague = norm(newRow.league);

  if (oldPlayer && newPlayer && oldPlayer === newPlayer) score += 5;
  if (oldSet && newSet && oldSet === newSet) score += 4;
  if (oldCard && newCard && oldCard === newCard) score += 3;
  if (oldYear && newYear && oldYear === newYear) score += 2;
  if (oldTeam && newTeam && oldTeam === newTeam) score += 1;
  if (oldLeague && newLeague && oldLeague === newLeague) score += 1;

  // Soft partial matches
  if (oldSet && newSet && (oldSet.includes(newSet) || newSet.includes(oldSet))) score += 1;
  if (oldTeam && newTeam && (oldTeam.includes(newTeam) || newTeam.includes(oldTeam))) score += 0.5;

  return score;
}

// ----------------------------
// Merge strategy
// ----------------------------
function mergeRows(oldRow, newRow, fillBlanks) {
  // Keep all old columns, add normalized columns if missing or if name collides prefix as norm_
  const out = { ...oldRow };

  for (const [k, v] of Object.entries(newRow)) {
    if (k in out) {
      // collision: write to norm_*
      const nk = `norm_${k}`;
      if (fillBlanks) {
        const cur = String(out[nk] ?? "").trim();
        if (!cur && String(v ?? "").trim()) out[nk] = v;
      } else {
        if (!(nk in out)) out[nk] = v;
      }
    } else {
      // non-collision
      if (fillBlanks) {
        const cur = String(out[k] ?? "").trim();
        if (!cur && String(v ?? "").trim()) out[k] = v;
        else if (!(k in out)) out[k] = v;
      } else {
        out[k] = v;
      }
    }
  }

  return out;
}

// ----------------------------
// IO + main
// ----------------------------
function readFileOrThrow(p) {
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  return fs.readFileSync(p, "utf8");
}

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function writeDelimited(rows, delimiter, outPath) {
  if (!rows.length) {
    ensureDirForFile(outPath);
    fs.writeFileSync(outPath, "");
    return { columns: [] };
  }

  // Build union of keys across rows
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

  const escapeCell = (val) => {
    const s = String(val ?? "");
    const needs = s.includes('"') || s.includes("\n") || s.includes("\r") || s.includes(delimiter);
    if (!needs) return s;
    return `"${s.replace(/"/g, '""')}"`;
  };

  const lines = [];
  lines.push(cols.map(escapeCell).join(delimiter));
  for (const r of rows) {
    lines.push(cols.map((c) => escapeCell(r[c])).join(delimiter));
  }

  ensureDirForFile(outPath);
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  return { columns: cols };
}

function main() {
  console.log(`\n📥 Old: ${OLD_PATH}`);
  console.log(`📥 New: ${NEW_PATH}`);
  console.log(`🧠 Mode: fill blanks ${FILL_BLANKS ? "ON" : "OFF"}`);

  const oldText = readFileOrThrow(OLD_PATH);
  const newText = readFileOrThrow(NEW_PATH);

  const oldDelim = detectDelimiter(oldText.split(/\r?\n/)[0] || ",");
  const newDelim = detectDelimiter(newText.split(/\r?\n/)[0] || ",");

  const oldParsed = parseDelimited(oldText, oldDelim);
  const newParsed = parseDelimited(newText, newDelim);

  const oldRows = oldParsed.data;
  const newRows = newParsed.data;

  // Index normalized rows by key
  const index = new Map();
  for (const r of newRows) {
    const k = keyFromNew(r);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(r);
  }

  const matched = [];
  const unmatchedOld = [];
  const ambiguous = [];
  const usedNewKeys = new Set();

  for (const o of oldRows) {
    const k = keyFromOld(o);
    const candidates = index.get(k) || [];

    if (!candidates.length) {
      unmatchedOld.push({ key: k, ...o });
      matched.push(o);
      continue;
    }

    if (candidates.length === 1) {
      const best = candidates[0];
      usedNewKeys.add(k);
      matched.push(mergeRows(o, best, FILL_BLANKS));
      continue;
    }

    // multiple candidates: score them
    let best = null;
    let bestScore = -Infinity;
    let secondBestScore = -Infinity;

    for (const c of candidates) {
      const s = scoreMatch(o, c);
      if (s > bestScore) {
        secondBestScore = bestScore;
        bestScore = s;
        best = c;
      } else if (s > secondBestScore) {
        secondBestScore = s;
      }
    }

    // If we got a clearly best match, use it.
    // threshold + gap to reduce false matches.
    const gap = bestScore - secondBestScore;
    if (best && bestScore >= 8 && gap >= 1) {
      usedNewKeys.add(k);
      matched.push(mergeRows(o, best, FILL_BLANKS));
    } else {
      ambiguous.push({
        key: k,
        bestScore,
        secondBestScore,
        old: o,
        candidates_count: candidates.length,
      });
      matched.push(o);
    }
  }

  // estimate unused normalized (by key)
  let unusedEstimate = 0;
  for (const [k, list] of index.entries()) {
    if (!usedNewKeys.has(k)) unusedEstimate += Math.max(1, list.length);
  }

  const csvMeta = writeDelimited(matched, ",", OUT_CSV);
  writeDelimited(matched, "\t", OUT_TSV);

  const report = {
    inputs: {
      old_path: OLD_PATH,
      new_path: NEW_PATH,
      old_rows: oldRows.length,
      new_rows: newRows.length,
      fill_blanks: FILL_BLANKS,
    },
    results: {
      matched: matched.length - unmatchedOld.length - ambiguous.length,
      unmatched: unmatchedOld.length,
      ambiguous: ambiguous.length,
      output_rows: matched.length,
      output_columns: csvMeta.columns.length,
      unused_normalized_count_estimate: unusedEstimate,
    },
    samples: {
      unmatched_old_rows: unmatchedOld.slice(0, 50),
      ambiguous: ambiguous.slice(0, 25),
      unused_normalized_keys: Array.from(index.keys())
        .filter((k) => !usedNewKeys.has(k))
        .slice(0, 50),
    },
  };

  ensureDirForFile(OUT_REPORT);
  fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2), "utf8");

  console.log(`✅ Wrote: ${OUT_CSV}`);
  console.log(`✅ Wrote: ${OUT_TSV}`);
  console.log(`📄 Report: ${OUT_REPORT}`);
  console.log(
    `📊 matched=${report.results.matched} | unmatched=${report.results.unmatched} | ambiguous=${report.results.ambiguous} | cols=${report.results.output_columns}`
  );

  if (report.results.unmatched > 0) {
    console.warn("⚠️ Some old rows did not match normalized (see report samples).");
  }
  if (report.results.unused_normalized_count_estimate > 0) {
    console.info("ℹ️ Some normalized rows were not used (see report).");
  }
}

main();
