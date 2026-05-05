const ARC_LENGTH = 401.92; // 270° of 2πr = 2π*85 * (270/360)
const fillEl = document.querySelector('.gauge__fill') as SVGCircleElement;
const valueEl = document.getElementById('gauge-value-TEST') as HTMLElement;
const card = document.querySelector('.sensor-card--TEST') as HTMLElement;

const min = 0;
const max = 100;
let hasData = false;

function setGauge(value: number) {
  const clamped = Math.max(min, Math.min(max, value));
  const pct = (clamped - min) / (max - min);
  const dash = pct * ARC_LENGTH;
  fillEl.setAttribute('stroke-dasharray', `${dash} 535.89`);
  valueEl.textContent = clamped.toFixed(1);

  if (!hasData) {
    hasData = true;
    card.classList.add('sensor-card--TEST--live');
  }
}

// Initialize at zero
setGauge(0);

const pollId = (window as any).pisense.poll(3000, async () => {
  try {
    const res = await (window as any).pisense.latest('test', 'value');
    if (res.value !== undefined && res.value !== null) {
      setGauge(Number(res.value));
    }
  } catch {
    // Influx unreachable — keep last value
  }
});

(window as any).pisense.onUnmount(() => {
  (window as any).pisense.stopPoll(pollId);
});
