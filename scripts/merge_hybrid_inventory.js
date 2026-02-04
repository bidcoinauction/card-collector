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
function parseDelimited(text, delimiter = ",") {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === delimiter) {
      row.push(cur);
      cur = "";
      continue;
    }

    if (ch === "\n") {
      row.push(cur);
      cur = "";
      // ignore empty last line
      rows.push(row);
      row = [];
      continue;
    }

    if (ch === "\r") continue;

    cur += ch;
  }

  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }

  return rows;
}

function toObjects(rows) {
  if (!rows.length) return { headers: [], objects: [] };
  const headers = rows[0].map((h) => h.trim());
  const objects = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((x) => String(x ?? "").trim() === "")) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = r[c] ?? "";
    }
    objects.push(obj);
  }
  return { headers, objects };
}

function escapeCSV(v) {
  const s = String(v ?? "");
  if (s.includes('"')) return `"${s.replace(/"/g, '""')}"`;
  if (s.includes(",") || s.includes("\n") || s.includes("\r")) return `"${s}"`;
  return s;
}

function writeCSV(headers, objects) {
  const lines = [];
  lines.push(headers.join(","));
  for (const o of objects) {
    const line = headers.map((h) => escapeCSV(o[h] ?? "")).join(",");
    lines.push(line);
  }
  return lines.join("\n") + "\n";
}

function writeTSV(headers, objects) {
  const lines = [];
  lines.push(headers.join("\t"));
  for (const o of objects) {
    const line = headers.map((h) => String(o[h] ?? "").replace(/\t/g, " ")).join("\t");
    lines.push(line);
  }
  return lines.join("\n") + "\n";
}

