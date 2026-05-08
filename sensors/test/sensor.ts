// ── TEST Sensor — History chart with backdated timestamps, hover tooltips ──

const chartCanvas = document.getElementById('test-chart') as HTMLCanvasElement;
const ctx = chartCanvas.getContext('2d')!;
const valueEl = document.getElementById('test-value') as HTMLElement;
const lastSeenEl = document.getElementById('TEST-last-seen') as HTMLElement;
const dotEl = document.getElementById('test-dot') as HTMLElement;

let lastDataTime: Date | null = null;
let lastDataKey: string | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;

// ── Stored chart data for hit-testing ──
let chartPoints: { x: number; y: number; time: string; value: number }[] = [];
let chartLayout: { padding: typeof padding; w: number; h: number; minVal: number; maxVal: number } | null = null;

const padding = { top: 8, right: 8, bottom: 18, left: 30 };

// ── Canvas sizing ──
function resizeCanvas() {
  const rect = chartCanvas.parentElement!.getBoundingClientRect();
  chartCanvas.width = rect.width * window.devicePixelRatio;
  chartCanvas.height = 140 * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  chartCanvas.style.width = rect.width + 'px';
  chartCanvas.style.height = '140px';
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ── Draw chart ──
function drawChart(values: { time: string; value: number }[]) {
  const w = chartCanvas.width / window.devicePixelRatio;
  const h = chartCanvas.height / window.devicePixelRatio;

  ctx.clearRect(0, 0, w, h);

  if (values.length === 0) {
    chartPoints = [];
    chartLayout = null;
    ctx.fillStyle = '#888888';
    ctx.font = '0.4rem "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('NO DATA', w / 2, h / 2);
    return;
  }

  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  const nums = values.map(v => v.value);
  let minVal = Math.min(...nums);
  let maxVal = Math.max(...nums);
  if (minVal === maxVal) { minVal -= 1; maxVal += 1; }

  chartLayout = { padding, w, h, minVal, maxVal };

  // Grid lines
  ctx.strokeStyle = '#1e1e1e';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(w - padding.right, y);
    ctx.stroke();
  }

  // Compute pixel positions for each data point
  chartPoints = values.map((v, i) => {
    const x = padding.left + (i / (values.length - 1)) * plotW;
    const y = padding.top + plotH - ((v.value - minVal) / (maxVal - minVal)) * plotH;
    return { x, y, time: v.time, value: v.value };
  });

  // Line connecting all data points
  ctx.strokeStyle = '#f0a500';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < chartPoints.length; i++) {
    if (i === 0) ctx.moveTo(chartPoints[i].x, chartPoints[i].y);
    else ctx.lineTo(chartPoints[i].x, chartPoints[i].y);
  }
  ctx.stroke();

  // Fill area under line
  ctx.fillStyle = 'rgba(240, 165, 0, 0.08)';
  ctx.beginPath();
  ctx.moveTo(chartPoints[0].x, chartPoints[0].y);
  for (let i = 1; i < chartPoints.length; i++) {
    ctx.lineTo(chartPoints[i].x, chartPoints[i].y);
  }
  ctx.lineTo(chartPoints[chartPoints.length - 1].x, padding.top + plotH);
  ctx.lineTo(chartPoints[0].x, padding.top + plotH);
  ctx.closePath();
  ctx.fill();

  // Dot markers on each data point
  ctx.fillStyle = '#f0a500';
  for (const pt of chartPoints) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Y-axis labels
  ctx.fillStyle = '#888888';
  ctx.font = '0.35rem "Press Start 2P", monospace';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (plotH / 4) * i;
    const val = maxVal - (i / 4) * (maxVal - minVal);
    ctx.fillText(val.toFixed(0), padding.left - 4, y + 3);
  }

  // X-axis: show first and last time
  if (values.length > 1) {
    ctx.textAlign = 'left';
    const firstTime = new Date(values[0].time);
    const lastTime = new Date(values[values.length - 1].time);
    ctx.fillText(formatTime(firstTime), padding.left, h - 2);
    ctx.textAlign = 'right';
    ctx.fillText(formatTime(lastTime), w - padding.right, h - 2);
  }
}

