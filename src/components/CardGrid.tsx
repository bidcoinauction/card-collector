"use client";

import CardCard from "./CardCard";
import CardListRow from "./CardListRow";
import SkeletonCard from "./SkeletonCard";
import { CardComputed } from "@/lib/types";

export default function CardGrid({
  loading,
  items,
  page,
  totalPages,
  onPage,
  selected,
  onSelect,
  onOpen,
  compact,
  viewMode,
  historyFor,
  overrides,
}: {
  loading: boolean;
  items: (CardComputed & { tag?: string; condition?: string })[];
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  selected: Record<string, boolean>;
  onSelect: (id: string, on: boolean) => void;
  onOpen: (id: string) => void;
  compact: boolean;
  viewMode: "grid" | "list";
  historyFor: (id: string) => number[];
  overrides: Record<string, { tag?: string; condition?: string; marketAvg?: number }>;
}) {
  return (
    <section className="content">
      {viewMode === "grid" ? (
        <div className={`grid ${compact ? "compact" : ""}`}>
          {loading
            ? Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)
            : items.map((c, i) => (
                <CardCard
                  key={c.id}
                  card={c}
                  checked={!!selected[c.id]}
                  onCheck={(on) => onSelect(c.id, on)}
                  onOpen={() => onOpen(c.id)}
                  compact={compact}
                  history={historyFor(c.id)}
                  priority={i < 8} // above-the-fold only
                />
              ))}
        </div>
      ) : (
        <div className="list">
          <div className="listHeader">
            <div />
            <div>Card</div>
            <div>Title</div>
            <div>Tag</div>
            <div>Cond</div>
            <div>Value</div>
            <div />
          </div>

          {loading ? (
            <div className="listLoading">Loading…</div>
          ) : (
            items.map((c, i) => (
              <CardListRow
                key={c.id}
                card={c}
                checked={!!selected[c.id]}
                onCheck={(on) => onSelect(c.id, on)}
                onOpen={() => onOpen(c.id)}
                tagOverride={overrides[c.id]?.tag}
                conditionOverride={overrides[c.id]?.condition}
                priority={i < 12}
              />
            ))
          )}
        </div>
      )}

      <div className="pagerRow">
        <button className="btn ghost" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}>
          Prev
        </button>
        <div className="pagerText">
          Page {page} / {totalPages}
        </div>
        <button className="btn ghost" onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>
          Next
        </button>
      </div>
    </section>
  );
}
