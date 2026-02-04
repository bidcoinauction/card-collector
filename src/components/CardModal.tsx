"use client";

import { useEffect } from "react";
import { CardComputed } from "@/lib/types";

export default function CardModal({
  card,
  onClose,
}: {
  card: CardComputed;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="backdrop open" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="modal" role="dialog" aria-modal="true">
        <header className="modalTop">
          <div>
            <div className="modalTitle">{card.title}</div>
            <div className="modalSub">
              {card.player} • {card.season} • {card.set}
            </div>
          </div>
          <div className="modalBtns">
            {card.lastSoldUrl ? (
              <a className="btn ghost sm" href={card.lastSoldUrl} target="_blank" rel="noreferrer">
                Last sold
              </a>
            ) : null}
            {card.images[0] ? (
              <a className="btn ghost sm" href={card.images[0]} target="_blank" rel="noreferrer">
                Open image
              </a>
            ) : null}
            <button className="btn sm" onClick={onClose}>Close</button>
          </div>
        </header>

        <div className="modalBody">
          <div className="modalImages">
            {card.images.slice(0,2).map((u) => (
              <a key={u} className="modalImgLink" href={u} target="_blank" rel="noreferrer">
                <img src={u} alt={card.title} loading="eager" decoding="async" />
              </a>
            ))}
            {!card.images.length ? <div className="modalPh">No images</div> : null}
          </div>

          <div className="modalMeta">
            <div className="kv"><div className="k">Player</div><div className="v">{card.player || "—"}</div></div>
            <div className="kv"><div className="k">Team</div><div className="v">{card.team || "—"}</div></div>
            <div className="kv"><div className="k">League</div><div className="v">{card.league || "—"}</div></div>
            <div className="kv"><div className="k">Set</div><div className="v">{card.set || "—"}</div></div>
            <div className="kv"><div className="k">Season</div><div className="v">{card.season || "—"}</div></div>
            <div className="kv"><div className="k">Features</div><div className="v">{card.features || "—"}</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}
