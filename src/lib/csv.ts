import { CardRow } from "./types";

export function parseCsv(text: string): CardRow[] {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length);
  if (!lines.length) return [];

  const splitRow = (row: string) => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;

    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '"') {
        if (inQ && row[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = !inQ;
        }
      } else if (ch === "," && !inQ) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  const headers = splitRow(lines[0]);
  const rows: CardRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitRow(lines[i]);
    const obj: CardRow = {};
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = cols[j] ?? "";
    rows.push(obj);
  }

  return rows;
}
