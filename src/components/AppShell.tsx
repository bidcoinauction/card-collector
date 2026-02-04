"use client";

import { useEffect, useMemo, useState } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import CardGrid from "./CardGrid";
import Drawer, { DrawerTab } from "./Drawer";
import BulkBar from "./BulkBar";
import ConfirmDialog from "./ConfirmDialog";
import Sparkline from "./Sparkline";
import PriceResearch from "./PriceResearch";
import { CardRow, CardComputed } from "@/lib/types";
import { money, urlsFromImages } from "@/lib/query";

type ApiResponse = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: CardRow[];
  facets?: { league: string[]; set: string[]; team: string[]; season: string[] };
  // optional metadata
  source?: string;
};

type Override = {
  tag?: string;
  condition?: string;
  marketAvg?: number;
};

type HistoryPoint = {
  v: number;
  at: string; // ISO
  source: "average" | "median" | "highest" | "lowest" | "manual" | "bulk";
};

const OV_KEY = "cc_overrides_v1";
const DEL_KEY = "cc_deleted_v1";
const HIST_KEY = "cc_value_history_v1";

function fmtMoney(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function syntheticHistory(id: string, base: number | null, last: number | null): number[] {
  const seed = Array.from(id).reduce((a, c) => a + c.charCodeAt(0), 0) % 997;
  const center = (base ?? last ?? 0) || 0;
  const delta = base != null && last != null ? base - last : 0;
  const amp = Math.max(0.5, Math.min(6, Math.abs(delta) || 2));
  const out: number[] = [];
  for (let i = 0; i < 16; i++) {
    const t = (i / 15) * Math.PI * 2;
    const wobble = Math.sin(t + seed) * amp * 0.25 + Math.cos(t * 0.7 + seed) * amp * 0.15;
    const trend = (i - 7.5) * (delta / 60);
    out.push(Math.max(0, center + wobble + trend));
  }
  return out;
}

function loadJSON<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}

function asStr(v: unknown) {
  return (v ?? "").toString();
}

function firstStr(...vals: unknown[]) {
  for (const v of vals) {
    const s = asStr(v).trim();
    if (s) return s;
  }
  return "";
}

function coerceArray<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function normalizeApiResponse(raw: any, fallbackPage: number, fallbackPageSize: number): ApiResponse {
  // Shape A (your App expects): { page, pageSize, total, totalPages, items, facets }
  if (raw && Array.isArray(raw.items)) {
    const page = Number(raw.page || fallbackPage) || fallbackPage;
    const pageSize = Number(raw.pageSize || fallbackPageSize) || fallbackPageSize;
    const total = Number(raw.total ?? raw.count ?? raw.items.length) || 0;
    const totalPages =
      Number(raw.totalPages) ||
      (pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1);

    return {
      page,
      pageSize,
      total,
      totalPages,
      items: raw.items,
      facets: raw.facets,
      source: raw.source,
    };
  }

  // Shape B (your prod API): { cards, count, page, pageSize, ... }
  if (raw && Array.isArray(raw.cards)) {
    const page = Number(raw.page || fallbackPage) || fallbackPage;
    const pageSize = Number(raw.pageSize || fallbackPageSize) || fallbackPageSize;
    const total = Number(raw.total ?? raw.count ?? raw.cards.length) || 0;
    const totalPages =
      Number(raw.totalPages) ||
      (pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1);

    // treat cards as items for the UI layer
    return {
      page,
      pageSize,
      total,
      totalPages,
      items: raw.cards,
      facets: raw.facets,
      source: raw.source,
    };
  }

  // Shape C: plain array
  if (Array.isArray(raw)) {
    const items = raw as CardRow[];
    const page = fallbackPage;
    const pageSize = fallbackPageSize;
    const total = items.length;
    const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
    return { page, pageSize, total, totalPages, items };
  }

  // Fallback
  return { page: fallbackPage, pageSize: fallbackPageSize, total: 0, totalPages: 1, items: [] };
}

