/**
 * Synapse Preinforme Capture — Background Service Worker
 * 
 * Recibe datos del content script, los envía al Apps Script,
 * y gestiona una cola de reintentos si el envío falla.
 */

// ── Configuración hardcodeada ─────────────────────────────────────────
const CONFIG = {
  appsScriptUrl: 'https://script.google.com/macros/s/AKfycbwZ9jLBuR3NB4BIEq0TeivmzJMp3mrTc6g99zGaDDVXCXS5Bm-68MAn0nUI-eTnxzCIbg/exec',
  secretToken:   'hsjd_becados_QWERTy'
};

const SYNAPSE_REPORT_URL = 'https://sjdcwm.synapsetimed.cl/synapsereport/getreport.aspx?acc=';

const RETRY_ALARM_NAME = 'synapse-capture-retry';
const RETRY_INTERVAL_MINUTES = 5;
const MAX_RETRIES = 10;
const STORAGE_KEYS = {
  retryQueue:    'retryQueue',
  captureLog:    'captureLog',
  stats:         'stats',
  fetchProgress: 'fetchProgress'
};

// ── Listener de mensajes del content script ──────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_PREINFORME') {
    handleCapture(message.data);
    sendResponse({ status: 'received' });
    return false;
  }

  if (message.type === 'GET_STATUS') {
    getStatus().then(status => sendResponse(status));
    return true;
  }

  if (message.type === 'RETRY_NOW') {
    processRetryQueue();
    sendResponse({ status: 'retrying' });
    return false;
  }

  if (message.type === 'CLEAR_QUEUE') {
    chrome.storage.local.set({ [STORAGE_KEYS.retryQueue]: [] }, () => {
      sendResponse({ status: 'cleared' });
    });
    return true;
  }

  if (message.type === 'FETCH_FINAL_REPORTS') {
    sendResponse({ status: 'started' });
    fetchFinalReports();
    return false;
  }

  if (message.type === 'GET_FETCH_PROGRESS') {
    chrome.storage.local.get(STORAGE_KEYS.fetchProgress, (result) => {
      sendResponse(result[STORAGE_KEYS.fetchProgress] || null);
    });
    return true;
  }

  sendResponse({ status: 'unknown_message' });
  return false;
});

// ── Captura principal ────────────────────────────────────────────────

async function handleCapture(data) {
  const config = await getConfig();

  if (!config.appsScriptUrl) {
    console.warn('[SynapseCapture] URL del Apps Script no configurada');
    addToRetryQueue(data, 'URL no configurada');
    return;
  }

  const success = await sendToAppsScript(config, data);

  if (success) {
    await logCapture(data, 'success');
    await updateStats('success');
  } else {
    addToRetryQueue(data, 'Error de red');
    await updateStats('failed');
  }
}

// ── Envío al Apps Script ─────────────────────────────────────────────

async function sendToAppsScript(config, data) {
  try {
    const payload = {
      token: config.secretToken || '',
      ...data
    };

    const response = await fetch(config.appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      console.error('[SynapseCapture] HTTP error:', response.status);
      return false;
    }

    const result = await response.json();
    
    if (result.status === 'ok') {
      console.log('[SynapseCapture] Preinforme guardado exitosamente');
      return true;
    } else {
      console.error('[SynapseCapture] Apps Script error:', result.error);
      return false;
    }
  } catch (error) {
    console.error('[SynapseCapture] Error de red:', error);
    return false;
  }
}

// ── Cola de reintentos ───────────────────────────────────────────────

async function addToRetryQueue(data, reason) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.retryQueue);
  const queue = result[STORAGE_KEYS.retryQueue] || [];

  queue.push({
    data: data,
    addedAt: new Date().toISOString(),
    retries: 0,
    lastError: reason
  });

  if (queue.length > 200) {
    queue.splice(0, queue.length - 200);
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.retryQueue]: queue });

  const alarm = await chrome.alarms.get(RETRY_ALARM_NAME);
  if (!alarm) {
    chrome.alarms.create(RETRY_ALARM_NAME, {
      periodInMinutes: RETRY_INTERVAL_MINUTES
    });
  }

  console.log(`[SynapseCapture] Añadido a cola de reintentos (${queue.length} pendientes)`);
}

async function processRetryQueue() {
  const config = await getConfig();
  if (!config.appsScriptUrl) return;

  const result = await chrome.storage.local.get(STORAGE_KEYS.retryQueue);
  const queue = result[STORAGE_KEYS.retryQueue] || [];

  if (queue.length === 0) return;

  console.log(`[SynapseCapture] Procesando cola de reintentos: ${queue.length} items`);

  const remaining = [];
  const permanentlyFailed = [];

  for (const item of queue) {
    const success = await sendToAppsScript(config, item.data);

    if (success) {
      await logCapture(item.data, 'retried');
      await updateStats('retried');
    } else {
      item.retries += 1;
      item.lastError = 'Reintento fallido #' + item.retries;

      if (item.retries >= MAX_RETRIES) {
        permanentlyFailed.push(item);
      } else {
        remaining.push(item);
      }
    }

    await new Promise(r => setTimeout(r, 500));
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.retryQueue]: remaining });

  if (permanentlyFailed.length > 0) {
    showNotification(
      'Preinformes no guardados',
      `${permanentlyFailed.length} preinforme(s) no pudieron ser guardados después de ${MAX_RETRIES} intentos.`
    );
    await updateStats('permanently_failed', permanentlyFailed.length);
  }

  if (remaining.length === 0) {
    chrome.alarms.clear(RETRY_ALARM_NAME);
  }
}

