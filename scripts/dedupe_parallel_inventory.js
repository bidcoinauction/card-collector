#!/usr/bin/env node
/* Parallel-aware inventory deduper
   - Reads CSV/TSV (auto-detect delimiter)
   - Defines a "true duplicate" key that INCLUDES parallel/insert/auto/serial/grade/condition
   - Merges only exact duplicates (same key)
   - quantity is summed; other fields optionally filled
   - Writes deduped CSV + TSV + report JSON

   Usage:
     node scripts/dedupe_parallel_inventory.js
     node scripts/dedupe_parallel_inventory.js --in data/inventory.hybrid.csv
     node scripts/dedupe_parallel_inventory.js --fill-blanks
     node scripts/dedupe_parallel_inventory.js --merge-values=max
*/

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function argValue(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}
function hasFlag(flag) {
  return process.argv.includes(flag);
}

const IN_DEFAULT = path.resolve("data/inventory.hybrid.csv");
const OUT_CSV_DEFAULT = path.resolve("data/inventory.deduped.csv");
const OUT_TSV_DEFAULT = path.resolve("data/inventory.deduped.tsv");
const OUT_REPORT_DEFAULT = path.resolve("data/inventory.deduped.report.json");

const inPath = path.resolve(argValue("--in", IN_DEFAULT));
const outCsv = path.resolve(argValue("--out-csv", OUT_CSV_DEFAULT));
const outTsv = path.resolve(argValue("--out-tsv", OUT_TSV_DEFAULT));
const outReport = path.resolve(argValue("--out-report", OUT_REPORT_DEFAULT));

const FILL_BLANKS = hasFlag("--fill-blanks");
const MERGE_VALUES = (argValue("--merge-values", "keep_old") || "keep_old").toLowerCase();
// MERGE_VALUES: keep_old | max | min | newest

// ---------- helpers ----------
function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 10);
}
function norm(s) {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ");
}
function normKey(s) {
  return norm(s).toLowerCase();
}
function toInt(x, fallback = 0) {
  const n = parseInt(String(x ?? "").trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}
function toFloat(x) {
  const s = String(x ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function newestByTimestamp(a, b) {
  // prefer row with newer ISO timestamp
  const ta = Date.parse(a.timestamp || "") || 0;
  const tb = Date.parse(b.timestamp || "") || 0;
  return tb >= ta ? b : a;
}

// ---------- delimiter + parsing ----------
function detectDelimiter(text) {
  const head = text.slice(0, 5000);
  const commas = (head.match(/,/g) || []).length;
  const tabs = (head.match(/\t/g) || []).length;
  return tabs > commas ? "\t" : ",";
}

// Robust CSV/TSV parser with quotes
function parseDelimited(text, delim) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      continue;
    }

    if (c === "\r") continue;

    if (c === delim) {
      row.push(field);
      field = "";
      continue;
    }

    if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      continue;
    }

    field += c;
  }

  // last field
  row.push(field);
  // last row if not empty
  if (row.length > 1 || (row.length === 1 && row[0].trim() !== "")) rows.push(row);

  return rows;
}

function toObjects(rows) {
  if (!rows.length) return { headers: [], objects: [] };
  const headers = rows[0].map((h) => norm(h));
  const objects = rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => (obj[h] = r[idx] ?? ""));
    return obj;
  });
  return { headers, objects };
}