export default function AppShell() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("recent");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const [league, setLeague] = useState("");
  const [setV, setSetV] = useState("");
  const [team, setTeam] = useState("");
  const [season, setSeason] = useState("");

  const [auto, setAuto] = useState(false);
  const [rc, setRc] = useState(false);

  const [compact, setCompact] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);

  const [loading, setLoading] = useState(true);
  const [resp, setResp] = useState<ApiResponse | null>(null);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<DrawerTab>("details");

  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [deleted, setDeleted] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({});

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Load persistence
  useEffect(() => {
    setOverrides(loadJSON<Record<string, Override>>(OV_KEY, {}));
    setDeleted(loadJSON<Record<string, boolean>>(DEL_KEY, {}));
    setHistory(loadJSON<Record<string, HistoryPoint[]>>(HIST_KEY, {}));
  }, []);

  // Persist
  useEffect(() => {
    localStorage.setItem(OV_KEY, JSON.stringify(overrides));
  }, [overrides]);

  useEffect(() => {
    localStorage.setItem(DEL_KEY, JSON.stringify(deleted));
  }, [deleted]);

  useEffect(() => {
    localStorage.setItem(HIST_KEY, JSON.stringify(history));
  }, [history]);

  const qs = useMemo(() => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    sp.set("sort", sort);
    sp.set("dir", dir);
    if (league) sp.set("league", league);
    if (setV) sp.set("set", setV);
    if (team) sp.set("team", team);
    if (season) sp.set("season", season);
    if (auto) sp.set("auto", "1");
    if (rc) sp.set("rc", "1");
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    return sp.toString();
  }, [q, sort, dir, league, setV, team, season, auto, rc, page, pageSize]);

  useEffect(() => {
    let alive = true;
    setLoading(true);

    fetch(`/api/cards?${qs}`, { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
        return data;
      })
      .then((data: any) => {
        if (!alive) return;

        const normalized = normalizeApiResponse(data, page, pageSize);
        setResp(normalized);
        setLoading(false);
        setSelected({});
      })
      .catch((err) => {
        console.error("Failed to load /api/cards", err);
        if (!alive) return;
        setResp(null);
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [qs, page, pageSize]);

  function pushHistory(cardId: string, value: number, source: HistoryPoint["source"]) {
    const at = new Date().toISOString();
    setHistory((prev) => {
      const cur = prev[cardId] ? [...prev[cardId]] : [];
      cur.push({ v: value, at, source });
      // keep last 60 points
      const trimmed = cur.slice(-60);
      return { ...prev, [cardId]: trimmed };
    });
  }

  const items: (CardComputed & { tag?: string; condition?: string })[] = useMemo(() => {
    const raw = resp?.items ?? [];

    return raw
      .map((cAny: any, idx) => {
        // Support BOTH schemas:
        // - CSV style: c["Title"], c["Season"], c["Images"], etc.
        // - Normalized style: c.title, c.season, c.images, etc.

        const title = firstStr(cAny?.title, cAny?.Title) || "(untitled)";

        const id =
          firstStr(
            cAny?.id,
            cAny?.ID,
            cAny?.sku,
            cAny?.["Custom label (SKU)"],
            cAny?.["Custom Label (SKU)"]
          ) || `${title}__${firstStr(cAny?.season, cAny?.Season)}__${idx}`;

        // Market/last sold: support normalized + CSV columns
        const baseMarket = money(
          firstStr(cAny?.marketAvg, cAny?.market_avg, cAny?.["Market Avg (eBay 90d USD)"])
        );
        const lastSold = money(firstStr(cAny?.lastSold, cAny?.last_sold, cAny?.["Last Sold Raw (USD)"]));
        const ov = overrides[id];

        const marketAvg = ov?.marketAvg ?? baseMarket;
        const delta = marketAvg != null && lastSold != null ? marketAvg - lastSold : null;

        const images =
          coerceArray<string>(cAny?.images).length > 0
            ? coerceArray<string>(cAny?.images)
            : urlsFromImages(cAny?.Images ?? cAny?.["Images"]);

        return {
          id,
          title,

          player: firstStr(cAny?.player, cAny?.Player),
          set: firstStr(cAny?.set, cAny?.Set),
          season: firstStr(cAny?.season, cAny?.Season),
          team: firstStr(cAny?.team, cAny?.Team),
          league: firstStr(cAny?.league, cAny?.League),
          features: firstStr(cAny?.features, cAny?.Features),

          images,

          marketAvg,
          lastSold,

          lastSoldEnded: firstStr(cAny?.lastSoldEnded, cAny?.["Last Sold Raw Ended"]),
          lastSoldUrl: firstStr(cAny?.lastSoldUrl, cAny?.["Last Sold Raw URL"]),

          delta,

          tag: ov?.tag,
          condition: ov?.condition,
        };
      })
      .filter((c) => !deleted[c.id]);
  }, [resp, overrides, deleted]);

  const openCard = useMemo(() => items.find((x) => x.id === openId) ?? null, [items, openId]);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([k]) => k),
    [selected]
  );
  const selectedCount = selectedIds.length;

  function toggleSelect(id: string, on: boolean) {
    setSelected((s) => ({ ...s, [id]: on }));
  }
  function clearSelection() {
    setSelected({});
  }

  function exportSelectedCSV() {
    const chosen = items.filter((x) => selected[x.id]);
    if (!chosen.length) return;

    const cols = [
      "id",
      "title",
      "player",
      "set",
      "season",
      "team",
      "league",
      "tag",
      "condition",
      "marketAvg",
      "lastSold",
      "delta",
      "lastSoldEnded",
      "lastSoldUrl",
      "image",
    ];

    const esc = (v: unknown) => {
      const s = (v ?? "").toString();
      return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [
      cols.join(","),
      ...chosen.map((c) =>
        cols
          .map((k) => {
            const v: any = (c as any)[k];
            if (k === "image") return esc(c.images[0] ?? "");
            if (typeof v === "number") return esc(String(v));
            return esc(v ?? "");
          })
          .join(",")
      ),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "selected_cards.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function applyOverride(ids: string[], patch: Override) {
    setOverrides((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = { ...(next[id] || {}), ...patch };
      return next;
    });
  }

  function bulkTag(tag: string) {
    applyOverride(selectedIds, { tag });
  }

  function bulkCondition(condition: string) {
    applyOverride(selectedIds, { condition });
  }

  function bulkValue(value: number) {
    applyOverride(selectedIds, { marketAvg: value });
    for (const id of selectedIds) pushHistory(id, value, "bulk");
  }

  function bulkDelete() {
    setConfirmDeleteOpen(true);
  }

  function confirmBulkDelete() {
    setDeleted((prev) => {
      const next = { ...prev };
      for (const id of selectedIds) next[id] = true;
      return next;
    });
    setConfirmDeleteOpen(false);
    clearSelection();
    if (openId && selected[openId]) setOpenId(null);
  }

  function historyFor(id: string) {
    const pts = history[id]?.map((p) => p.v).filter((n) => Number.isFinite(n)) ?? [];
    if (pts.length >= 2) return pts.slice(-16);
    const c = items.find((x) => x.id === id);
    return syntheticHistory(id, c?.marketAvg ?? null, c?.lastSold ?? null);
  }

  return (
    <div className={`app ${compact ? "compact" : ""}`}>
      <Sidebar />

      <div className="main">
        <Topbar
          total={resp?.total ?? 0}
          page={resp?.page ?? page}
          pageSize={resp?.pageSize ?? pageSize}
          totalPages={resp?.totalPages ?? 1}
          q={q}
          onQ={(v) => {
            setPage(1);
            setQ(v);
          }}
          sort={sort}
          dir={dir}
          onSort={(s) => {
            setPage(1);
            setSort(s);
          }}
          onDir={(d) => {
            setPage(1);
            setDir(d);
          }}
          compact={compact}
          onCompact={() => setCompact((x) => !x)}
          viewMode={viewMode}
          onViewMode={(m) => setViewMode(m)}
          facets={resp?.facets}
          league={league}
          setLeague={(v) => {
            setPage(1);
            setLeague(v);
          }}
          setV={setV}
          setSetV={(v) => {
            setPage(1);
            setSetV(v);
          }}
          team={team}
          setTeam={(v) => {
            setPage(1);
            setTeam(v);
          }}
          season={season}
          setSeason={(v) => {
            setPage(1);
            setSeason(v);
          }}
          auto={auto}
          setAuto={(v) => {
            setPage(1);
            setAuto(v);
          }}
          rc={rc}
          setRc={(v) => {
            setPage(1);
            setRc(v);
          }}
          pageSizeValue={pageSize}
          setPageSize={(n) => {
            setPage(1);
            setPageSize(n);
          }}
        />

        <BulkBar
          count={selectedCount}
          onExport={exportSelectedCSV}
          onClear={clearSelection}
          onBulkTag={bulkTag}
          onBulkCondition={bulkCondition}
          onBulkValue={bulkValue}
          onBulkDelete={bulkDelete}
        />

        <CardGrid
          loading={loading}
          items={items}
          page={resp?.page ?? page}
          totalPages={resp?.totalPages ?? 1}
          onPage={setPage}
          selected={selected}
          onSelect={toggleSelect}
          onOpen={(id) => {
            setOpenId(id);
            setTab("details");
          }}
          compact={compact}
          viewMode={viewMode}
          historyFor={historyFor}
          overrides={overrides}
        />

        <Drawer
          open={!!openCard}
          title={openCard?.title ?? ""}
          subtitle={openCard ? `${openCard.player} • ${openCard.season} • ${openCard.set}` : ""}
          tab={tab}
          onTab={setTab}
          onClose={() => setOpenId(null)}
        >
          {!openCard ? null : (
            <>
              {tab === "details" ? (
                <div className="drawerSection">
                  <div className="drawerGrid">
                    <div className="kv">
                      <div className="k">Player</div>
                      <div className="v">{openCard.player || "—"}</div>
                    </div>
                    <div className="kv">
                      <div className="k">Team</div>
                      <div className="v">{openCard.team || "—"}</div>
                    </div>
                    <div className="kv">
                      <div className="k">League</div>
                      <div className="v">{openCard.league || "—"}</div>
                    </div>
                    <div className="kv">
                      <div className="k">Set</div>
                      <div className="v">{openCard.set || "—"}</div>
                    </div>
                    <div className="kv">
                      <div className="k">Season</div>
                      <div className="v">{openCard.season || "—"}</div>
                    </div>
                    <div className="kv">
                      <div className="k">Features</div>
                      <div className="v">{openCard.features || "—"}</div>
                    </div>
                    <div className="kv">
                      <div className="k">Market Avg</div>
                      <div className="v">{fmtMoney(openCard.marketAvg)}</div>
                    </div>
                    <div className="kv">
                      <div className="k">Last Sold</div>
                      <div className="v">{fmtMoney(openCard.lastSold)}</div>
                    </div>
                    <div className="kv">
                      <div className="k">Delta</div>
                      <div className="v">{openCard.delta == null ? "—" : fmtMoney(openCard.delta)}</div>
                    </div>
                  </div>

                  <div className="drawerImages">
                    {openCard.images.slice(0, 2).map((u) => (
                      <a key={u} className="drawerImgLink" href={u} target="_blank" rel="noreferrer">
                        <img src={u} alt="" loading="lazy" decoding="async" />
                      </a>
                    ))}
                    {!openCard.images.length ? <div className="drawerPh">No images</div> : null}
                  </div>
                </div>
              ) : null}

              {tab === "history" ? (
                <div className="drawerSection">
                  <div className="historyCard">
                    <div className="historyTop">
                      <div>
                        <div className="historyTitle">Value Trend</div>
                        <div className="muted">Real history stored locally (per browser).</div>
                      </div>
                      <div className="historyNow">{fmtMoney(openCard.marketAvg)}</div>
                    </div>
                    <div className="historySpark">
                      <Sparkline values={historyFor(openCard.id)} />
                    </div>

                    <div className="historyList">
                      {(history[openCard.id] || [])
                        .slice(-8)
                        .reverse()
                        .map((p, idx) => (
                          <div className="historyRow" key={idx}>
                            <div className="historyV">{fmtMoney(p.v)}</div>
                            <div className="historyMeta muted">
                              {p.source} • {new Date(p.at).toLocaleString()}
                            </div>
                          </div>
                        ))}
                      {!history[openCard.id] || history[openCard.id].length === 0 ? (
                        <div className="muted" style={{ marginTop: 8 }}>
                          No saved history yet — update value from Price Research or Bulk Value.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === "ebay" ? (
                <div className="drawerSection">
                  <PriceResearch
                    card={{
                      id: openCard.id,
                      title: openCard.title,
                      player: openCard.player,
                      season: openCard.season,
                      set: openCard.set,
                      team: openCard.team,
                      league: openCard.league,
                      features: openCard.features,
                      marketAvg: openCard.marketAvg,
                    }}
                    onUpdateMarketAvg={(value, source) => {
                      setOverrides((prev) => ({
                        ...prev,
                        [openCard.id]: { ...(prev[openCard.id] || {}), marketAvg: value },
                      }));
                      pushHistory(openCard.id, value, source);
                    }}
                  />
                </div>
              ) : null}
            </>
          )}
        </Drawer>

        <ConfirmDialog
          open={confirmDeleteOpen}
          title="Delete Multiple Cards"
          message={`Are you sure you want to delete ${selectedCount} cards? This will hide them locally (stored in your browser).`}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDeleteOpen(false)}
          onConfirm={confirmBulkDelete}
        />
      </div>
    </div>
  );
}
