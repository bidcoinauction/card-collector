#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const IMAGE_BASE =
  "https://sportscards.standard.us-east-1.oortstorages.com/new%20card%20scans%202/card%20matcher/";

const DEFAULT_OUTDIR = "data";

const SEARCH_DIRS = [
  process.cwd(),
  path.join(process.cwd(), "data"),
  path.join(process.cwd(), "public"),
  path.join(process.cwd(), "inventory"),
  path.join(process.cwd(), "server"),
  path.join(process.cwd(), "server", "public"),
];

const CANDIDATE_BASENAMES = [
  "inventory.csv",
  "inventory.tsv",
  "full_card_inventory.tsv",
  "full_card_inventory.csv",
  "full_card_inventory.txt",
  "bulk_inventory.csv",
  "bulk_inventory.tsv",
];

const CANONICAL_HEADERS = [
  "id",
  "sport",
  "year",
  "set",
  "subset",
  "card_number",
  "player",
  "team",
  "league",
  "parallel",
  "insert",
  "rookie",
  "autograph",
  "serial_number",
  "grade",
  "condition",
  "quantity",
  "purchase_price",
  "value",
  "currency",
  "notes",
  "image",
  "image_back",
  "source",
  "timestamp",
];

const HEADER_ALIASES = new Map([
  ["card #", "card_number"],
  ["card#", "card_number"],
  ["card number", "card_number"],
  ["number", "card_number"],
  ["no.", "card_number"],
  ["no", "card_number"],

  ["player name", "player"],
  ["name", "player"],

  ["set name", "set"],
  ["product", "set"],
  ["collection", "set"],

  ["sub-set", "subset"],
  ["sub set", "subset"],

  ["qty", "quantity"],
  ["count", "quantity"],
  ["est value", "value"],
  ["estimated value", "value"],
  ["price", "value"],
  ["current value", "value"],
  ["buy price", "purchase_price"],
  ["cost", "purchase_price"],
  ["purchase", "purchase_price"],

  ["rc", "rookie"],
  ["auto", "autograph"],
  ["sig", "autograph"],
  ["signed", "autograph"],

  ["sn", "serial_number"],
  ["serial", "serial_number"],
  ["serial#", "serial_number"],

  ["season", "year"],
  ["year/season", "year"],
  ["set year", "year"],
  ["release year", "year"],
  ["yr", "year"],

  // images
  ["img", "image"],
  ["image_url", "image"],
  ["image url", "image"],
  ["front_image", "image"],
  ["front image", "image"],
  ["front", "image"],
  ["image_front", "image"],
  ["image front", "image"],
  ["photo", "image"],
  ["photo_url", "image"],
  ["front_url", "image"],
  ["front url", "image"],
  ["filename", "image"],
  ["file", "image"],
  ["images", "images"],

  ["back_image", "image_back"],
  ["back image", "image_back"],
  ["back", "image_back"],
  ["back_url", "image_back"],
  ["back url", "image_back"],
]);

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}
const INPUT_OVERRIDE = getArg("--in");
const OUTDIR = getArg("--outdir") || DEFAULT_OUTDIR;

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}
function readText(p) {
  return fs.readFileSync(p, "utf8");
}
function writeText(p, s) {
  fs.writeFileSync(p, s, "utf8");
}
function statMtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
function canonicalizeHeader(h) {
  const nh = normalizeHeader(h);
  if (HEADER_ALIASES.has(nh)) return HEADER_ALIASES.get(nh);
  if (CANONICAL_HEADERS.includes(nh)) return nh;
  const underscored = nh.replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "");
  if (HEADER_ALIASES.has(underscored)) return HEADER_ALIASES.get(underscored);
  if (CANONICAL_HEADERS.includes(underscored)) return underscored;
  return underscored || "col";
}

function detectDelimiter(sampleLine) {
  const t = (sampleLine.match(/\t/g) || []).length;
  const c = (sampleLine.match(/,/g) || []).length;
  const p = (sampleLine.match(/\|/g) || []).length;
  if (t >= c && t >= p && t > 0) return "\t";
  if (c >= t && c >= p && c > 0) return ",";
  if (p > 0) return "|";
  return ",";
}

function splitLine(line, delim) {
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

    if (!inQuotes && ch === delim) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }
  out.push(cur);
  return out;
}

function normalizeText(v) {
  return String(v ?? "").replace(/\r/g, "").trim();
}
function toBool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  if (["1", "true", "yes", "y", "t"].includes(s)) return "true";
  if (["0", "false", "no", "n", "f"].includes(s)) return "false";
  return s;
}
function safeInt(v, fallback = "") {
  const s = String(v ?? "").trim();
  if (!s) return fallback;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? String(n) : fallback;
}
function safeNum(v, fallback = "") {
  const s = String(v ?? "").trim().replace(/^\$/, "");
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : fallback;
}
function normalizeYear(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = s.match(/(19|20)\d{2}/);
  if (m) return m[0];
  return safeInt(s);
}

