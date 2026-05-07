const API_BASE = window.KILL_SWITCH_API_BASE || "";

const els = {
  connectionPill: document.querySelector("#connectionPill"),
  loginBtn: document.querySelector("#loginBtn"),
  settingsDetails: document.querySelector("#settingsDetails"),
  saveSettingsBtn: document.querySelector("#saveSettingsBtn"),
  connectBtn: document.querySelector("#connectBtn"),
  manualKillBtn: document.querySelector("#manualKillBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  refreshBtn: document.querySelector("#refreshBtn"),
  requestToken: document.querySelector("#requestToken"),
  maxLoss: document.querySelector("#maxLoss"),
  pnlPollMs: document.querySelector("#pnlPollMs"),
  guardPollMs: document.querySelector("#guardPollMs"),
  totalPnl: document.querySelector("#totalPnl"),
  realisedPnl: document.querySelector("#realisedPnl"),
  unrealisedPnl: document.querySelector("#unrealisedPnl"),
  riskLimit: document.querySelector("#riskLimit"),
  riskLimitStatus: document.querySelector("#riskLimitStatus"),
  lastUpdated: document.querySelector("#lastUpdated"),
  killMetric: document.querySelector("#killMetric"),
  killState: document.querySelector("#killState"),
  killReason: document.querySelector("#killReason"),
  positionsBody: document.querySelector("#positionsBody"),
  ordersBody: document.querySelector("#ordersBody"),
  positionCount: document.querySelector("#positionCount"),
  orderCount: document.querySelector("#orderCount"),
  logList: document.querySelector("#logList"),
  toast: document.querySelector("#toast"),
};

const settingsFields = [els.maxLoss, els.pnlPollMs, els.guardPollMs];
let userEditingSettings = false;

const urlToken = new URLSearchParams(window.location.search).get("request_token");
if (urlToken) els.requestToken.value = urlToken;

els.loginBtn.addEventListener("click", openLogin);
els.saveSettingsBtn.addEventListener("click", saveSettings);
els.connectBtn.addEventListener("click", connect);
els.manualKillBtn.addEventListener("click", manualKill);
els.stopBtn.addEventListener("click", stopMonitoring);
els.refreshBtn.addEventListener("click", refresh);
settingsFields.forEach((field) => {
  field.addEventListener("input", () => {
    userEditingSettings = true;
  });
  field.addEventListener("change", () => {
    userEditingSettings = true;
  });
});

refresh();
setInterval(refresh, 2500);

async function openLogin() {
  if (els.loginBtn.dataset.mode === "logout") {
    await logout();
    return;
  }
  if (window.location.protocol === "file:") {
    toast("Open http://localhost:3000 to use Kite login. The file page cannot call the backend API.");
    return;
  }
  const data = await api("/api/login-url");
  window.location.href = data.loginUrl;
}

async function logout() {
  const confirmed = window.confirm("Logout from this app and stop monitoring?");
  if (!confirmed) return;
  await withBusy(els.loginBtn, async () => {
    const state = await api("/api/session/logout", { method: "POST" });
    els.requestToken.value = "";
    userEditingSettings = false;
    render(state, { forceSettings: true });
    toast("Logged out.");
  });
}

async function connect() {
  if (els.connectBtn.dataset.mode === "start") {
    await startMonitoring();
    return;
  }
  const requestToken = els.requestToken.value.trim();
  if (!requestToken) return toast("Paste the request_token from the Zerodha redirect URL.");
  await withBusy(els.connectBtn, async () => {
    const state = await api("/api/session", {
      method: "POST",
      body: {
        requestToken,
        ...settingsPayload(),
      },
    });
    userEditingSettings = false;
    render(state);
    toast("Connected. Monitoring is live.");
  });
}

async function startMonitoring() {
  await withBusy(els.connectBtn, async () => {
    const state = await api("/api/monitor/start", { method: "POST" });
    render(state);
    toast("Monitoring started.");
  });
}

async function saveSettings() {
  await withBusy(els.saveSettingsBtn, async () => {
    const state = await api("/api/settings", {
      method: "POST",
      body: settingsPayload(),
    });
    userEditingSettings = false;
    render(state, { forceSettings: true });
    toast("Settings saved.");
  });
}

async function manualKill() {
  const confirmed = window.confirm("Activate kill state now? This will cancel open orders and flatten allowed positions.");
  if (!confirmed) return;
  await withBusy(els.manualKillBtn, async () => {
    const state = await api("/api/kill/activate", {
      method: "POST",
      body: { reason: "Manual kill from dashboard" },
    });
    render(state);
    toast("Kill state activated.");
  });
}

async function stopMonitoring() {
  const confirmed = window.confirm("Stop monitoring? The guard will no longer cancel or flatten new exposure.");
  if (!confirmed) return;
  await withBusy(els.stopBtn, async () => {
    const state = await api("/api/monitor/stop", { method: "POST" });
    render(state);
    toast("Monitoring stopped.");
  });
}

async function refresh() {
  try {
    render(await api("/api/status"));
  } catch (error) {
    toast(error.message);
  }
}

function render(state, options = {}) {
  if (options.forceSettings || !userEditingSettings) {
    els.maxLoss.value = state.settings?.maxLoss || els.maxLoss.value;
    els.pnlPollMs.value = String(state.settings?.pnlPollMs || els.pnlPollMs.value);
    els.guardPollMs.value = String(state.settings?.guardPollMs || els.guardPollMs.value);
  }

  els.connectionPill.className = "status-pill";
  if (state.kill?.active) {
    els.connectionPill.textContent = "Kill Active";
    els.connectionPill.classList.add("kill");
  } else if (state.connected && state.monitoring) {
    els.connectionPill.textContent = "Live";
    els.connectionPill.classList.add("live");
  } else if (state.connected) {
    els.connectionPill.textContent = "Connected";
  } else {
    els.connectionPill.textContent = "Disconnected";
  }

  if (state.connected) {
    els.loginBtn.textContent = "Logout";
    els.loginBtn.dataset.mode = "logout";
    els.loginBtn.className = "logout-btn";
    if (!options.keepSettingsOpen) els.settingsDetails.open = false;
  } else {
    els.loginBtn.textContent = "Login with Kite";
    els.loginBtn.dataset.mode = "login";
    els.loginBtn.className = "login-btn";
    els.settingsDetails.open = true;
  }

  if (state.connected && state.monitoring) {
    els.connectBtn.textContent = "Monitoring Live";
    els.connectBtn.disabled = true;
    els.connectBtn.dataset.mode = "live";
  } else if (state.connected) {
    els.connectBtn.textContent = "Start Monitoring";
    els.connectBtn.disabled = false;
    els.connectBtn.dataset.mode = "start";
  } else {
    els.connectBtn.textContent = "Connect & Start";
    els.connectBtn.disabled = false;
    els.connectBtn.dataset.mode = "connect";
  }

  const pnl = state.pnl || {};
  setMoney(els.totalPnl, pnl.total);
  setMoney(els.realisedPnl, pnl.realised);
  setMoney(els.unrealisedPnl, pnl.unrealised);
  setMoney(els.riskLimit, state.settings?.maxLoss);
  els.riskLimitStatus.textContent = state.connected
    ? `Active limit: ${formatMoney(state.settings?.maxLoss || 0)}`
    : `Will use ${formatMoney(Number(els.maxLoss.value || state.settings?.maxLoss || 0))}`;
  els.lastUpdated.textContent = pnl.updatedAt ? `Updated ${formatTime(pnl.updatedAt)}` : "Not updated";

  els.killMetric.classList.toggle("active", Boolean(state.kill?.active));
  els.killState.textContent = state.kill?.active ? "Active" : "Inactive";
  els.killReason.textContent = state.kill?.reason || "Guard ready";

  renderPositions(state.positions || []);
  renderOrders(state.orders || []);
  renderLog(state.actions || []);
}

function settingsPayload() {
  return {
    maxLoss: Number(els.maxLoss.value),
    pnlPollMs: Number(els.pnlPollMs.value),
    guardPollMs: Number(els.guardPollMs.value),
  };
}

function renderPositions(positions) {
  els.positionCount.textContent = positions.length;
  if (!positions.length) {
    els.positionsBody.innerHTML = `<tr><td class="empty" colspan="4">No open positions</td></tr>`;
    return;
  }
  els.positionsBody.innerHTML = positions
    .map((position) => {
      const pnl = Number(position.realised || 0) + Number(position.unrealised || 0);
      return `<tr>
        <td>${escapeHtml(position.exchange)}:${escapeHtml(position.tradingsymbol)}</td>
        <td>${escapeHtml(position.product)}</td>
        <td class="right">${position.quantity}</td>
        <td class="right ${pnl < 0 ? "negative" : "positive"}">${formatMoney(pnl)}</td>
      </tr>`;
    })
    .join("");
}

function renderOrders(orders) {
  els.orderCount.textContent = orders.length;
  if (!orders.length) {
    els.ordersBody.innerHTML = `<tr><td class="empty" colspan="4">No recent orders</td></tr>`;
    return;
  }
  els.ordersBody.innerHTML = orders
    .slice()
    .reverse()
    .map((order) => `<tr>
      <td>${escapeHtml(order.exchange)}:${escapeHtml(order.tradingsymbol)}</td>
      <td>${escapeHtml(order.transaction_type)}</td>
      <td>${escapeHtml(order.status)}</td>
      <td class="right">${order.filled_quantity || 0}/${order.quantity || 0}</td>
    </tr>`)
    .join("");
}

function renderLog(actions) {
  if (!actions.length) {
    els.logList.innerHTML = `<div class="log-item"><span class="log-type">READY</span><span>No actions yet</span><span class="log-time">--</span></div>`;
    return;
  }
  els.logList.innerHTML = actions
    .map((action) => `<div class="log-item">
      <span class="log-type">${escapeHtml(action.type)}</span>
      <span>${escapeHtml(action.message)}</span>
      <span class="log-time">${formatTime(action.at)}</span>
    </div>`)
    .join("");
}

async function api(path, options = {}) {
  if (window.location.protocol === "file:" && !API_BASE) {
    throw new Error("Backend unavailable from file://. Open http://localhost:3000 instead.");
  }
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

async function withBusy(button, fn) {
  button.disabled = true;
  try {
    await fn();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

function setMoney(el, value) {
  const num = Number(value || 0);
  el.textContent = Number.isFinite(num) ? formatMoney(num) : "--";
  el.classList.toggle("negative", num < 0);
  el.classList.toggle("positive", num > 0);
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatTime(value) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 3600);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}
