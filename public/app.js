// ── Cycling Prompts ──
const prompts = [
  'Add a temperature gauge on topic sensors/room/temp',
  'Show humidity as a bar chart, alerts above 70%',
  'Monitor CPU load with a line graph',
  'Track pressure in kPa, refresh every 3s',
  'Create a motion detector, red when active',
];

const promptEl = document.getElementById('cycling-prompt');
let promptIndex = 0;
let charIndex = 0;

function typePrompt() {
  const current = prompts[promptIndex];

  charIndex++;
  const visible = current.slice(0, charIndex);
  promptEl.innerHTML =
    '<span class="prompt-arrow">&gt; </span>' + visible + '<span class="prompt-cursor">█</span>';

  if (charIndex < current.length) {
    setTimeout(typePrompt, 40 + Math.random() * 40);
  } else {
    // Finished typing — pause, then fade out
    setTimeout(function() {
      promptEl.style.opacity = '0';
      setTimeout(function() {
        promptIndex = (promptIndex + 1) % prompts.length;
        charIndex = 0;
        promptEl.style.opacity = '1';
        typePrompt();
      }, 400);
    }, 2500);
  }
}

typePrompt();

// ── Empty State Toggle ──
const emptyState = document.getElementById('empty-state');
const sensorGrid = document.getElementById('sensor-grid');

function updateEmptyState() {
  if (sensorGrid.children.length === 0) {
    emptyState.classList.remove('empty-state--hidden');
  } else {
    emptyState.classList.add('empty-state--hidden');
  }
}

// ── Status Indicators ──
const statusInflux = document.getElementById('status-influx');
const statusMqtt = document.getElementById('status-mqtt');

function updateStatus(influxdb, mqtt) {
  statusInflux.className = 'status__indicator' + (influxdb === 'ok' ? ' status__indicator--ok' : '');
  statusMqtt.className = 'status__indicator' + (mqtt === 'ok' ? ' status__indicator--ok' : '');
}

// ── Remove Confirmation Modal ──
const modal = document.getElementById('confirm-modal');
const modalText = document.getElementById('modal-text');
const modalConfirm = document.getElementById('modal-confirm');
const modalCancel = document.getElementById('modal-cancel');

let pendingRemoveName = null;

function showRemoveModal(name) {
  pendingRemoveName = name;
  modalText.textContent = 'Remove sensor "' + name + '"?';
  modal.classList.add('modal--visible');
}

function hideModal() {
  pendingRemoveName = null;
  modal.classList.remove('modal--visible');
}

modalCancel.addEventListener('click', hideModal);

modalConfirm.addEventListener('click', function() {
  if (!pendingRemoveName) return;
  var name = pendingRemoveName;
  hideModal();

  fetch('/api/sensors/' + name, { method: 'DELETE' })
    .then(function(res) {
      if (!res.ok) throw new Error('Delete failed');
      unmountSensor(name);
    })
    .catch(function(err) { console.error('Failed to remove sensor:', err); });
});

// ── Sensor Loading ──
var loadedSensors = new Map();
var unmountCallbacks = new Map();

function loadSensor(name) {
  return Promise.all([
    fetch('/api/sensors/' + name + '/car.html'),
    fetch('/api/sensors/' + name + '/car.css'),
    fetch('/api/sensors/' + name + '/car.ts'),
  ]).then(function(responses) {
    if (!responses[0].ok || !responses[1].ok || !responses[2].ok) {
      console.error('Failed to load sensor: ' + name);
      return;
    }
    return Promise.all([responses[0].text(), responses[1].text(), responses[2].text()]);
  }).then(function(results) {
    if (!results) return;
    var html = results[0];
    var css = results[1];
    var ts = results[2];

    // Container
    var container = document.createElement('div');
    container.className = 'sensor-card sensor-card--' + name;
    container.innerHTML = html;

    // Remove button
    var removeBtn = document.createElement('button');
    removeBtn.className = 'sensor-card__remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', function() { showRemoveModal(name); });
    container.appendChild(removeBtn);

    // Scoped CSS
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    // Mount
    sensorGrid.appendChild(container);

    // Execute sensor script
    var script = document.createElement('script');
    script.textContent = ts;
    document.body.appendChild(script);

    loadedSensors.set(name, { container: container, style: style });
    updateEmptyState();
  });
}

