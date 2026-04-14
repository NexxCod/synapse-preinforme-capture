/**
 * Synapse Preinforme Capture — Content Script
 * 
 * Se inyecta en https://sjdcwm.synapsetimed.cl/M_Relatorios/EX_Relatar.aspx*
 * Intercepta el click en "Enviar a" → nombre del staff, extrae todos los datos
 * del DOM, y envía al background script para POST al Apps Script.
 */

(function () {
  'use strict';

  // ── Selectores del DOM ─────────────────────────────────────────────
  const SEL = {
    username:      '#ctl00_cntHeader_lbUserName',
    patientNumber: '#ctl00_MainContent_tb_numutente',
    patientName:   '#ctl00_MainContent_tb_nomeutente',
    patientSurname:'#ctl00_MainContent_tb_apelido',
    examsTable:    '#ctl00_MainContent_gd_exames',
    hiddenReport:  '#ctl00_MainContent_ReportEditor_saEditor_hiddenReportContent',
    sendToList:    '#ulSendTo',
    ckEditorId:    'ctl00_MainContent_ReportEditor_saEditor_reportContent'
  };

  // ── Extracción de datos ────────────────────────────────────────────

  function getUsername() {
    const el = document.querySelector(SEL.username);
    return el ? el.textContent.trim() : '';
  }

  function getPatientNumber() {
    const el = document.querySelector(SEL.patientNumber);
    return el ? el.value.trim() : '';
  }

  function getPatientName() {
    const name = document.querySelector(SEL.patientName);
    const surname = document.querySelector(SEL.patientSurname);
    const n = name ? name.value.trim() : '';
    const s = surname ? surname.value.trim() : '';
    return (n + ' ' + s).trim();
  }

  function getExams() {
    const table = document.querySelector(SEL.examsTable);
    if (!table) return { accessions: '', procedures: '', examDates: '' };

    const rows = table.querySelectorAll('tr.datatablebody:not(.inserted-row)');
    const accessions = [];
    const procedures = [];
    const examDates = [];

    rows.forEach(row => {
      // N° de acceso — hidden input con id que termina en "hdnAccNmb"
      const accInput = row.querySelector('input[id$="hdnAccNmb"]');
      if (accInput && accInput.value.trim()) {
        accessions.push(accInput.value.trim());
      }

      // Procedimiento — td con clase w-80 (texto directo)
      const procTd = row.querySelector('td.w-80');
      if (procTd) {
        let procText = '';
        procTd.childNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) {
            procText += node.textContent.trim();
          }
        });
        procText = procText.replace(/\s+/g, ' ').trim();
        if (procText) procedures.push(procText);
      }

      // Fecha de realización — primer td.responsive-col en la fila
      const dateTd = row.querySelector('td.responsive-col');
      if (dateTd && dateTd.textContent.trim()) {
        examDates.push(dateTd.textContent.trim());
      }
    });

    return {
      accessions: accessions.join(', '),
      procedures: procedures.join(', '),
      examDates: examDates.join(', ')
    };
  }

  /**
   * Obtiene el texto del preinforme.
   * Lee directamente del DOM sin inyectar scripts (evita conflictos con CSP).
   * 
   * Método 1: Leer el div contenteditable de CKEditor (innerHTML actual)
   * Método 2: Leer el hidden input (se actualiza en blur del editor)
   */
  function getReportText() {
    let reportText = '';

    // Método 1: leer el div contenteditable directamente del DOM
    try {
      const editorDiv = document.getElementById(SEL.ckEditorId);
      if (editorDiv) {
        reportText = editorDiv.innerHTML || '';
      }
    } catch (e) {
      console.warn('[SynapseCapture] Error leyendo div editor:', e);
    }

    // Método 2 (fallback): hidden input
    if (!reportText) {
      const hidden = document.querySelector(SEL.hiddenReport);
      reportText = hidden ? hidden.value : '';
    }

    return htmlToPlainText(reportText);
  }

  /**
   * Convierte HTML a texto plano legible:
   * - Decodifica entidades HTML (&Oacute; → Ó, &aacute; → á, etc.)
   * - Reemplaza <br>, <br/>, </p> por saltos de línea
   * - Elimina todos los tags HTML restantes
   * - Limpia saltos de línea redundantes
   */
  function htmlToPlainText(html) {
    if (!html) return '';

    // Usar un elemento temporal del DOM para decodificar entidades
    const temp = document.createElement('div');

    // Paso 1: Insertar saltos de línea donde corresponde
    let text = html
      .replace(/<br\s*\/?>/gi, '\n')       // <br> → \n
      .replace(/<\/p>/gi, '\n\n')           // </p> → doble salto
      .replace(/<\/div>/gi, '\n')           // </div> → \n
      .replace(/<\/li>/gi, '\n')            // </li> → \n
      .replace(/<\/tr>/gi, '\n')            // </tr> → \n
      .replace(/<\/h[1-6]>/gi, '\n\n');     // </h1-6> → doble salto

    // Paso 2: Eliminar todos los tags HTML restantes
    text = text.replace(/<[^>]*>/g, '');

    // Paso 3: Decodificar entidades HTML usando el DOM
    temp.innerHTML = text;
    text = temp.textContent || temp.innerText || '';

    // Paso 4: Limpiar espacios y saltos redundantes
    text = text
      .replace(/[ \t]+/g, ' ')             // Múltiples espacios → uno
      .replace(/ ?\n ?/g, '\n')            // Espacios alrededor de \n
      .replace(/\n{3,}/g, '\n\n')          // Máximo 2 saltos seguidos
      .trim();

    return text;
  }

  function getCurrentTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  // ── Interceptación del envío ───────────────────────────────────────

  function handleSendToClick(event) {
    // Solo nos interesan clicks en links dentro de #ulSendTo
    const link = event.target.closest('#ulSendTo li a');
    if (!link) return;

    // Ignorar el grupo "Radiologos" (sendTo con grupo, no sendToRad individual)
    const onclickAttr = link.getAttribute('onclick') || '';
    if (onclickAttr.includes('sendTo(') && !onclickAttr.includes('sendToRad(')) {
      // Es un click en un grupo, no en un staff individual — ignorar
      return;
    }

    // Extraer nombre del staff
    const staffName = link.textContent.trim();
    if (!staffName) return;

    // Extraer todos los datos
    const exams = getExams();
    const data = {
      username:      getUsername(),
      patientNumber: getPatientNumber(),
      patientName:   getPatientName(),
      accessions:    exams.accessions,
      procedures:    exams.procedures,
      examDates:     exams.examDates,
      sendTimestamp: getCurrentTimestamp(),
      staffValidator: staffName,
      reportText:    getReportText()
    };

    // Validar que hay datos mínimos
    if (!data.username || !data.patientNumber || !data.reportText) {
      console.warn('[SynapseCapture] Datos incompletos, captura omitida:', {
        hasUsername: !!data.username,
        hasPatient: !!data.patientNumber,
        hasReport: !!data.reportText
      });
      return;
    }

    // Enviar al background script (fire and forget)
    try {
      chrome.runtime.sendMessage({
        type: 'CAPTURE_PREINFORME',
        data: data
      });
    } catch (e) {
      console.error('[SynapseCapture] Error enviando al background:', e);
    }

    // Feedback visual discreto
    showCaptureIndicator();

    console.log('[SynapseCapture] Preinforme capturado:', data.patientNumber, '→', staffName);
  }

  // ── Feedback visual ────────────────────────────────────────────────

  function showCaptureIndicator() {
    // Crear indicador verde temporal
    let indicator = document.getElementById('synapse-capture-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'synapse-capture-indicator';
      indicator.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 999999;
        background: #27ae60;
        color: white;
        padding: 8px 16px;
        border-radius: 6px;
        font-family: Arial, sans-serif;
        font-size: 13px;
        font-weight: bold;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        transition: opacity 0.5s ease;
        pointer-events: none;
      `;
      document.body.appendChild(indicator);
    }

    indicator.textContent = '✓ Preinforme capturado';
    indicator.style.opacity = '1';

    setTimeout(() => {
      indicator.style.opacity = '0';
    }, 2500);

    setTimeout(() => {
      if (indicator.parentNode) indicator.remove();
    }, 3200);
  }

  // ── Inicialización ─────────────────────────────────────────────────

  function init() {
    // Verificar que estamos en la página correcta
    if (!document.querySelector(SEL.sendToList)) {
      console.log('[SynapseCapture] #ulSendTo no encontrado, reintentando...');
      // Reintentar con MutationObserver por si la lista se carga dinámicamente
      const observer = new MutationObserver((mutations, obs) => {
        if (document.querySelector(SEL.sendToList)) {
          obs.disconnect();
          attachListener();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      // Timeout de seguridad
      setTimeout(() => observer.disconnect(), 30000);
      return;
    }

    attachListener();
  }

  function attachListener() {
    // Capture phase: se ejecuta ANTES de los inline onclick handlers
    document.addEventListener('click', handleSendToClick, true);
    console.log('[SynapseCapture] Listener activo — capturando preinformes');
  }

  // Iniciar cuando el DOM esté listo
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

})();
