export function renderChart(
  canvas: HTMLCanvasElement,
  data: { timestamps: number[]; prices: number[] },
  opts?: { color?: string; showGrid?: boolean },
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const { timestamps, prices } = data;

  if (prices.length < 2) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data available', w / 2, h / 2);
    return;
  }

  const isUp = prices[prices.length - 1] >= prices[0];
  const lineColor = opts?.color ?? (isUp ? '#22c55e' : '#ef4444');
  const showGrid = opts?.showGrid !== false;

  const padding = { top: 12, right: 8, bottom: 24, left: 48 };
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || 1;
  const yPad = range * 0.08;
  const yMin = minPrice - yPad;
  const yMax = maxPrice + yPad;
  const yRange = yMax - yMin;

  const toX = (i: number) => padding.left + (i / (prices.length - 1)) * plotW;
  const toY = (p: number) => padding.top + (1 - (p - yMin) / yRange) * plotH;

  // Grid lines
  if (showGrid) {
    const gridLines = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + (i / gridLines) * plotH;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();

      const price = yMax - (i / gridLines) * yRange;
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(price.toFixed(2), padding.left - 6, y + 3);
    }
  }

  // X-axis labels
  const labelCount = Math.min(5, timestamps.length);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < labelCount; i++) {
    const idx = Math.floor((i / (labelCount - 1)) * (timestamps.length - 1));
    const x = toX(idx);
    const date = new Date(timestamps[idx] * 1000);
    const span = timestamps[timestamps.length - 1] - timestamps[0];
    let label: string;
    if (span < 86400 * 2) {
      label = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } else if (span < 86400 * 90) {
      label = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } else {
      label = date.toLocaleDateString([], { month: 'short', year: '2-digit' });
    }
    ctx.fillText(label, x, h - 4);
  }

  // Line path
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(prices[0]));
  for (let i = 1; i < prices.length; i++) {
    ctx.lineTo(toX(i), toY(prices[i]));
  }
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, padding.top, 0, h - padding.bottom);
  gradient.addColorStop(0, lineColor + '30');
  gradient.addColorStop(1, lineColor + '00');

  ctx.lineTo(toX(prices.length - 1), h - padding.bottom);
  ctx.lineTo(toX(0), h - padding.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
}