function formatTime(d: Date): string {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatDateTime(d: Date): string {
  const yyyy = d.getFullYear().toString();
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  const h = d.getHours().toString().padStart(2, '0');
  const min = d.getMinutes().toString().padStart(2, '0');
  const sec = d.getSeconds().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${h}:${min}:${sec}`;
}

// ── Tooltip ──
let tooltipEl: HTMLElement | null = null;

function ensureTooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'test__tooltip';
    const card = chartCanvas.closest('.sensor-card--TEST') as HTMLElement;
    if (card) card.appendChild(tooltipEl);
  }
  return tooltipEl;
}

function showTooltip(pt: { x: number; y: number; time: string; value: number }) {
  const tip = ensureTooltip();
  const d = new Date(pt.time);
  tip.innerHTML = `<span class="test__tooltip-time">${formatDateTime(d)}</span><span class="test__tooltip-value">${pt.value}</span>`;
  tip.classList.add('test__tooltip--visible');

  // Position relative to the card
  const card = chartCanvas.closest('.sensor-card--TEST') as HTMLElement;
  const canvasRect = chartCanvas.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();

  const left = canvasRect.left - cardRect.left + pt.x;
  const top = canvasRect.top - cardRect.top + pt.y;

  tip.style.left = left + 'px';
  tip.style.top = (top - 6) + 'px';
  tip.style.transform = 'translate(-50%, -100%)';
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.classList.remove('test__tooltip--visible');
}

// ── Mouse hover ──
chartCanvas.addEventListener('mousemove', (e) => {
  if (chartPoints.length === 0) { hideTooltip(); return; }

  const rect = chartCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  let closest: typeof chartPoints[0] | null = null;
  let closestDist = Infinity;

  for (const pt of chartPoints) {
    const dist = Math.sqrt((pt.x - mx) ** 2 + (pt.y - my) ** 2);
    if (dist < closestDist) {
      closestDist = dist;
      closest = pt;
    }
  }

  if (closest && closestDist < 20) {
    showTooltip(closest);
  } else {
    hideTooltip();
  }
});

chartCanvas.addEventListener('mouseleave', hideTooltip);

// ── Last-seen indicator ──
function updateLastSeen() {
  if (!lastDataTime) {
    lastSeenEl.textContent = '--';
    dotEl.classList.remove('test__dot--live');
    return;
  }
  const diffSec = Math.floor((Date.now() - lastDataTime.getTime()) / 1000);
  if (diffSec < 60) lastSeenEl.textContent = `${diffSec}s ago`;
  else if (diffSec < 3600) lastSeenEl.textContent = `${Math.floor(diffSec / 60)}m ago`;
  else lastSeenEl.textContent = `${Math.floor(diffSec / 3600)}h ago`;

  dotEl.classList.add('test__dot--live');
}

tickInterval = setInterval(updateLastSeen, 1000);

// ── Poll data ──
let pollId: number;

(window as any).pisense.onMount(() => {
  pollId = (window as any).pisense.poll(3000, async () => {
    try {
      const res = await (window as any).pisense.history('test', 'value', '-1h');
      if (res && res.values && res.values.length > 0) {
        const sorted = res.values
          .filter((v: any) => v.time && v.value !== undefined)
          .sort((a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime());

        drawChart(sorted);

        const latest = sorted[sorted.length - 1];
        valueEl.textContent = latest.value.toFixed(1);

        // Detect genuinely new data
        const key = `${latest.value}|${latest.time}`;
        if (key !== lastDataKey) {
          lastDataKey = key;
          lastDataTime = new Date();
        }
        updateLastSeen();
      } else {
        drawChart([]);
        valueEl.textContent = '--';
      }
    } catch {
      drawChart([]);
      valueEl.textContent = '--';
    }
  });
});

(window as any).pisense.onUnmount(() => {
  if (pollId !== undefined) (window as any).pisense.stopPoll(pollId);
  if (tickInterval) clearInterval(tickInterval);
  if (tooltipEl) tooltipEl.remove();
  tooltipEl = null;
});
