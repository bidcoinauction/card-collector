import { CardRow } from "./types";

export function normalize(s: unknown) {
  return (s ?? "").toString().toLowerCase().trim();
}

export function money(v: unknown): number | null {
  const n = Number((v ?? "").toString().replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function urlsFromImages(imagesField: unknown): string[] {
  return (imagesField ?? "")
    .toString()
    .split("|")
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

export function parseTokens(q: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  const parts = q.trim().split(/\s+/).filter(Boolean);
  for (const p of parts) {
    const m = p.match(/^([a-zA-Z]+):(.*)$/);
    if (m && m[2]) tokens[normalize(m[1])] = normalize(m[2]);
  }
  return tokens;
}

export function buildPredicate(opts: {
  q: string;
  tokens: Record<string, string>;
  league: string;
  set: string;
  team: string;
  season: string;
  auto: boolean;
  rc: boolean;
}) {
  const qText = normalize(
    opts.q
      .split(/\s+/)
      .filter((p) => !/^[a-zA-Z]+:/.test(p))
      .join(" ")
  );

  return (c: CardRow) => {
    if (opts.league && normalize(c["League"]) !== normalize(opts.league)) return false;
    if (opts.set && normalize(c["Set"]) !== normalize(opts.set)) return false;
    if (opts.team && normalize(c["Team"]) !== normalize(opts.team)) return false;
    if (opts.season && normalize(c["Season"]) !== normalize(opts.season)) return false;

    const features = normalize(c["Features"]);
    const title = normalize(c["Title"]);

    if (opts.auto && !features.includes("auto")) return false;
    if (opts.rc && !(features.includes("rc") || features.includes("rookie") || title.includes("rc"))) return false;

    const hay = [
      c["Title"],
      c["Player"],
      c["Team"],
      c["Set"],
      c["Season"],
      c["League"],
      c["Features"],
      c["Manufacturer"],
    ]
      .map(normalize)
      .join(" ");

    if (qText && !hay.includes(qText)) return false;

    const t = opts.tokens;
    if (t.player && !normalize(c["Player"]).includes(t.player)) return false;
    if (t.team && !normalize(c["Team"]).includes(t.team)) return false;
    if (t.set && !normalize(c["Set"]).includes(t.set)) return false;
    if (t.league && !normalize(c["League"]).includes(t.league)) return false;
    if (t.year && !normalize(c["Season"]).includes(t.year)) return false;
    if (t.feature && !features.includes(t.feature)) return false;

    return true;
  };
}

function seasonNum(season: unknown) {
  const m = (season ?? "").toString().match(/\d{4}/g);
  if (!m) return -1;
  return parseInt(m[m.length - 1], 10);
}

export function buildSorter(sort: string, dir: "asc" | "desc") {
  const mul = dir === "asc" ? 1 : -1;

  return (a: CardRow, b: CardRow) => {
    if (sort === "value") {
      const av = money(a["Market Avg (eBay 90d USD)"]) ?? -1;
      const bv = money(b["Market Avg (eBay 90d USD)"]) ?? -1;
      return mul * (av - bv);
    }

    if (sort === "gain") {
      const am = money(a["Market Avg (eBay 90d USD)"]);
      const al = money(a["Last Sold Raw (USD)"]);
      const bm = money(b["Market Avg (eBay 90d USD)"]);
      const bl = money(b["Last Sold Raw (USD)"]);
      const ad = am != null && al != null ? am - al : -1e18;
      const bd = bm != null && bl != null ? bm - bl : -1e18;
      return mul * (ad - bd);
    }

    if (sort === "season") {
      return mul * (seasonNum(a["Season"]) - seasonNum(b["Season"]));
    }

    if (sort === "title") {
      return mul * normalize(a["Title"]).localeCompare(normalize(b["Title"]));
    }

    if (sort === "player") {
      return mul * normalize(a["Player"]).localeCompare(normalize(b["Player"]));
    }

    return 0;
  };
}