function normalizeImageUrl(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (s.startsWith(IMAGE_BASE)) return s;
  if (/^https?:\/\//i.test(s)) return s;

  // strip wrappers like quotes/brackets
  const cleaned = s.replace(/^["'\[\(]+/, "").replace(/["'\]\)]+$/, "");

  // filename only -> IMAGE_BASE
  const file = cleaned.replace(/^(\.\/|\/)+/, "").split(/[\\/]/).pop();
  if (!file) return "";
  return IMAGE_BASE + encodeURIComponent(file).replace(/%2F/g, "/");
}

/**
 * Parse the "Images" column.
 * Accepts:
 *  - JSON array string: ["a","b"]
 *  - comma-separated: a,b
 *  - pipe-separated: a | b
 *  - semicolon: a; b
 *  - "front=... back=..."
 */
function parseImagesField(raw) {
  const s = normalizeText(raw);
  if (!s) return { front: "", back: "" };

  // 1) JSON array?
  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) {
        const a = String(arr[0] ?? "").trim();
        const b = String(arr[1] ?? "").trim();
        return { front: a, back: b };
      }
    } catch {
      // fallthrough
    }
  }

  // 2) key/value patterns
  const frontKV = s.match(/front\s*[:=]\s*([^;|,]+)/i);
  const backKV = s.match(/back\s*[:=]\s*([^;|,]+)/i);
  if (frontKV || backKV) {
    return {
      front: normalizeText(frontKV?.[1] ?? ""),
      back: normalizeText(backKV?.[1] ?? ""),
    };
  }

  // 3) split on common separators
  const parts = s
    .split(/\s*(\||,|;)\s*/g)
    .filter((p) => p && !["|", ",", ";"].includes(p))
    .map((p) => normalizeText(p))
    .filter(Boolean);

  return {
    front: parts[0] ?? "",
    back: parts[1] ?? "",
  };
}

function makeId(row, idx) {
  const key = [
    row.year,
    row.set,
    row.card_number,
    row.player,
    row.parallel,
    row.insert,
  ]
    .map((x) => String(x ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
  if (key) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return `c_${h.toString(16)}`;
  }
  return `row_${idx + 1}`;
}

function escapeCell(s, delim) {
  const v = String(s ?? "");
  const needs =
    v.includes('"') || v.includes("\n") || v.includes("\r") || v.includes(delim);
  if (!needs) return v;
  return `"${v.replace(/"/g, '""')}"`;
}
function toDelimited(objs, delim) {
  const header = CANONICAL_HEADERS.join(delim);
  const lines = [header];
  for (const o of objs) {
    const row = CANONICAL_HEADERS.map((h) => escapeCell(o[h], delim)).join(delim);
    lines.push(row);
  }
  return lines.join("\n") + "\n";
}

function listFilesRecursive(dir, maxDepth = 4, depth = 0) {
  const results = [];
  if (depth > maxDepth) return results;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", ".git", "dist", "build"].includes(e.name)) continue;
      results.push(...listFilesRecursive(p, maxDepth, depth + 1));
    } else {
      results.push(p);
    }
  }
  return results;
}

function chooseBestInventoryFile() {
  if (INPUT_OVERRIDE) {
    const abs = path.isAbsolute(INPUT_OVERRIDE)
      ? INPUT_OVERRIDE
      : path.join(process.cwd(), INPUT_OVERRIDE);
    if (!exists(abs)) throw new Error(`--in file not found: ${abs}`);
    return abs;
  }

  const direct = [];
  for (const d of SEARCH_DIRS) {
    for (const base of CANDIDATE_BASENAMES) {
      const p = path.join(d, base);
      if (exists(p)) direct.push(p);
    }
  }
  if (direct.length) {
    direct.sort((a, b) => statMtime(b) - statMtime(a));
    return direct[0];
  }

  const all = [];
  for (const d of SEARCH_DIRS) {
    if (!exists(d)) continue;
    const files = listFilesRecursive(d, 3);
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if ([".csv", ".tsv", ".txt"].includes(ext)) all.push(f);
    }
  }
  if (!all.length) return null;

  all.sort((a, b) => statMtime(b) - statMtime(a));
  return all[0];
}

// "most complete" wins: prefer rows with image, year, team, league, etc.
function rowCompletenessScore(r) {
  const fields = [
    "image",
    "image_back",
    "year",
    "set",
    "card_number",
    "player",
    "team",
    "league",
    "parallel",
    "insert",
    "value",
  ];
  let score = 0;
  for (const f of fields) if (normalizeText(r[f])) score++;
  return score;
}

function dedupeById(rows) {
  const map = new Map();
  for (const r of rows) {
    const id = r.id;
    if (!id) continue;
    const existing = map.get(id);
    if (!existing) {
      map.set(id, r);
    } else {
      const a = rowCompletenessScore(existing);
      const b = rowCompletenessScore(r);
      if (b > a) map.set(id, r);
    }
  }
  return Array.from(map.values());
}

