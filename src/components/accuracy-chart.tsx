"use client";

import { useRef, useState } from "react";

export type AccuracyPoint = { label: string; accuracy: number | null; answered: number };

// One series (accuracy %, 0-100) over 8 weeks: a 2px navy line with ringed dots, recessive
// gridlines, the latest value labelled at the end, a crosshair tooltip on hover/focus (arrow keys
// move it), and a table view so nothing depends on hovering.

const W = 340;
const H = 180;
const PAD = { left: 36, right: 40, top: 12, bottom: 28 };
const NAVY = "#25308A";
const GRID = "rgba(37, 48, 138, 0.14)";
const INK = "#1b2468";

export function AccuracyChart({ points, title }: { points: AccuracyPoint[]; title: string }) {
  const [active, setActive] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left + (points.length === 1 ? plotW / 2 : (i * plotW) / (points.length - 1));
  const y = (v: number) => PAD.top + plotH - (v / 100) * plotH;

  // Weeks without practice break the line rather than dropping to zero.
  const segments: string[] = [];
  let current = "";
  points.forEach((p, i) => {
    if (p.accuracy === null) {
      if (current) segments.push(current);
      current = "";
    } else {
      current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(p.accuracy).toFixed(1)}`;
    }
  });
  if (current) segments.push(current);

  const lastIndex = points.findLastIndex((p) => p.accuracy !== null);
  const hasData = lastIndex >= 0;

  function nearest(clientX: number) {
    const svg = ref.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    points.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    });
    setActive(best);
  }

  // The readout shows the hovered/focused week, or the latest week when nothing is selected.
  const shown = points[active ?? Math.max(lastIndex, 0)]!;

  return (
    <figure className="m-0">
      <figcaption className="font-semibold text-navy-dark">{title}</figcaption>
      {!hasData ? (
        <p className="mt-2 text-navy-dark/70">The chart fills in once practice starts.</p>
      ) : (
        <div className="mt-2">
          {/* Readout strip: a fixed slot above the plot, so it never covers a point or overflows. */}
          <p className="flex h-6 items-baseline gap-2 text-sm" aria-live="polite">
            <span className="text-base font-bold text-navy-dark">
              {shown.accuracy === null ? "No practice" : `${shown.accuracy}% correct`}
            </span>
            <span className="text-navy-dark/70">
              {active === null ? "latest week" : `week of ${shown.label}`} · {shown.answered}{" "}
              answered
            </span>
          </p>
          <svg
            ref={ref}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-navy"
            role="img"
            aria-label={`${title}. Latest: ${points[lastIndex]!.accuracy}% in the week of ${points[lastIndex]!.label}. Use the table below for every week.`}
            tabIndex={0}
            onPointerMove={(e) => nearest(e.clientX)}
            onPointerDown={(e) => nearest(e.clientX)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(lastIndex)}
            onBlur={() => setActive(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? lastIndex) - 1));
              if (e.key === "ArrowRight")
                setActive((a) => Math.min(points.length - 1, (a ?? lastIndex) + 1));
            }}
          >
            {[0, 50, 100].map((v) => (
              <g key={v}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(v)}
                  y2={y(v)}
                  stroke={GRID}
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 6}
                  y={y(v)}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={11}
                  fill={INK}
                  opacity={0.7}
                >
                  {v}%
                </text>
              </g>
            ))}
            {points.map((p, i) =>
              i % 2 === (points.length - 1) % 2 ? (
                <text
                  key={p.label}
                  x={x(i)}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize={11}
                  fill={INK}
                  opacity={0.7}
                >
                  {p.label}
                </text>
              ) : null,
            )}
            {active !== null && (
              <line
                x1={x(active)}
                x2={x(active)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke={INK}
                strokeOpacity={0.35}
                strokeWidth={1}
              />
            )}
            {segments.map((d) => (
              <path
                key={d}
                d={d}
                fill="none"
                stroke={NAVY}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {points.map((p, i) =>
              p.accuracy === null ? null : (
                <circle
                  key={p.label}
                  cx={x(i)}
                  cy={y(p.accuracy)}
                  r={active === i ? 5.5 : 4}
                  fill={NAVY}
                  stroke="#ffffff"
                  strokeWidth={2}
                />
              ),
            )}
            <text
              x={x(lastIndex) + 9}
              y={y(points[lastIndex]!.accuracy!)}
              dy="0.32em"
              fontSize={12}
              fontWeight={700}
              fill={INK}
            >
              {points[lastIndex]!.accuracy}%
            </text>
          </svg>
        </div>
      )}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-navy">Show as a table</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="text-navy-dark/70">
              <th className="py-1 font-semibold">Week of</th>
              <th className="py-1 text-right font-semibold">Answered</th>
              <th className="py-1 text-right font-semibold">Correct</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.label} className="border-t border-navy/10">
                <td className="py-1">{p.label}</td>
                <td className="py-1 text-right">{p.answered}</td>
                <td className="py-1 text-right">{p.accuracy === null ? "–" : `${p.accuracy}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