function escapeCsvField(s, delim = ",") {
  const str = String(s ?? "");
  const needs = str.includes('"') || str.includes("\n") || str.includes("\r") || str.includes(delim);
  if (!needs) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

function writeDelimited(outPath, headers, objects, delim) {
  const lines = [];
  lines.push(headers.map((h) => escapeCsvField(h, delim)).join(delim));
  for (const o of objects) {
    lines.push(headers.map((h) => escapeCsvField(o[h] ?? "", delim)).join(delim));
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
}

// ---------- dedupe key (PARALLEL-AWARE) ----------
function buildDedupeKey(o) {
  // "True duplicate" identity MUST include parallel-ish fields so variants don’t merge.
  // We also include grade/condition/serial_number because those differentiate physical cards.
  const parts = [
    normKey(o.sport),
    normKey(o.year),
    normKey(o.set),
    normKey(o.subset),
    normKey(o.card_number),
    normKey(o.player),
    normKey(o.team),
    normKey(o.league),

    // parallel / variant identity
    normKey(o.parallel),
    normKey(o.insert),
    normKey(o.rookie),
    normKey(o.autograph),
    normKey(o.serial_number),

    // physical differentiation
    normKey(o.grade),
    normKey(o.condition),

    // optional: some people also include image URLs.
    // if you want that, uncomment the next line:
    // normKey(o.image),
  ];
  return parts.join("|");
}

function mergeRows(oldRow, newRow, headers) {
  const merged = { ...oldRow };

  // quantity: sum
  const qOld = toInt(oldRow.quantity, 1);
  const qNew = toInt(newRow.quantity, 1);
  merged.quantity = String(Math.max(0, qOld) + Math.max(0, qNew));

  // fill blanks (optional)
  if (FILL_BLANKS) {
    for (const h of headers) {
      const a = String(merged[h] ?? "");
      const b = String(newRow[h] ?? "");
      if (!a.trim() && b.trim()) merged[h] = b;
    }
  }

  // merge value strategy (optional)
  // We treat "value" + "purchase_price" as numeric-ish fields if present.
  // You can extend this list to include market_avg_ebay_90d_usd, etc.
  const numericFields = [
    "value",
    "purchase_price",
    "market_avg_ebay_90d_usd",
    "last_sold_raw_usd",
  ].filter((f) => headers.includes(f));

  if (MERGE_VALUES !== "keep_old") {
    for (const f of numericFields) {
      const a = toFloat(oldRow[f]);
      const b = toFloat(newRow[f]);
      if (a == null && b == null) continue;

      if (MERGE_VALUES === "max") merged[f] = String(Math.max(a ?? -Infinity, b ?? -Infinity));
      else if (MERGE_VALUES === "min") merged[f] = String(Math.min(a ?? Infinity, b ?? Infinity));
      else if (MERGE_VALUES === "newest") {
        const pick = newestByTimestamp(oldRow, newRow);
        const pv = toFloat(pick[f]);
        if (pv != null) merged[f] = String(pv);
      }
    }
  }

  // timestamp: keep newest
  if (headers.includes("timestamp")) {
    merged.timestamp = newestByTimestamp(oldRow, newRow).timestamp || merged.timestamp || "";
  }

  // notes: append if different and both exist
  if (headers.includes("notes")) {
    const a = norm(oldRow.notes);
    const b = norm(newRow.notes);
    if (a && b && a !== b) merged.notes = `${a} | ${b}`;
    else merged.notes = a || b || "";
  }

  // id: keep old id (stable), unless missing
  if (headers.includes("id")) {
    if (!norm(oldRow.id) && norm(newRow.id)) merged.id = newRow.id;
    if (!norm(merged.id)) merged.id = `c_${sha1(buildDedupeKey(merged))}`;
  }

  return merged;
}

// ---------- main ----------
function main() {
  if (!fs.existsSync(inPath)) {
    console.error(`❌ Input not found: ${inPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inPath, "utf8");
  const delim = detectDelimiter(raw);
  const rows = parseDelimited(raw, delim);
  const { headers, objects } = toObjects(rows);

  if (!headers.length || !objects.length) {
    console.error("❌ No data found (check file formatting).");
    process.exit(1);
  }

  // Ensure minimum schema fields exist (so key builder doesn’t explode)
  const required = [
    "sport","year","set","subset","card_number","player","team","league",
    "parallel","insert","rookie","autograph","serial_number","grade","condition","quantity"
  ];
  for (const r of required) {
    if (!headers.includes(r)) {
      headers.push(r);
      for (const o of objects) o[r] = o[r] ?? "";
    }
  }
  if (headers.includes("quantity")) {
    for (const o of objects) {
      if (!String(o.quantity ?? "").trim()) o.quantity = "1";
    }
  }

  const map = new Map(); // key -> row
  const dupes = [];      // { key, kept_id, merged_ids[] }
  let mergedCount = 0;

  for (const o of objects) {
    const key = buildDedupeKey(o);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, o);
      continue;
    }

    // merge true duplicate
    const merged = mergeRows(existing, o, headers);
    map.set(key, merged);

    mergedCount++;
    // track report
    const keptId = merged.id || existing.id || "";
    const mergedId = o.id || "";
    let rec = dupes.find((d) => d.key === key);
    if (!rec) {
      rec = { key, kept_id: keptId, merged_ids: [] };
      dupes.push(rec);
    }
    if (mergedId) rec.merged_ids.push(mergedId);
  }

  const deduped = Array.from(map.values());

  // Write outputs (CSV + TSV)
  writeDelimited(outCsv, headers, deduped, ",");
  writeDelimited(outTsv, headers, deduped, "\t");

  const report = {
    input: inPath,
    output_csv: outCsv,
    output_tsv: outTsv,
    delimiter_detected: delim === "\t" ? "TSV" : "CSV",
    rows_in: objects.length,
    rows_out: deduped.length,
    merged_rows: mergedCount,
    duplicate_groups: dupes.length,
    fill_blanks: FILL_BLANKS,
    merge_values: MERGE_VALUES,
    duplicate_samples: dupes.slice(0, 25),
  };

  fs.mkdirSync(path.dirname(outReport), { recursive: true });
  fs.writeFileSync(outReport, JSON.stringify(report, null, 2), "utf8");

  console.log(`📥 Input: ${inPath}`);
  console.log(`🔎 Detected delimiter: ${report.delimiter_detected}`);
  console.log(`🧠 Parallel-aware key: player+set+year+card#+team+league+parallel+insert+auto+serial+grade+condition`);
  console.log(`🧾 Rows in: ${report.rows_in}`);
  console.log(`✅ Rows out: ${report.rows_out}`);
  console.log(`🔁 Merged rows: ${report.merged_rows} (true exact duplicates only)`);
  console.log(`📦 Duplicate groups: ${report.duplicate_groups}`);
  console.log(`✅ Wrote CSV: ${outCsv}`);
  console.log(`✅ Wrote TSV: ${outTsv}`);
  console.log(`📄 Report: ${outReport}`);
}

main();
