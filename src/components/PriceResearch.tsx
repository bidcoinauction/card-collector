"use client";

import { useEffect, useMemo, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";

type SoldItem = { title: string; price: number; date: string; url: string; thumb?: string };
type Resp = {
  query: string;
  count: number;
  stats: { average: number; median: number; lowest: number; highest: number };
  sold: SoldItem[];
};

type CacheEntry = Resp & { fetchedAt: number };

const PRICE_CACHE_KEY = "cc_price_cache_v1";
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function fmtMoney(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function buildEbaySoldUrl(q: string) {
  const base = "https://www.ebay.com/sch/i.html";
  const params = new URLSearchParams({
    _nkw: q,
    LH_Sold: "1",
    LH_Complete: "1",
  });
  return `${base}?${params.toString()}`;
}

function buildQuery(card: {
  title: string;
  player: string;
  season: string;
  set: string;
  team: string;
  league: string;
  features: string;
}) {
  const parts: string[] = [];

  if (card.player) parts.push(card.player);
  if (card.season) parts.push(card.season);
  if (card.set) parts.push(card.set);

  const m = card.title.match(/#\s?([0-9]{1,4})/);
  if (m?.[0]) parts.push(m[0].replace(/\s+/g, ""));

  if (card.league) parts.push(card.league);

  const feat = (card.features || "").toLowerCase();
  if (feat.includes("rookie") || feat.includes("rc")) parts.push("RC");
  if (feat.includes("auto")) parts.push("auto");

  return parts.filter(Boolean).join(" ").trim().slice(0, 120);
}

function loadCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(PRICE_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, CacheEntry>) {
  localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(cache));
}

function outlierHint(stats: Resp["stats"]) {
  const med = stats.median || 0;
  if (!med) return { high: false, low: false };
  return {
    high: stats.highest > med * 2.0,
    low: stats.lowest < med * 0.5,
  };
}

function timeAgoLabel(ms: number) {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);

  if (d >= 1) return `${d}d ago`;
  if (h >= 1) return `${h}h ago`;
  if (m >= 1) return `${m}m ago`;
  return `${s}s ago`;
}

export default function PriceResearch({
  card,
  onUpdateMarketAvg,
}: {
  card: {
    id: string;
    title: string;
    player: string;
    season: string;
    set: string;
    team: string;
    league: string;
    features: string;
    marketAvg: number | null;
  };
  onUpdateMarketAvg: (value: number, source: "average" | "median" | "highest" | "lowest") => void;
}) {
  const initial = useMemo(() => buildQuery(card), [card]);
  const [query, setQuery] = useState(initial);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Resp | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState<{ value: number; source: "average" | "median" | "highest" | "lowest" } | null>(null);

  const ebaySoldUrl = useMemo(() => buildEbaySoldUrl(query.trim()), [query]);

  const stale = useMemo(() => {
    if (!cachedAt) return false;
    return Date.now() - cachedAt > TTL_MS;
  }, [cachedAt]);

  // Load cached results for this card (instant UX)
  useEffect(() => {
    const cache = loadCache();
    const entry = cache[card.id];
    if (entry && entry.query) {
      setQuery(entry.query);
      setData(entry);
      setCachedAt(entry.fetchedAt || null);
    }
  }, [card.id]);

  async function run(kind: "search" | "refresh" = "search") {
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    try {
      const r = await fetch(`/api/price-research?q=${encodeURIComponent(q)}&limit=12`, { cache: "no-store" });
      const j = (await r.json()) as Resp;

      setData(j);

      const cache = loadCache();
      cache[card.id] = { ...j, fetchedAt: Date.now() };
      saveCache(cache);
      setCachedAt(cache[card.id].fetchedAt);
    } finally {
      setLoading(false);
    }
  }

  function askUpdate(value: number, source: "average" | "median" | "highest" | "lowest") {
    setPending({ value, source });
    setConfirmOpen(true);
  }

  function doUpdate() {
    if (!pending) return;
    onUpdateMarketAvg(pending.value, pending.source);
    setConfirmOpen(false);
  }

  const hint = data ? outlierHint(data.stats) : { high: false, low: false };

  return (
    <div className="pr">
      <div className="prHead">
        <div className="prTitle">Price Research</div>

        <div className="muted prMeta">
          Research recent sold listings to estimate market value.
          {cachedAt ? (
            <>
              <span className={`prCached ${stale ? "stale" : ""}`}>
                • cached {timeAgoLabel(cachedAt)}
              </span>
              {stale ? (
                <span className="prStalePill" title="Cached results are older than 24 hours. Click Refresh to re-run search.">
                  stale
                </span>
              ) : (
                <span className="prFreshPill" title="Cached results are recent.">fresh</span>
              )}
            </>
          ) : (
            <span className="prCached"> • no cache yet</span>
          )}
        </div>
      </div>

      <div className="prRow">
        <div className="prField">
          <div className="prLabel">Search Query</div>
          <input
            className="prInput"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Player year brand set # card"
          />
          <div className="prTip">Pro tip: Include player, year/season, brand/set, and card number.</div>
        </div>

        <div className="prBtns">
          <button className="btn sm" onClick={() => run("search")} disabled={!query.trim() || loading}>
            {loading ? "Searching…" : "Search"}
          </button>

          <button className="btn ghost sm" onClick={() => run("refresh")} disabled={!query.trim() || loading}>
            Refresh
          </button>

          <a className="btn ghost sm" href={ebaySoldUrl} target="_blank" rel="noreferrer">
            Open eBay
          </a>
        </div>
      </div>

      <div className="prBox">
        <div className="prBoxTitle">Price Analysis</div>

        {!data && !loading ? (
          <div className="muted">Run a search to see average / median / low / high.</div>
        ) : null}

        {loading ? <div className="muted">Fetching comps…</div> : null}

        {data ? (
          <>
            <div className="stats">
              <div className="stat">
                <div className="statK">Average</div>
                <div className="statV">{fmtMoney(data.stats.average)}</div>
              </div>
              <div className="stat">
                <div className="statK">Median</div>
                <div className="statV">{fmtMoney(data.stats.median)}</div>
              </div>
              <div className="stat">
                <div className="statK">Lowest</div>
                <div className="statV">
                  {fmtMoney(data.stats.lowest)}
                  {hint.low ? <span className="hint" title="This lowest price may be an outlier (far below median)."> ⚠</span> : null}
                </div>
              </div>
              <div className="stat">
                <div className="statK">Highest</div>
                <div className="statV">
                  {fmtMoney(data.stats.highest)}
                  {hint.high ? <span className="hint" title="This highest price may be an outlier (far above median)."> ⚠</span> : null}
                </div>
              </div>
            </div>

            <div className="prUpdate">
              <button className="btn sm" onClick={() => askUpdate(data.stats.average, "average")}>
                Update to Average
              </button>
              <button className="btn ghost sm" onClick={() => askUpdate(data.stats.median, "median")}>
                Use Median
              </button>
              <button className="btn ghost sm" onClick={() => askUpdate(data.stats.highest, "highest")} title="Use highest sale (may be outlier)">
                Use Highest
              </button>
              <button className="btn ghost sm" onClick={() => askUpdate(data.stats.lowest, "lowest")} title="Use lowest sale (may be outlier)">
                Use Lowest
              </button>
            </div>

            <div className="prSalesTitle">Recent Sales</div>
            <div className="salesGrid">
              {data.sold.map((s, idx) => (
                <a key={idx} className="saleCard" href={s.url} target="_blank" rel="noreferrer">
                  <div className="saleThumb">
                    {s.thumb ? <img src={s.thumb} alt="" /> : <div className="salePh">▦</div>}
                  </div>
                  <div className="saleInfo">
                    <div className="saleTitle">{s.title}</div>
                    <div className="salePrice">{fmtMoney(s.price)}</div>
                    <div className="saleDate muted">{s.date}</div>
                  </div>
                  <div className="saleGo" aria-hidden="true">↗</div>
                </a>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Update Market Value"
        message={`Update this card’s Market Avg to ${fmtMoney(pending?.value)}? (Stored locally for now.)`}
        confirmLabel="Update"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={doUpdate}
      />
    </div>
  );
}
