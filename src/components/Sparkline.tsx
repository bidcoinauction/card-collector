"use client";

export default function Sparkline({ values }: { values: number[] }) {
  const w = 120, h = 28, pad = 2;
  if (!values.length) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1e-6, max - min);

  const pts = values.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (values.length - 1);
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
