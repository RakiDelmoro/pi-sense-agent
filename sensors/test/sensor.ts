const ARC_LENGTH = 376.99; // 3/4 of circumference (2 * PI * 80 * 0.75)

const fillEl = document.querySelector('.gauge__fill') as SVGCircleElement;
const valueEl = document.getElementById('gauge-value-TEST')!;

let min = 0;
let max = 100;
let currentValue = 0;

function setGaugeValue(value: number) {
  currentValue = Math.max(min, Math.min(max, value));
  const pct = (currentValue - min) / (max - min);
  const dashLen = pct * ARC_LENGTH;
  fillEl.setAttribute('stroke-dasharray', `${dashLen} 502.65`);
  valueEl.textContent = currentValue.toFixed(1);
}

// Initial load
(window as any).pisense.latest('test', 'value').then((data: any) => {
  if (data?.value !== undefined) {
    setGaugeValue(Number(data.value));
  }
});

// Poll every 3 seconds
const pollId = (window as any).pisense.poll(3000, () => {
  (window as any).pisense.latest('test', 'value').then((data: any) => {
    if (data?.value !== undefined) {
      setGaugeValue(Number(data.value));
    }
  });
});

(window as any).pisense.onUnmount(() => {
  (window as any).pisense.stopPoll(pollId);
});
