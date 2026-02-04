"use client";

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div className="confirmOverlay" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onCancel();
    }}>
      <div className="confirm" role="dialog" aria-modal="true" aria-label={title}>
        <div className="confirmTitle">{title}</div>
        <div className="confirmMsg">{message}</div>

        <div className="confirmBtns">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className={`btn ${danger ? "danger" : ""}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
