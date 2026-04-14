/**
 * Synapse Preinforme Capture — Background Service Worker
 * 
 * Recibe datos del content script, los envía al Apps Script,
 * y gestiona una cola de reintentos si el envío falla.
 */

// ── Configuración hardcodeada ─────────────────────────────────────────
// ⚠️  COMPLETAR ESTOS DOS VALORES ANTES DE DESPLEGAR:
//     1. Ejecutar setup() en Apps Script
//     2. Implementar como Web App
//     3. Pegar la URL aquí y definir el token
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
  stats:         'stats'
};

// ── Listener de mensajes del content script ──────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_PREINFORME') {
    handleCapture(message.data);
    sendResponse({ status: 'received' });
  }

  if (message.type === 'GET_STATUS') {
    getStatus().then(status => sendResponse(status));
    return true;
  }

  if (message.type === 'RETRY_NOW') {
    processRetryQueue();
    sendResponse({ status: 'retrying' });
  }

  if (message.type === 'CLEAR_QUEUE') {
    chrome.storage.local.set({ [STORAGE_KEYS.retryQueue]: [] }, () => {
      sendResponse({ status: 'cleared' });
    });
    return true;
  }

  if (message.type === 'FETCH_FINAL_REPORTS') {
    fetchFinalReports().then(result => sendResponse(result));
    return true;
  }
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
      signal: AbortSignal.timeout(15000) // 15 segundos timeout
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

  // Limitar la cola a 200 items para no llenar el storage
  if (queue.length > 200) {
    queue.splice(0, queue.length - 200);
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.retryQueue]: queue });

  // Asegurar que la alarma de reintentos esté activa
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

    // Pequeña pausa entre envíos para no saturar
    await new Promise(r => setTimeout(r, 500));
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.retryQueue]: remaining });

  // Notificar sobre fallos permanentes
  if (permanentlyFailed.length > 0) {
    showNotification(
      'Preinformes no guardados',
      `${permanentlyFailed.length} preinforme(s) no pudieron ser guardados después de ${MAX_RETRIES} intentos. Revisa la configuración de la extensión.`
    );
    await updateStats('permanently_failed', permanentlyFailed.length);
  }

  // Si no hay más items, limpiar la alarma
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

  // Mantener solo los últimos 100 registros
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

// ── Obtención de informes finales (fetch desde el navegador) ─────────

/**
 * Flujo completo:
 * 1. GET al Apps Script → lista de accesos pendientes
 * 2. Fetch a Synapse por cada acceso (red local del hospital)
 * 3. POST al Apps Script con cada informe encontrado
 */
async function fetchFinalReports() {
  const result = { pending: 0, found: 0, errors: 0 };

  try {
    // 1. Obtener lista de pendientes desde Apps Script (via POST)
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
      return { ...result, errors: 1 };
    }

    const pendingList = pendingData.pending;
    result.pending = pendingList.length;

    if (pendingList.length === 0) {
      console.log('[SynapseCapture] No hay informes finales pendientes');
      return result;
    }

    console.log(`[SynapseCapture] ${pendingList.length} informes finales pendientes`);

    // 2. Fetch cada informe desde Synapse
    for (const item of pendingList) {
      let reportText = '';
      let usedAccession = '';

      // Probar cada accession hasta encontrar uno con informe
      for (const acc of item.accessions) {
        try {
          const text = await fetchSynapseReport(acc);
          if (text) {
            reportText = text;
            usedAccession = acc;
            break;
          }
        } catch (e) {
          console.warn('[SynapseCapture] Error fetch acc', acc, e);
        }
      }

      if (!reportText) continue;

      // 3. Enviar informe final al Apps Script
      try {
        const writeResp = await fetch(CONFIG.appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: CONFIG.secretToken,
            action: 'finalreport',
            accession: usedAccession,
            reportText: reportText
          }),
          signal: AbortSignal.timeout(15000)
        });

        const writeResult = await writeResp.json();
        if (writeResult.status === 'ok') {
          result.found++;
          console.log(`[SynapseCapture] Informe final guardado: ${usedAccession} (${item.patient})`);
        }
      } catch (e) {
        console.error('[SynapseCapture] Error guardando informe final:', e);
        result.errors++;
      }

      // Pausa entre requests
      await new Promise(r => setTimeout(r, 300));
    }

  } catch (error) {
    console.error('[SynapseCapture] Error en fetchFinalReports:', error);
    result.errors++;
  }

  console.log(`[SynapseCapture] Resultado: ${result.found}/${result.pending} informes obtenidos`);
  return result;
}

/**
 * Fetch un informe desde Synapse y extrae el texto de div#tConteudo.
 * Retorna texto plano o '' si no hay informe disponible.
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

  // Verificar que no sea mensaje de error
  if (html.includes('Report is not available')) {
    console.log('[SynapseCapture] Informe no disponible aún para', accession);
    return '';
  }

  // Extraer contenido de div#tConteudo (regex simple)
  const match = html.match(/<div id="tConteudo">([\s\S]*?)<\/div>/i);
  if (!match || !match[1]) {
    console.log('[SynapseCapture] No se encontró tConteudo para', accession);
    return '';
  }

  const reportHtml = match[1].trim();

  // Verificar que no sea vacío
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

  // Decodificar entidades HTML manualmente (sin DOMParser)
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

  // Entidades numéricas (&#233; → é)
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
