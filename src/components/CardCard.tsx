"use client";

import Sparkline from "./Sparkline";
import { CardComputed } from "@/lib/types";

function fmtMoney(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default function CardCard({
  card,
  checked,
  onCheck,
  onOpen,
  compact,
  history,
}: {
  card: CardComputed;
  checked: boolean;
  onCheck: (on: boolean) => void;
  onOpen: () => void;
  compact: boolean;
  history: number[];
}) {
  const delta = card.delta;
  const deltaClass = delta == null ? "" : delta >= 0 ? "up" : "down";

  const img = card.images[0];

  return (
    <article className="card" onClick={(e) => {
      const t = e.target as HTMLElement;
      if (t.closest("button") || t.closest("input")) return;
      onOpen();
    }}>
      <div className="imgWrap">
        <div className="check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onCheck(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            aria-label="Select card"
          />
        </div>

        {card.league ? <span className="tag">{card.league}</span> : null}

        {img ? (
          <img src={img} alt={card.title} loading="lazy" decoding="async" />
        ) : (
          <div className="noImg">No image</div>
        )}
      </div>

      <div className="cardBody">
        <div className="cardTitleRow">
          <h2 className="cardTitle">{card.title}</h2>
          <span className="price">{fmtMoney(card.marketAvg)}</span>
        </div>

        <div className="meta">
          <div className="metaLine">{card.season} • {card.set}</div>
          <div className="metaLine muted">Condition: raw</div>
        </div>

        <div className="valueRow">
          <span className={`delta ${deltaClass}`}>
            {delta == null ? "—" : delta >= 0 ? `▲ ${fmtMoney(Math.abs(delta))}` : `▼ ${fmtMoney(Math.abs(delta))}`}
          </span>

          <span className="updated" title={card.lastSoldEnded ? `Last sold ended: ${card.lastSoldEnded}` : "No last sold date"}>
            ⏱
          </span>

          <div className="sparkWrap" aria-hidden="true">
            <Sparkline values={history} />
          </div>
        </div>
      </div>

      <div className="cardActions" onClick={(e) => e.stopPropagation()}>
        <button className="link">Edit</button>
        <button className="link danger">Delete</button>
      </div>
    </article>
  );
}