// ── Alarma de reintentos ─────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM_NAME) {
    processRetryQueue();
  }
});

// ── Logging y estadísticas ───────────────────────────────────────────

async function logCapture(data, status) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.captureLog);
  const log = result[STORAGE_KEYS.captureLog] || [];

  log.push({
    timestamp: new Date().toISOString(),
    patient: data.patientNumber,
    staff: data.staffValidator,
    username: data.username,
    status: status
  });

  if (log.length > 100) {
    log.splice(0, log.length - 100);
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.captureLog]: log });
}

async function updateStats(type, count) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.stats);
  const stats = result[STORAGE_KEYS.stats] || {
    totalCaptured: 0,
    totalSuccess: 0,
    totalRetried: 0,
    totalFailed: 0,
    lastCaptureAt: null
  };

  switch (type) {
    case 'success':
      stats.totalCaptured += 1;
      stats.totalSuccess += 1;
      stats.lastCaptureAt = new Date().toISOString();
      break;
    case 'failed':
      stats.totalCaptured += 1;
      stats.totalFailed += 1;
      stats.lastCaptureAt = new Date().toISOString();
      break;
    case 'retried':
      stats.totalRetried += 1;
      stats.totalSuccess += 1;
      break;
    case 'permanently_failed':
      stats.totalFailed += (count || 1);
      break;
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.stats]: stats });
}

// ── Notificaciones ───────────────────────────────────────────────────

function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: title,
    message: message
  });
}

// ── Progreso del fetch ───────────────────────────────────────────────

async function setFetchProgress(progress) {
  await chrome.storage.local.set({ [STORAGE_KEYS.fetchProgress]: progress });
}

// ── Obtención de informes finales (BATCH) ────────────────────────────

/**
 * Flujo optimizado:
 * 1. POST al Apps Script → lista de accesos pendientes
 * 2. Fetch a Synapse por cada acceso (red local del hospital)
 * 3. UN SOLO POST batch al Apps Script con TODOS los informes encontrados
 *    → Apps Script abre cada spreadsheet UNA sola vez y escribe todo
 *
 * Antes: N informes × 21 spreadsheets = N×21 openById
 * Ahora: 21 openById total (1 por spreadsheet), sin importar cuántos informes
 */
async function fetchFinalReports() {
  const progress = {
    status: 'running',
    pending: 0,
    found: 0,
    errors: 0,
    current: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    message: 'Consultando pendientes...'
  };

  await setFetchProgress(progress);

  try {
    // ── 1. Obtener lista de pendientes desde Apps Script ──
    const pendingResp = await fetch(CONFIG.appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: CONFIG.secretToken,
        action: 'pending'
      }),
      signal: AbortSignal.timeout(30000)
    });
    const pendingData = await pendingResp.json();

    if (pendingData.status !== 'ok' || !pendingData.pending) {
      console.error('[SynapseCapture] Error obteniendo pendientes:', pendingData);
      progress.status = 'error';
      progress.errors = 1;
      progress.message = 'Error obteniendo lista de pendientes';
      progress.finishedAt = new Date().toISOString();
      await setFetchProgress(progress);
      return;
    }

    const pendingList = pendingData.pending;
    progress.pending = pendingList.length;

    if (pendingList.length === 0) {
      progress.status = 'done';
      progress.message = 'No hay informes finales pendientes';
      progress.finishedAt = new Date().toISOString();
      await setFetchProgress(progress);
      return;
    }

    console.log(`[SynapseCapture] ${pendingList.length} informes finales pendientes`);

    // ── 2. Fetch cada informe desde Synapse (red hospital) ──
    const foundReports = [];

    for (let idx = 0; idx < pendingList.length; idx++) {
      const item = pendingList[idx];

      progress.current = idx + 1;
      progress.message = `Descargando de Synapse ${idx + 1}/${pendingList.length}...`;
      await setFetchProgress(progress);

      for (const acc of item.accessions) {
        try {
          const text = await fetchSynapseReport(acc);
          if (text) {
            foundReports.push({ accession: acc, reportText: text });
            console.log(`[SynapseCapture] Informe encontrado: ${acc} (${item.patient})`);
            break;
          }
        } catch (e) {
          console.warn('[SynapseCapture] Error fetch acc', acc, e);
        }
      }

      await new Promise(r => setTimeout(r, 300));
    }

    progress.found = foundReports.length;

    if (foundReports.length === 0) {
      console.log('[SynapseCapture] Ningún informe final encontrado en Synapse');
      progress.status = 'done';
      progress.message = `0/${pendingList.length} informes disponibles en Synapse`;
      progress.finishedAt = new Date().toISOString();
      await setFetchProgress(progress);
      return;
    }

    // ── 3. Enviar TODOS los informes en un solo POST batch ──
    progress.message = `Guardando ${foundReports.length} informes en Sheets...`;
    await setFetchProgress(progress);

    console.log(`[SynapseCapture] Enviando batch de ${foundReports.length} informes al Apps Script`);

    try {
      const writeResp = await fetch(CONFIG.appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: CONFIG.secretToken,
          action: 'finalreport_batch',
          reports: foundReports
        }),
        signal: AbortSignal.timeout(120000)  // 2 min — Apps Script puede tardar
      });

      const writeResult = await writeResp.json();

      if (writeResult.status === 'ok') {
        console.log(`[SynapseCapture] Batch guardado: ${writeResult.written} escrituras en ${writeResult.sheetsProcessed} hojas`);
      } else {
        console.error('[SynapseCapture] Error en batch:', writeResult.error);
        progress.errors++;
      }
    } catch (e) {
      console.error('[SynapseCapture] Error enviando batch:', e);
      progress.errors++;
    }

  } catch (error) {
    console.error('[SynapseCapture] Error en fetchFinalReports:', error);
    progress.errors++;
  }

  // ── Finalizar ──
  progress.status = 'done';
  progress.finishedAt = new Date().toISOString();
  progress.message = `${progress.found}/${progress.pending} informes obtenidos` +
    (progress.errors ? ` (${progress.errors} errores)` : '');
  await setFetchProgress(progress);

  if (progress.found > 0 || progress.errors > 0) {
    showNotification('Informes finales', progress.message);
  }

  console.log(`[SynapseCapture] Resultado: ${progress.found}/${progress.pending} informes obtenidos`);
}