// ----------------------------
// Normalization helpers
// ----------------------------
function deburr(s) {
  return String(s ?? "")
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

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

// ----------------------------
// Field mapping between old and new
// (old headers are from your inventory.csv)
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

function getField(obj, names) {
  for (const n of names) {
    if (n in obj) return obj[n];
  }
  return "";
}

// Build a key used for matching
function keyFromOld(row) {
  const player = norm(getField(row, OLD_FIELD_GUESSES.player));
  const set = norm(getField(row, OLD_FIELD_GUESSES.set));
  const card = norm(getField(row, OLD_FIELD_GUESSES.card_number));
  const year = pickYear(getField(row, OLD_FIELD_GUESSES.year));
  const team = norm(getField(row, OLD_FIELD_GUESSES.team));
  // primary key focuses on player+set+card_number+year
  return `${player}|${set}|${card}|${year}`.trim();
}

function keyFromNew(row) {
  const player = norm(row.player);
  const set = norm(row.set);
  const card = norm(row.card_number);
  const year = pickYear(row.year);
  return `${player}|${set}|${card}|${year}`.trim();
}

function scoreMatch(oldRow, newRow) {
  let score = 0;

  const op = norm(getField(oldRow, OLD_FIELD_GUESSES.player));
  const np = norm(newRow.player);
  if (op && np && op === np) score += 5;

  const os = norm(getField(oldRow, OLD_FIELD_GUESSES.set));
  const ns = norm(newRow.set);
  if (os && ns && os === ns) score += 3;

  const oc = norm(getField(oldRow, OLD_FIELD_GUESSES.card_number));
  const nc = norm(newRow.card_number);
  if (oc && nc && oc === nc) score += 4;

  const oy = pickYear(getField(oldRow, OLD_FIELD_GUESSES.year));
  const ny = pickYear(newRow.year);
  if (oy && ny && oy === ny) score += 2;

  const ot = norm(getField(oldRow, OLD_FIELD_GUESSES.team));
  const nt = norm(newRow.team);
  if (ot && nt && ot === nt) score += 1;

  const ol = norm(getField(oldRow, OLD_FIELD_GUESSES.league));
  const nl = norm(newRow.league);
  if (ol && nl && ol === nl) score += 1;

  // small bonus if title contains player
  const title = norm(getField(oldRow, OLD_FIELD_GUESSES.title));
  if (title && np && title.includes(np)) score += 1;

  return score;
}

// When collisions happen, keep old fields and add normalized with "norm_" prefix
function mergeHeaders(oldHeaders, newHeaders) {
  const out = [...oldHeaders];
  const oldSet = new Set(oldHeaders);

  for (const h of newHeaders) {
    if (!oldSet.has(h)) {
      out.push(h);
    } else {
      // collision: only add prefixed version if it would differ or be useful
      const pref = `norm_${h}`;
      if (!oldSet.has(pref)) out.push(pref);
    }
  }
  return out;
}

function shouldFillBlank(oldVal, newVal) {
  const o = String(oldVal ?? "").trim();
  const n = String(newVal ?? "").trim();
  return FILL_BLANKS && !o && !!n;
}

// Prefer: keep old values, but optionally fill blanks for certain common fields
const FILL_PREFERRED = new Set([
  "player",
  "set",
  "card_number",
  "year",
  "team",
  "league",
  "image",
  "image_back",
]);

function fillOrKeep(outRow, oldHeaders, newRow) {
  // newRow columns may collide; fill blanks safely
  for (const [k, v] of Object.entries(newRow)) {
    if (k in outRow) {
      // collision
      const pref = `norm_${k}`;
      outRow[pref] = v ?? "";
      if (FILL_PREFERRED.has(k) && shouldFillBlank(outRow[k], v)) {
        outRow[k] = v ?? "";
      }
    } else {
      outRow[k] = v ?? "";
    }
  }
  return outRow;
}

// ----------------------------
// Main
// ----------------------------
function readText(p) {
  return fs.readFileSync(p, "utf8");
}

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function main() {
  if (!fs.existsSync(OLD_PATH)) {
    console.error(`❌ Missing old CSV: ${OLD_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(NEW_PATH)) {
    console.error(`❌ Missing normalized CSV: ${NEW_PATH}`);
    process.exit(1);
  }

  console.log(`📥 Old: ${OLD_PATH}`);
  console.log(`📥 New: ${NEW_PATH}`);
  console.log(`🧠 Mode: ${FILL_BLANKS ? "fill blanks ON (--fill-blanks)" : "fill blanks OFF"}`);

  const oldText = readText(OLD_PATH);
  const newText = readText(NEW_PATH);

  const oldRows = parseDelimited(oldText, ",");
  const newRows = parseDelimited(newText, ",");

  const { headers: oldHeaders, objects: oldObjs } = toObjects(oldRows);
  const { headers: newHeaders, objects: newObjs } = toObjects(newRows);

  // index normalized by primary key
  const idx = new Map();
  for (const r of newObjs) {
    const k = keyFromNew(r);
    if (!k) continue;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(r);
  }

  const outHeaders = mergeHeaders(oldHeaders, newHeaders);

  let matched = 0;
  let unmatched = 0;
  let ambiguous = 0;

  const examples = {
    unmatched_old_rows: [],
    ambiguous_old_rows: [],
  };

  const usedNewIds = new Set();

  const merged = oldObjs.map((oldRow) => {
    const k = keyFromOld(oldRow);
    const candidates = idx.get(k) || [];

    let best = null;
    let bestScore = -1;

    if (candidates.length === 1) {
      best = candidates[0];
      bestScore = scoreMatch(oldRow, best);
    } else if (candidates.length > 1) {
      // choose best by score; track ambiguity if close
      const scored = candidates
        .map((c) => ({ c, s: scoreMatch(oldRow, c) }))
        .sort((a, b) => b.s - a.s);

      best = scored[0].c;
      bestScore = scored[0].s;

      const second = scored[1]?.s ?? -999;
      if (second >= bestScore - 1) {
        ambiguous++;
        if (examples.ambiguous_old_rows.length < 10) {
          examples.ambiguous_old_rows.push({
            key: k,
            old: {
              Player: getField(oldRow, OLD_FIELD_GUESSES.player),
              Set: getField(oldRow, OLD_FIELD_GUESSES.set),
              "Card Number": getField(oldRow, OLD_FIELD_GUESSES.card_number),
              Season: getField(oldRow, OLD_FIELD_GUESSES.year),
              Team: getField(oldRow, OLD_FIELD_GUESSES.team),
              Title: getField(oldRow, OLD_FIELD_GUESSES.title),
            },
            top_candidates: scored.slice(0, 3).map((x) => ({
              score: x.s,
              id: x.c.id,
              player: x.c.player,
              set: x.c.set,
              card_number: x.c.card_number,
              year: x.c.year,
              team: x.c.team,
            })),
          });
        }
      }
    }

    const outRow = { ...oldRow };

    // attach normalized match if good enough
    if (best && bestScore >= 8) {
      matched++;
      if (best.id) usedNewIds.add(best.id);
      return fillOrKeep(outRow, oldHeaders, best);
    } else {
      unmatched++;
      if (examples.unmatched_old_rows.length < 10) {
        examples.unmatched_old_rows.push({
          key: k,
          Player: getField(oldRow, OLD_FIELD_GUESSES.player),
          Set: getField(oldRow, OLD_FIELD_GUESSES.set),
          "Card Number": getField(oldRow, OLD_FIELD_GUESSES.card_number),
          Season: getField(oldRow, OLD_FIELD_GUESSES.year),
          Team: getField(oldRow, OLD_FIELD_GUESSES.team),
          Title: getField(oldRow, OLD_FIELD_GUESSES.title),
        });
      }
      return outRow;
    }
  });

  // also report normalized rows that were never used (useful for finding “new-only” cards)
  const unusedNormalized = [];
  for (const r of newObjs) {
    if (!r.id) continue;
    if (!usedNewIds.has(r.id)) {
      if (unusedNormalized.length < 25) unusedNormalized.push(r);
    }
  }

  const report = {
    inputs: {
      old_path: OLD_PATH,
      new_path: NEW_PATH,
      old_rows: oldObjs.length,
      new_rows: newObjs.length,
      fill_blanks: FILL_BLANKS,
    },
    results: {
      matched,
      unmatched,
      ambiguous,
      output_rows: merged.length,
      output_columns: outHeaders.length,
      unused_normalized_count_estimate: newObjs.length - usedNewIds.size,
    },
    samples: {
      ...examples,
      unused_normalized_sample: unusedNormalized,
    },
  };

  ensureDirFor(OUT_CSV);
  ensureDirFor(OUT_TSV);
  ensureDirFor(OUT_REPORT);

  fs.writeFileSync(OUT_CSV, writeCSV(outHeaders, merged), "utf8");
  fs.writeFileSync(OUT_TSV, writeTSV(outHeaders, merged), "utf8");
  fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2), "utf8");

  console.log(`✅ Wrote: ${OUT_CSV}`);
  console.log(`✅ Wrote: ${OUT_TSV}`);
  console.log(`📄 Report: ${OUT_REPORT}`);
  console.log(
    `📊 matched=${matched} | unmatched=${unmatched} | ambiguous=${ambiguous} | cols=${outHeaders.length}`
  );

  if (unmatched > 0) {
    console.log("⚠️ Some old rows did not match normalized (see report samples).");
  }
  if (report.results.unused_normalized_count_estimate > 0) {
    console.log("ℹ️ Some normalized rows were not used (see report).");
  }
}

main();
