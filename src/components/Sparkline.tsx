export function Sparkline({ buckets }: { buckets: number[] }) {
  const w = 96;
  const h = 18;
  const bw = w / buckets.length;
  return (
    <svg className="sparkline" width={w} height={h} aria-hidden="true">
      {buckets.map((v, i) => {
        const bh = Math.max(1.5, v * h);
        return (
          <rect
            key={i}
            x={i * bw + 1}
            y={h - bh}
            width={bw - 2}
            height={bh}
            rx={1}
            className={v > 0.02 ? "spark-on" : "spark-off"}
          />
        );
      })}
    </svg>
  );
}
