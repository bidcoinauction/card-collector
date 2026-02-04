"use client";

import { CardComputed } from "@/lib/types";

function fmtMoney(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default function CardListRow({
  card,
  checked,
  onCheck,
  onOpen,
  tagOverride,
  conditionOverride,
}: {
  card: CardComputed & { tag?: string; condition?: string };
  checked: boolean;
  onCheck: (on: boolean) => void;
  onOpen: () => void;
  tagOverride?: string;
  conditionOverride?: string;
}) {
  const img = card.images[0];
  const delta = card.delta;
  const deltaClass = delta == null ? "" : delta >= 0 ? "up" : "down";

  const tag = tagOverride ?? card.league;
  const condition = conditionOverride ?? "raw";

  return (
    <div className="listRow" onClick={(e) => {
      const t = e.target as HTMLElement;
      if (t.closest("button") || t.closest("input") || t.closest("a")) return;
      onOpen();
    }}>
      <div className="listCell checkCell" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label="Select card" />
      </div>

      <div className="listCell thumbCell">
        {img ? <img className="thumb" src={img} alt="" loading="lazy" decoding="async" /> : <div className="thumb ph">—</div>}
      </div>

      <div className="listCell mainCell">
        <div className="listTitle">{card.title}</div>
        <div className="listSub">{card.player} • {card.season} • {card.set}</div>
      </div>

      <div className="listCell tagCell">
        <span className="listTag">{tag || "—"}</span>
      </div>

      <div className="listCell condCell">
        <span className="muted">{condition}</span>
      </div>

      <div className="listCell valueCell">
        <div className="valueMain">{fmtMoney(card.marketAvg)}</div>
        <div className={`valueDelta ${deltaClass}`}>
          {delta == null ? "—" : delta >= 0 ? `▲ ${fmtMoney(Math.abs(delta))}` : `▼ ${fmtMoney(Math.abs(delta))}`}
        </div>
      </div>

      <div className="listCell actionsCell" onClick={(e) => e.stopPropagation()}>
        <button className="link">Edit</button>
        <button className="link danger">Delete</button>
      </div>
    </div>
  );
}