function unmountSensor(name) {
  var entry = loadedSensors.get(name);
  if (!entry) return;

  // Run onUnmount callbacks
  var callbacks = unmountCallbacks.get(name);
  if (callbacks) {
    callbacks.forEach(function(fn) { fn(); });
    unmountCallbacks.delete(name);
  }

  entry.container.remove();
  entry.style.remove();
  loadedSensors.delete(name);
  updateEmptyState();
}

// ── pisense API ──
var mountCallbacks = new Map();
var pollCounter = 0;
var activePolls = new Map();

window.pisense = {
  query: function(flux) {
    return fetch('/api/query?flux=' + encodeURIComponent(flux)).then(function(r) { return r.json(); });
  },

  latest: function(measurement, field, tag) {
    var params = new URLSearchParams({ measurement: measurement, field: field });
    if (tag) params.set('tag', tag);
    return fetch('/api/latest?' + params).then(function(r) { return r.json(); });
  },

  history: function(measurement, field, range, tag) {
    var params = new URLSearchParams({ measurement: measurement, field: field, range: range });
    if (tag) params.set('tag', tag);
    return fetch('/api/history?' + params).then(function(r) { return r.json(); });
  },

  poll: function(intervalMs, callback) {
    var id = ++pollCounter;
    activePolls.set(id, setInterval(callback, intervalMs));
    return id;
  },

  stopPoll: function(id) {
    var handle = activePolls.get(id);
    if (handle) {
      clearInterval(handle);
      activePolls.delete(id);
    }
  },

  onMount: function(callback) {
    var lastName = Array.from(loadedSensors.keys()).pop();
    if (lastName) {
      if (!mountCallbacks.has(lastName)) mountCallbacks.set(lastName, []);
      mountCallbacks.get(lastName).push(callback);
    }
    callback();
  },

  onUnmount: function(callback) {
    var lastName = Array.from(loadedSensors.keys()).pop();
    if (lastName) {
      if (!unmountCallbacks.has(lastName)) unmountCallbacks.set(lastName, []);
      unmountCallbacks.get(lastName).push(callback);
    }
  },
};

// ── Initial Load ──
function init() {
  fetch('/api/sensors')
    .then(function(res) {
      if (!res.ok) return [];
      return res.json();
    })
    .then(function(sensors) {
      var chain = Promise.resolve();
      sensors.forEach(function(name) {
        chain = chain.then(function() { return loadSensor(name); });
      });
    })
    .catch(function() {});

  // Status check
  fetch('/api/status')
    .then(function(res) {
      if (res.ok) return res.json();
      throw new Error();
    })
    .then(function(status) {
      updateStatus(status.influxdb, status.mqtt);
    })
    .catch(function() {
      updateStatus('down', 'down');
    });
}

init();

// ── WebSocket ──
var ws = null;

function connectWS() {
  var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(protocol + '//' + location.host + '/ws');

  ws.addEventListener('message', function(event) {
    var msg = JSON.parse(event.data);

    if (msg.type === 'sensor-added') {
      loadSensor(msg.name);
    } else if (msg.type === 'sensor-removed') {
      unmountSensor(msg.name);
    } else if (msg.type === 'sensor-updated') {
      unmountSensor(msg.name);
      loadSensor(msg.name);
    } else if (msg.type === 'status') {
      updateStatus(msg.influxdb, msg.mqtt);
    }
  });

  ws.addEventListener('close', function() {
    setTimeout(connectWS, 3000);
  });
}

connectWS();
