"use client";

import Image from "next/image";
import Sparkline from "./Sparkline";
import { CardComputed } from "@/lib/types";

function fmtMoney(n: number | null, opts?: { zeroIsMissing?: boolean }) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (opts?.zeroIsMissing && n === 0) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default function CardCard({
  card,
  checked,
  onCheck,
  onOpen,
  compact,
  history,
  priority = false,
}: {
  card: CardComputed;
  checked: boolean;
  onCheck: (on: boolean) => void;
  onOpen: () => void;
  compact: boolean;
  history: number[];
  priority?: boolean;
}) {
  const delta = card.delta;
  const deltaClass = delta == null ? "" : delta >= 0 ? "up" : "down";

  const displayMarket = card.marketAvg === 0 ? null : card.marketAvg;
  const displayDelta = delta == null || !Number.isFinite(delta) || delta === 0 ? null : delta;

  const img = card.images?.[0] || "";

  return (
    <article
      className="card"
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest("button") || t.closest("input")) return;
        onOpen();
      }}
    >
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
          <div
            className="imgFrame"
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: "2.5 / 3.5",
              overflow: "hidden",
              borderRadius: 14,
              background: "rgba(0,0,0,0.04)",
            }}
          >
            <Image
              src={img}
              alt={card.title}
              fill
              priority={priority}
              sizes={
                compact
                  ? "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
                  : "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              }
              style={{ objectFit: "cover" }}
            />
          </div>
        ) : (
          <div className="noImg">No image</div>
        )}
      </div>

      <div className="cardBody">
        <div className="cardTitleRow">
          <h2 className="cardTitle">{card.title}</h2>
          <span className="price">{fmtMoney(displayMarket, { zeroIsMissing: true })}</span>
        </div>

        <div className="meta">
          <div className="metaLine">
            {card.season} • {card.set}
          </div>
          <div className="metaLine muted">Condition: raw</div>
        </div>

        <div className="valueRow">
          <span className={`delta ${deltaClass}`}>
            {displayDelta == null
              ? "—"
              : displayDelta >= 0
                ? `▲ ${fmtMoney(Math.abs(displayDelta))}`
                : `▼ ${fmtMoney(Math.abs(displayDelta))}`}
          </span>

          <span
            className="updated"
            title={card.lastSoldEnded ? `Last sold ended: ${card.lastSoldEnded}` : "No last sold date"}
          >
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
