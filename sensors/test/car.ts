const valueEl = document.querySelector('.test__value') as HTMLElement;
const needleEl = document.querySelector('.test__needle') as HTMLElement;
const arcFillEl = document.querySelector('.test__arc-fill') as HTMLElement;
const card = document.querySelector('.sensor-card--test') as HTMLElement;
let hasData = false;

const MIN = 0;
const MAX = 100;
const ARC_LENGTH = 157; // approximate semicircle arc length for r=50
const MIN_ANGLE = -90;
const MAX_ANGLE = 90;

function mapToRange(value: number): number {
  const clamped = Math.min(MAX, Math.max(MIN, value));
  return (clamped - MIN) / (MAX - MIN);
}

async function update() {
  try {
    const data = await pisense.latest('test', 'value');
    if (data && data.value !== undefined) {
      const ratio = mapToRange(data.value);
      const angle = MIN_ANGLE + ratio * (MAX_ANGLE - MIN_ANGLE);
      const offset = ARC_LENGTH - ratio * ARC_LENGTH;

      valueEl.textContent = data.value.toFixed(1);
      needleEl.style.transform = `rotate(${angle}deg)`;
      arcFillEl.style.strokeDashoffset = `${offset}`;

      if (!hasData) {
        hasData = true;
        card.classList.add('sensor-card--test--live');
      }
    }
  } catch {
    // InfluxDB may be temporarily unreachable
  }
}

let pollId: number | null = null;

pisense.onMount(() => {
  update();
  pollId = pisense.poll(3000, update);
});

pisense.onUnmount(() => {
  if (pollId !== null) {
    pisense.stopPoll(pollId);
    pollId = null;
  }
});