function main() {
  const inputPath = chooseBestInventoryFile();
  if (!inputPath) {
    console.error("❌ No input inventory file found.");
    process.exit(1);
  }

  console.log(`📥 Input: ${inputPath}`);

  const raw = readText(inputPath);
  const lines = raw.split("\n").map((l) => l.replace(/\r/g, ""));
  while (lines.length && !lines[0].trim()) lines.shift();
  if (!lines.length) {
    console.error("❌ Input file is empty.");
    process.exit(1);
  }

  const delim = detectDelimiter(lines[0]);
  console.log(
    `🔎 Detected delimiter: ${
      delim === "\t" ? "TAB (TSV)" : delim === "," ? "COMMA (CSV)" : "PIPE (|)"
    }`
  );

  const headerRaw = splitLine(lines[0], delim).map(normalizeText);
  const headerCanon = headerRaw.map(canonicalizeHeader);
  const canonKeySet = new Set(headerCanon);

  console.log("\n🧭 Header audit:");
  headerRaw.slice(0, 60).forEach((h, i) => {
    const c = headerCanon[i];
    const mark = CANONICAL_HEADERS.includes(c) ? "✅" : "➕";
    console.log(`  ${mark} "${h}" -> ${c}`);
  });
  if (headerRaw.length > 60) console.log(`  … +${headerRaw.length - 60} more columns`);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cells = splitLine(line, delim).map(normalizeText);
    const obj = {};
    for (let c = 0; c < headerCanon.length; c++) {
      obj[headerCanon[c]] = cells[c] ?? "";
    }
    rows.push(obj);
  }

  console.log(`\n🧾 Rows parsed: ${rows.length}`);

  const normalized = rows.map((r, i) => {
    const out = {};
    for (const h of CANONICAL_HEADERS) out[h] = "";

    // copy canonical keys
    for (const [k, v] of Object.entries(r)) {
      const ck = canonicalizeHeader(k);
      if (ck in out) out[ck] = normalizeText(v);
    }

    out.year = normalizeYear(out.year);

    out.quantity = safeInt(out.quantity, "1") || "1";
    out.purchase_price = safeNum(out.purchase_price);
    out.value = safeNum(out.value);
    out.rookie = toBool(out.rookie);
    out.autograph = toBool(out.autograph);

    // --- IMAGE FIX: use `images` field if image is blank ---
    if (!out.image) {
      // direct aliases might have put something into out.images (non-canonical),
      // but our parsed row includes it as r.images if present.
      const imagesRaw = normalizeText(r.images ?? "");
      if (imagesRaw) {
        const parsed = parseImagesField(imagesRaw);
        out.image = parsed.front || out.image;
        out.image_back = parsed.back || out.image_back;
      }
    }

    // Normalize URLs/filenames
    out.image = normalizeImageUrl(out.image);
    out.image_back = normalizeImageUrl(out.image_back);

    out.id = normalizeText(out.id) || makeId(out, i);
    if (!out.timestamp) out.timestamp = new Date().toISOString();
    if (!out.currency) out.currency = "USD";
    if (!out.condition) out.condition = out.grade ? "graded" : "raw";

    return out;
  });

  const before = normalized.length;
  const deduped = dedupeById(normalized);
  const after = deduped.length;

  mkdirp(path.join(process.cwd(), OUTDIR));
  const outTSV = path.join(process.cwd(), OUTDIR, "full_card_inventory.normalized.tsv");
  const outCSV = path.join(process.cwd(), OUTDIR, "full_card_inventory.normalized.csv");

  writeText(outTSV, toDelimited(deduped, "\t"));
  writeText(outCSV, toDelimited(deduped, ","));

  console.log(`\n✅ Wrote TSV: ${outTSV}`);
  console.log(`✅ Wrote CSV: ${outCSV}`);
  if (after !== before) {
    console.log(`🧹 Deduped by id: ${before} → ${after} (removed ${before - after})`);
  }

  const yearFilled = deduped.filter((r) => r.year).length;
  const imgFilled = deduped.filter((r) => r.image).length;
  const backFilled = deduped.filter((r) => r.image_back).length;

  console.log(
    `\n📊 Fill rates: year=${yearFilled}/${after} (${Math.round(
      (100 * yearFilled) / after
    )}%) | image=${imgFilled}/${after} (${Math.round(
      (100 * imgFilled) / after
    )}%) | image_back=${backFilled}/${after} (${Math.round(
      (100 * backFilled) / after
    )}%)`
  );

  console.log("\n🔬 Preview (first 3 rows):");
  deduped.slice(0, 3).forEach((r, idx) => {
    console.log(`\nRow ${idx + 1}:`);
    console.log({
      id: r.id,
      year: r.year,
      set: r.set,
      card_number: r.card_number,
      player: r.player,
      team: r.team,
      value: r.value,
      image: r.image,
      image_back: r.image_back,
    });
  });

  console.log("\nDone.");
}

try {
  main();
} catch (err) {
  console.error("❌ Normalize failed:", err?.message || err);
  process.exit(1);
}
