document.addEventListener('DOMContentLoaded', () => {
  loadStatus();
  document.getElementById('btnRetry').addEventListener('click', retryQueue);
  document.getElementById('btnFetchFinal').addEventListener('click', fetchFinalReports);
});

function fetchFinalReports() {
  const btn = document.getElementById('btnFetchFinal');
  const status = document.getElementById('fetchStatus');
  btn.disabled = true;
  btn.textContent = 'Buscando...';
  status.textContent = 'Consultando pendientes y descargando de Synapse...';

  chrome.runtime.sendMessage({ type: 'FETCH_FINAL_REPORTS' }, (response) => {
    btn.disabled = false;
    btn.textContent = 'Obtener informes finales';
    if (response) {
      status.textContent = `${response.found} de ${response.pending} informes obtenidos` +
        (response.errors ? ` (${response.errors} errores)` : '');
      status.style.color = response.found > 0 ? '#27ae60' : '#666';
    } else {
      status.textContent = 'Error de comunicación';
      status.style.color = '#e74c3c';
    }
  });
}

function loadStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (!response) return;

    const connEl = document.getElementById('statusConnection');
    if (response.configured) {
      connEl.textContent = 'Activo ✓';
      connEl.className = 'status-value status-ok';
    } else {
      connEl.textContent = 'URL no configurada';
      connEl.className = 'status-value status-error';
    }

    const stats = response.stats || {};
    document.getElementById('statusTotal').textContent = stats.totalSuccess || 0;

    if (stats.lastCaptureAt) {
      const d = new Date(stats.lastCaptureAt);
      const pad = n => String(n).padStart(2, '0');
      document.getElementById('statusLast').textContent =
        `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    const queueEl = document.getElementById('statusQueue');
    const queueLen = response.queueLength || 0;
    queueEl.textContent = queueLen;
    queueEl.className = queueLen > 0 ? 'status-value status-warn' : 'status-value status-ok';
    document.getElementById('retryRow').style.display = queueLen > 0 ? 'flex' : 'none';

    renderLog(response.recentLog || []);
  });
}

function retryQueue() {
  chrome.runtime.sendMessage({ type: 'RETRY_NOW' }, () => {
    showToast('Reintentando...');
    setTimeout(loadStatus, 3000);
  });
}

function renderLog(entries) {
  const container = document.getElementById('logContainer');
  if (!entries.length) {
    container.innerHTML = '<div class="log-empty">Sin capturas aún</div>';
    return;
  }
  container.innerHTML = entries.map(e => {
    const d = new Date(e.timestamp);
    const pad = n => String(n).padStart(2, '0');
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const dot = e.status === 'success' ? 'success' : e.status === 'retried' ? 'retried' : 'failed';
    return `<div class="log-entry">
      <span class="log-dot ${dot}"></span>
      <span class="log-time">${time}</span>
      <span class="log-text">${e.patient} → ${e.staff}</span>
    </div>`;
  }).join('');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}
