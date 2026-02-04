"use client";

export default function BulkBar({
  count,
  onExport,
  onClear,
  onBulkTag,
  onBulkCondition,
  onBulkValue,
  onBulkDelete,
}: {
  count: number;
  onExport: () => void;
  onClear: () => void;

  onBulkTag: (tag: string) => void;
  onBulkCondition: (cond: string) => void;
  onBulkValue: (value: number) => void;
  onBulkDelete: () => void;
}) {
  if (count <= 0) return null;

  return (
    <div className="bulkBar" role="region" aria-label="Bulk actions">
      <div className="bulkBarLeft">
        <div className="bulkBarPill">
          <b>{count}</b> selected
        </div>

        <button className="btn ghost sm" onClick={onExport}>Export</button>
        <button className="btn ghost sm" onClick={onClear}>Clear</button>
      </div>

      <div className="bulkBarRight">
        <button className="btn ghost sm" onClick={() => {
          const v = prompt("Set tag/category for selected cards:", "soccer");
          if (v && v.trim()) onBulkTag(v.trim());
        }}>
          Bulk Tag
        </button>

        <button className="btn ghost sm" onClick={() => {
          const v = prompt("Set condition for selected cards:", "raw");
          if (v && v.trim()) onBulkCondition(v.trim());
        }}>
          Bulk Condition
        </button>

        <button className="btn ghost sm" onClick={() => {
          const v = prompt("Set market value for selected cards (USD):", "25");
          if (!v) return;
          const n = Number(v);
          if (Number.isFinite(n)) onBulkValue(n);
        }}>
          Bulk Value
        </button>

        <button className="btn danger sm" onClick={onBulkDelete}>
          Delete Selected
        </button>
      </div>
    </div>
  );
}
