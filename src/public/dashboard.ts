// ── Dashboard UI (header buttons, search, settings, notifications, config) ──

const searchToggle = document.getElementById('search-toggle') as HTMLButtonElement;
const searchBar = document.getElementById('search-bar') as HTMLElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const themeToggle = document.getElementById('theme-toggle') as HTMLButtonElement;
const settingsToggle = document.getElementById('settings-toggle') as HTMLButtonElement;
const settingsPanel = document.getElementById('settings-panel') as HTMLElement;
const notifyBadge = document.getElementById('notify-badge') as HTMLElement;
const notifyPanel = document.getElementById('notify-panel') as HTMLElement;
const notifyContent = document.getElementById('notify-content') as HTMLElement;
const badgeCount = document.getElementById('badge-count') as HTMLElement;

let searchVisible = false;
let settingsVisible = false;
let notifyVisible = false;
let unreadAlerts = 0;

// ── Search ──
export function initSearch(sensorGrid: HTMLElement) {
  searchToggle?.addEventListener('click', () => {
    searchVisible = !searchVisible;
    if (searchVisible) {
      searchBar.classList.remove('search-bar--hidden');
      searchInput.focus();
      searchToggle.classList.add('header__icon-btn--active');
    } else {
      searchBar.classList.add('search-bar--hidden');
      searchToggle.classList.remove('header__icon-btn--active');
      searchInput.value = '';
      filterSensors('', sensorGrid);
    }
  });

  searchInput?.addEventListener('input', () => {
    filterSensors(searchInput.value.toLowerCase(), sensorGrid);
  });
}

function filterSensors(query: string, sensorGrid: HTMLElement) {
  for (const card of sensorGrid.children) {
    const el = card as HTMLElement;
    const name = (el.dataset.sensor || el.className || '').toLowerCase();
    el.style.display = !query || name.includes(query) ? '' : 'none';
  }
}

// ── Theme ──
export function initTheme() {
  themeToggle?.addEventListener('click', async () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try {
      const config = await (window as any).pisense.store.get('dashboard-config');
      await (window as any).pisense.store.set('dashboard-config', { ...(config && !config.error ? config : {}), theme: next });
    } catch { /* ignore */ }
  });
}

// ── Settings ──
export function initSettings() {
  settingsToggle?.addEventListener('click', () => {
    settingsVisible = !settingsVisible;
    if (settingsVisible) {
      settingsPanel.classList.remove('settings-panel--hidden');
      settingsPanel.classList.add('settings-panel--visible');
      settingsToggle.classList.add('header__icon-btn--active');
      // Close notify if open
      notifyPanel.classList.remove('notify-panel--visible');
      notifyPanel.classList.add('notify-panel--hidden');
      notifyVisible = false;
    } else {
      settingsPanel.classList.remove('settings-panel--visible');
      settingsPanel.classList.add('settings-panel--hidden');
      settingsToggle.classList.remove('header__icon-btn--active');
    }
  });
}

// ── Notifications ──
export function initNotifications() {
  notifyBadge?.addEventListener('click', () => {
    notifyVisible = !notifyVisible;
    if (notifyVisible) {
      notifyPanel.classList.remove('notify-panel--hidden');
      notifyPanel.classList.add('notify-panel--visible');
      unreadAlerts = 0;
      badgeCount.classList.remove('badge-count--visible');
    } else {
      notifyPanel.classList.remove('notify-panel--visible');
      notifyPanel.classList.add('notify-panel--hidden');
    }
  });
}

export function pushNotification(msg: any) {
  const item = document.createElement('div');
  item.className = 'notify-item';
  item.innerHTML = `<div class="notify-item__name">${msg.rule?.name || 'Alert'}</div>` +
    `<div class="notify-item__detail">${msg.rule?.measurement}.${msg.rule?.field} ${msg.rule?.condition} ${msg.rule?.threshold} → <strong>${msg.value}</strong></div>` +
    `<div class="notify-item__time">${msg.time ? new Date(msg.time).toLocaleString() : ''}</div>`;
  notifyContent.prepend(item);
  unreadAlerts++;
  badgeCount.textContent = String(unreadAlerts);
  badgeCount.classList.add('badge-count--visible');
}

// ── Dashboard config loading from store ──
export async function loadDashboardConfig() {
  try {
    const config = await (window as any).pisense.store.get('dashboard-config');
    if (!config || typeof config !== 'object' || config.error) return;

    if (config.theme) document.documentElement.setAttribute('data-theme', config.theme);

    if (config.sidebar) {
      const sidebar = document.getElementById('sidebar');
      const sidebarNav = document.getElementById('sidebar-nav');
      if (sidebar && sidebarNav && config.sidebar.items) {
        sidebarNav.innerHTML = '';
        for (const item of config.sidebar.items) {
          const el = document.createElement('div');
          el.className = 'sidebar__item';
          el.textContent = item.label || item;
          if (item.id) el.dataset.view = item.id;
          sidebarNav.appendChild(el);
        }
        sidebar.classList.add('sidebar--visible');
        sidebar.classList.add(config.sidebar.position === 'right' ? 'sidebar--right' : 'sidebar--left');
      }
    }

    if (config.tabs && Array.isArray(config.tabs) && config.tabs.length > 0) {
      const tabBar = document.getElementById('tab-bar');
      const tabBarTabs = document.getElementById('tab-bar-tabs');
      if (tabBar && tabBarTabs) {
        tabBarTabs.innerHTML = '';
        for (let i = 0; i < config.tabs.length; i++) {
          const tab = config.tabs[i];
          const btn = document.createElement('button');
          btn.className = 'tab-bar__tab' + (i === 0 ? ' tab-bar__tab--active' : '');
          btn.textContent = typeof tab === 'string' ? tab : tab.label;
          btn.dataset.view = typeof tab === 'string' ? tab : tab.id || tab.label;
          tabBarTabs.appendChild(btn);
        }
        tabBar.classList.remove('tab-bar--hidden');
      }
    }
  } catch { /* store not ready */ }
}