/**
 * Fetch un informe desde Synapse y extrae el texto de div#tConteudo.
 */
async function fetchSynapseReport(accession) {
  const url = SYNAPSE_REPORT_URL + encodeURIComponent(accession);
  console.log('[SynapseCapture] Fetching:', url);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    console.log('[SynapseCapture] HTTP error:', response.status);
    return '';
  }

  const html = await response.text();

  if (html.includes('Report is not available')) {
    console.log('[SynapseCapture] Informe no disponible aún para', accession);
    return '';
  }

  const match = html.match(/<div id="tConteudo">([\s\S]*?)<\/div>/i);
  if (!match || !match[1]) {
    console.log('[SynapseCapture] No se encontró tConteudo para', accession);
    return '';
  }

  const reportHtml = match[1].trim();

  if (reportHtml.length < 20) {
    console.log('[SynapseCapture] tConteudo vacío para', accession);
    return '';
  }

  console.log('[SynapseCapture] Informe encontrado para', accession, '- largo:', reportHtml.length);
  return htmlToPlainTextBg(reportHtml);
}

/**
 * Convierte HTML a texto plano (versión service worker, sin DOMParser).
 */
function htmlToPlainTextBg(html) {
  if (!html) return '';

  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]*>/g, '');

  const entities = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
    '&aacute;': 'á', '&eacute;': 'é', '&iacute;': 'í', '&oacute;': 'ó', '&uacute;': 'ú',
    '&Aacute;': 'Á', '&Eacute;': 'É', '&Iacute;': 'Í', '&Oacute;': 'Ó', '&Uacute;': 'Ú',
    '&ntilde;': 'ñ', '&Ntilde;': 'Ñ', '&uuml;': 'ü', '&Uuml;': 'Ü',
    '&nbsp;': ' ', '&iexcl;': '¡', '&iquest;': '¿',
    '&deg;': '°', '&ordm;': 'º', '&ordf;': 'ª',
    '&mdash;': '—', '&ndash;': '–', '&hellip;': '…'
  };

  for (const [ent, char] of Object.entries(entities)) {
    text = text.split(ent).join(char);
  }

  text = text.replace(/&#(\d+);/g, (m, code) => String.fromCharCode(parseInt(code, 10)));

  text = text
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

// ── Helpers ──────────────────────────────────────────────────────────

function getConfig() {
  return Promise.resolve(CONFIG);
}

async function getStatus() {
  const configured = CONFIG.appsScriptUrl && !CONFIG.appsScriptUrl.includes('PEGAR_');
  const queueResult = await chrome.storage.local.get(STORAGE_KEYS.retryQueue);
  const statsResult = await chrome.storage.local.get(STORAGE_KEYS.stats);
  const logResult = await chrome.storage.local.get(STORAGE_KEYS.captureLog);

  return {
    configured: configured,
    queueLength: (queueResult[STORAGE_KEYS.retryQueue] || []).length,
    stats: statsResult[STORAGE_KEYS.stats] || {},
    recentLog: (logResult[STORAGE_KEYS.captureLog] || []).slice(-10).reverse()
  };
}

// ── Inicialización ───────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  console.log('[SynapseCapture] Extensión instalada');
});