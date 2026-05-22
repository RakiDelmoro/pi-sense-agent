import { mountCallbacks, unmountCallbacks, loadedSensors, activePolls, sensorPolls } from "./api";

const loadingSensors = new Set<string>();

export async function loadSensor(name: string, sensorGrid: HTMLElement, showRemoveModal: (name: string) => void) {
  if (loadedSensors.has(name) || loadingSensors.has(name)) return;
  loadingSensors.add(name);

  let container: HTMLElement;
  let style: HTMLElement;
  const listenerCleanups: (() => void)[] = [];
  const timerIds: number[] = [];

  try {
    const [htmlRes, cssRes, tsRes] = await Promise.all([
      fetch(`/api/sensors/${name}/sensor.html`),
      fetch(`/api/sensors/${name}/sensor.css`),
      fetch(`/api/sensors/${name}/sensor.ts`),
    ]);

    if (!htmlRes.ok || !cssRes.ok || !tsRes.ok) {
      console.error(`Failed to load sensor: ${name}`);
      loadingSensors.delete(name);
      return;
    }

    const html = await htmlRes.text();
    const css = await cssRes.text();
    const ts = await tsRes.text();

    container = document.createElement('div');
    container.className = `sensor-card sensor-card--${name}`;
    container.dataset.sensor = name;
    container.innerHTML = html;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'sensor-card__remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => showRemoveModal(name));
    container.appendChild(removeBtn);

    style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    sensorGrid.appendChild(container);
    loadedSensors.set(name, { container, style, listenerCleanups, timerIds });

    // Execute sensor script in isolated scope
    const wrapperPreamble =
      'var __psid = arguments[0];\n' +
      'window.__pisenseCurrentSensor__ = __psid;\n' +
      'var _origAE = window.addEventListener.bind(window);\n' +
      'var _origSI = window.setInterval.bind(window);\n' +
      'var _origST = window.setTimeout.bind(window);\n' +
      'window.addEventListener = function(type, fn, opts) {\n' +
      '  window.pisense.trackListener(__psid, type, fn, opts);\n' +
      '  _origAE(type, fn, opts);\n' +
      '};\n' +
      'window.setInterval = function(fn, ms) {\n' +
      '  var id = _origSI(fn, ms);\n' +
      '  window.pisense.trackTimer(__psid, id);\n' +
      '  return id;\n' +
      '};\n' +
      'window.setTimeout = function(fn, ms) {\n' +
      '  var id = _origST(fn, ms);\n' +
      '  window.pisense.trackTimer(__psid, id);\n' +
      '  return id;\n' +
      '};\n' +
      'try {\n';

    const wrapperPostamble =
      '} finally {\n' +
      '  delete window.__pisenseCurrentSensor__;\n' +
      '  window.addEventListener = _origAE;\n' +
      '  window.setInterval = _origSI;\n' +
      '  window.setTimeout = _origST;\n' +
      '}\n';

    const fullCode = wrapperPreamble + ts + wrapperPostamble;
    const sensorFn = new Function(fullCode);
    sensorFn(name);

    // ResizeObserver for canvas re-render
    const bodyEl = container.querySelector('[class*="__body"]') as HTMLElement | null;
    if (bodyEl) {
      const resizeObserver = new ResizeObserver(() => {
        window.dispatchEvent(new Event('resize'));
      });
      resizeObserver.observe(bodyEl);
      listenerCleanups.push(() => resizeObserver.disconnect());
    }
  } catch (err) {
    console.error(`[sensor] Error loading ${name}:`, err);
    if (container) container.remove();
    if (style) style.remove();
    loadedSensors.delete(name);
  } finally {
    loadingSensors.delete(name);
  }
}

export function unmountSensor(name: string) {
  const entry = loadedSensors.get(name);
  if (!entry) return;

  const callbacks = unmountCallbacks.get(name);
  if (callbacks) { callbacks.forEach(fn => fn()); unmountCallbacks.delete(name); }
  mountCallbacks.delete(name);

  const polls = sensorPolls.get(name);
  if (polls) {
    polls.forEach(id => {
      const handle = activePolls.get(id);
      if (handle) { clearInterval(handle); activePolls.delete(id); }
    });
    sensorPolls.delete(name);
  }

  entry.listenerCleanups.forEach(fn => fn());
  entry.timerIds.forEach(id => { clearInterval(id); clearTimeout(id); });

  entry.container.remove();
  entry.style.remove();
  loadedSensors.delete(name);
}
