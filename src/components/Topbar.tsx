"use client";

export default function Topbar(props: {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;

  q: string;
  onQ: (v: string) => void;

  sort: string;
  dir: "asc" | "desc";
  onSort: (s: string) => void;
  onDir: (d: "asc" | "desc") => void;

  compact: boolean;
  onCompact: () => void;

  viewMode: "grid" | "list";
  onViewMode: (m: "grid" | "list") => void;

  facets?: { league: string[]; set: string[]; team: string[]; season: string[] };

  league: string;
  setLeague: (v: string) => void;
  setV: string;
  setSetV: (v: string) => void;
  team: string;
  setTeam: (v: string) => void;
  season: string;
  setSeason: (v: string) => void;

  auto: boolean;
  setAuto: (v: boolean) => void;
  rc: boolean;
  setRc: (v: boolean) => void;

  pageSizeValue: number;
  setPageSize: (n: number) => void;
}) {
  const {
    total, page, pageSize, totalPages,
    q, onQ,
    sort, dir, onSort, onDir,
    compact, onCompact,
    viewMode, onViewMode,
    facets,
    league, setLeague,
    setV, setSetV,
    team, setTeam,
    season, setSeason,
    auto, setAuto,
    rc, setRc,
    pageSizeValue, setPageSize,
  } = props;

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <header className="topbar">
      <div className="topRow">
        <div className="titleBlock">
          <div className="h1">Your Cards <span className="muted">({total.toLocaleString()})</span></div>
          <div className="sub">
            Showing <b>{start}</b>–<b>{end}</b> of <b>{total.toLocaleString()}</b>
          </div>
        </div>

        <div className="rightControls">
          <input
            className="search"
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder="Search cards…  (player:messi set:topps year:2024)"
          />

          <select
            className="select"
            value={`${sort}:${dir}`}
            onChange={(e) => {
              const [s, d] = e.target.value.split(":");
              onSort(s);
              onDir(d as any);
            }}
          >
            <option value="recent:desc">Sort: Recent</option>
            <option value="value:desc">Sort: Value (High→Low)</option>
            <option value="value:asc">Sort: Value (Low→High)</option>
            <option value="gain:desc">Sort: Gain (High→Low)</option>
            <option value="gain:asc">Sort: Gain (Low→High)</option>
            <option value="season:desc">Sort: Season (New→Old)</option>
            <option value="season:asc">Sort: Season (Old→New)</option>
            <option value="title:asc">Sort: Title (A→Z)</option>
            <option value="player:asc">Sort: Player (A→Z)</option>
          </select>

          <div className="seg">
            <button className={`segBtn ${viewMode === "grid" ? "on" : ""}`} onClick={() => onViewMode("grid")}>Grid</button>
            <button className={`segBtn ${viewMode === "list" ? "on" : ""}`} onClick={() => onViewMode("list")}>List</button>
          </div>

          <button className="btn ghost" onClick={onCompact} aria-pressed={compact}>
            {compact ? "Comfort" : "Compact"}
          </button>
        </div>
      </div>

      <div className="filterRow">
        <select className="select" value={league} onChange={(e) => setLeague(e.target.value)}>
          <option value="">League: All</option>
          {(facets?.league ?? []).map((x) => <option key={x} value={x}>{x}</option>)}
        </select>

        <select className="select" value={setV} onChange={(e) => setSetV(e.target.value)}>
          <option value="">Set: All</option>
          {(facets?.set ?? []).map((x) => <option key={x} value={x}>{x}</option>)}
        </select>

        <select className="select" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">Team: All</option>
          {(facets?.team ?? []).map((x) => <option key={x} value={x}>{x}</option>)}
        </select>

        <select className="select" value={season} onChange={(e) => setSeason(e.target.value)}>
          <option value="">Season: All</option>
          {(facets?.season ?? []).map((x) => <option key={x} value={x}>{x}</option>)}
        </select>

        <button className={`chip ${auto ? "on" : ""}`} onClick={() => setAuto(!auto)} aria-pressed={auto}>Auto</button>
        <button className={`chip ${rc ? "on" : ""}`} onClick={() => setRc(!rc)} aria-pressed={rc}>RC</button>

        <select className="select" value={String(pageSizeValue)} onChange={(e) => setPageSize(Number(e.target.value))} title="Cards per page">
          <option value="12">12 / page</option>
          <option value="24">24 / page</option>
          <option value="36">36 / page</option>
          <option value="48">48 / page</option>
          <option value="60">60 / page</option>
        </select>
      </div>

      <div className="pagerMini">
        <span className="muted">Page {page} / {totalPages}</span>
      </div>
    </header>
  );
}
