"use client";

import Image from "next/image";
import { CardComputed } from "@/lib/types";

function fmtMoney(n: number | null, opts?: { zeroIsMissing?: boolean }) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (opts?.zeroIsMissing && n === 0) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default function CardListRow({
  card,
  checked,
  onCheck,
  onOpen,
  tagOverride,
  conditionOverride,
  priority = false,
}: {
  card: CardComputed & { tag?: string; condition?: string };
  checked: boolean;
  onCheck: (on: boolean) => void;
  onOpen: () => void;
  tagOverride?: string;
  conditionOverride?: string;
  priority?: boolean;
}) {
  const img = card.images?.[0] || "";
  const delta = card.delta;
  const deltaClass = delta == null ? "" : delta >= 0 ? "up" : "down";

  const tag = tagOverride ?? card.league;
  const condition = conditionOverride ?? "raw";

  const displayMarket = card.marketAvg === 0 ? null : card.marketAvg;
  const displayDelta = delta == null || !Number.isFinite(delta) || delta === 0 ? null : delta;

  return (
    <div
      className="listRow"
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest("button") || t.closest("input") || t.closest("a")) return;
        onOpen();
      }}
    >
      <div className="listCell checkCell" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
          aria-label="Select card"
        />
      </div>

      <div className="listCell thumbCell">
        {img ? (
          <div
            className="thumb"
            style={{
              position: "relative",
              width: 44,
              height: 62,
              borderRadius: 8,
              overflow: "hidden",
              background: "rgba(0,0,0,0.04)",
            }}
          >
            <Image
              src={img}
              alt=""
              fill
              priority={priority}
              sizes="44px"
              style={{ objectFit: "cover" }}
            />
          </div>
        ) : (
          <div className="thumb ph">—</div>
        )}
      </div>

      <div className="listCell mainCell">
        <div className="listTitle">{card.title}</div>
        <div className="listSub">
          {card.player} • {card.season} • {card.set}
        </div>
      </div>

      <div className="listCell tagCell">
        <span className="listTag">{tag || "—"}</span>
      </div>

      <div className="listCell condCell">
        <span className="muted">{condition}</span>
      </div>

      <div className="listCell valueCell">
        <div className="valueMain">{fmtMoney(displayMarket, { zeroIsMissing: true })}</div>
        <div className={`valueDelta ${deltaClass}`}>
          {displayDelta == null
            ? "—"
            : displayDelta >= 0
              ? `▲ ${fmtMoney(Math.abs(displayDelta))}`
              : `▼ ${fmtMoney(Math.abs(displayDelta))}`}
        </div>
      </div>

      <div className="listCell actionsCell" onClick={(e) => e.stopPropagation()}>
        <button className="link">Edit</button>
        <button className="link danger">Delete</button>
      </div>
    </div>
  );
}
