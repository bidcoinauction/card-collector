"use client";

import { useEffect } from "react";

export type DrawerTab = "details" | "history" | "ebay";

export default function Drawer({
  open,
  title,
  subtitle,
  tab,
  onTab,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  tab: DrawerTab;
  onTab: (t: DrawerTab) => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    // Scroll lock without layout jump
    if (!open) return;
    const doc = document.documentElement;
    const sbw = window.innerWidth - doc.clientWidth;
    doc.style.setProperty("--sbw", `${sbw}px`);
    doc.classList.add("drawerOpen");
    return () => {
      doc.classList.remove("drawerOpen");
      doc.style.removeProperty("--sbw");
    };
  }, [open]);

  return (
    <div className={`drawerOverlay ${open ? "open" : ""}`} onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <aside className={`drawer ${open ? "open" : ""}`} role="dialog" aria-modal="true">
        <header className="drawerTop">
          <div className="drawerTitleBlock">
            <div className="drawerTitle">{title}</div>
            {subtitle ? <div className="drawerSub">{subtitle}</div> : null}
          </div>

          <button className="iconBtn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <nav className="drawerTabs" aria-label="Drawer tabs">
          <button className={`tabBtn ${tab === "details" ? "on" : ""}`} onClick={() => onTab("details")}>Details</button>
          <button className={`tabBtn ${tab === "history" ? "on" : ""}`} onClick={() => onTab("history")}>Value History</button>
          <button className={`tabBtn ${tab === "ebay" ? "on" : ""}`} onClick={() => onTab("ebay")}>eBay Prices</button>
        </nav>

        <div className="drawerBody">
          {children}
        </div>
      </aside>
    </div>
  );
}
