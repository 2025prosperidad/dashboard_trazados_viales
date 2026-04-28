/**
 * Sincroniza desde AppSheet (tabla Intake_form) hacia Google Sheets:
 *   - Status          → columna ESTADO_ACTUAL
 *   - Vencimiento tramite → columna Result (fecha de vencimiento calculada en AppSheet)
 *
 * vía API v2 de AppSheet.
 *
 * Por qué a veces ves "402 filas de AppSheet" pero "153 actualizadas":
 *
 * 1) El contador "actualizadas" solo suma filas donde el valor NUEVO es distinto
 *    al que ya había en la hoja. Si 249 trámites ya tenían el mismo ESTADO_ACTUAL,
 *    el log mostraría 153 aunque se hayan revisado 402.
 *
 * 2) "402" debe ser el largo real de response.Rows del JSON. Si logueas otro
 *    número (p. ej. un total de la app), puede no coincidir con lo que recorres.
 *
 * 3) Si buscas filas en la hoja solo hasta getLastRow() y el rango de IDs no
 *    cubre todos los expedientes, solo se actualizarán las que encuentres.
 *
 * Ajusta CONFIG y ejecuta syncEstadoDesdeAppSheet() o programa syncEstadoDesdeAppSheet
 * cada minuto en un disparador instalado.
 *
 * Dónde sacar APP_ID y APPLICATION_ACCESS_KEY (AppSheet):
 *   Editor de la app → menú "Data" → sección API / "Integrations" → habilitar API
 *   → copiar "App ID" y "Application Access Key" (no uses el texto TU_APP_ID de ejemplo).
 *
 * Si el log muestra "Filas en response.Rows (AppSheet): 0" pero la app sí tiene datos:
 *   - Revisa el nombre de TABLE_NAME (debe coincidir con Data → Tables en AppSheet).
 *   - Muy frecuente: Security filter en la tabla que con la identidad por defecto del API
 *     no devuelve filas. Pon RUN_AS_USER_EMAIL con un usuario que vea todos los trámites
 *     (p. ej. el dueño o un supervisor), según documentación RunAsUserEmail.
 */

const CONFIG = {
  APP_ID: '156f5e61-3921-4762-9710-87ffa1f49619',
  /**
   * Clave V2-... de AppSheet (Data → API). Preferible: déjala vacía y define la propiedad
   * de script APP_SHEET_APPLICATION_ACCESS_KEY (Proyecto → engrane → Propiedades del script)
   * para no guardar secretos en texto plano si compartes el código.
   */
  APPLICATION_ACCESS_KEY: 'V2-Apiej-rRDMg-NpGts-ivTwB-ZAu8y-BkCQx-KGmln-xvdGb',
  /** Dominio según tu cuenta (global: www.appsheet.com; EU: eu.appsheet.com; etc.) */
  REGION_HOST: 'www.appsheet.com',
  /** Nombre exacto de la tabla en AppSheet (URL-encoded si tiene espacios) */
  TABLE_NAME: 'Intake_form',
  /** Columna en AppSheet que trae el estado (nombre exacto) */
  COLUMNA_STATUS_APPSHEET: 'Status',
  /**
   * Columna en AppSheet con la fecha de vencimiento del trámite (Virtual / fórmula en AppSheet).
   * Debe coincidir con el nombre en Data → Columns.
   */
  COLUMNA_VENCIMIENTO_APPSHEET: 'Vencimiento tramite',
  /** Alias por si el nombre en la app difiere ligeramente */
  COLUMNA_VENCIMIENTO_APPSHEET_ALIASES: ['Vencimiento tramite', 'Vencimiento_tramite', 'Vencimiento Tramite'],
  /** ID de la hoja de Google (entre /d/ y /edit en la URL) */
  SPREADSHEET_ID: '1LaATbQJpXc7iA-BHh5ZWx41bB_T0UwpyOH8eTDyXo_o',
  /** Nombre de la pestaña donde está Intake_form */
  NOMBRE_HOJA: 'Intake_form',
  /**
   * Nombre del encabezado de la columna CLAVE (debe existir en la fila FILA_ENCABEZADO).
   * Se acepta una lista de alias; se usa el primero que encuentre en la hoja.
   */
  NOMBRES_ENCABEZADO_ID: ['id', 'ID', 'Id'],
  /**
   * Nombre del encabezado de la columna donde se escribe el estado.
   */
  NOMBRES_ENCABEZADO_ESTADO: ['ESTADO_ACTUAL', 'Estado_Actual', 'estado_actual'],
  /** Columna en la hoja donde se escribe la fecha de vencimiento (mismo valor que en AppSheet) */
  NOMBRES_ENCABEZADO_RESULT: ['Result', 'RESULT', 'result'],
  /**
   * Columnas permitidas de escritura (bloqueadas por seguridad):
   * - ESTADO_ACTUAL -> CE
   * - Result        -> BA
   * El script no debe escribir en ninguna otra columna.
   */
  COLUMNA_ESTADO_OBJETIVO: 'CE',
  COLUMNA_RESULT_OBJETIVO: 'BA',
  /**
   * Columna de lectura del ID. Esta no se escribe; se usa solo para empatar filas.
   */
  COLUMNA_ID_EN_HOJA_FALLBACK: 'A',
  /** Fila donde empiezan los datos (1 = cabecera en fila 1) */
  FILA_ENCABEZADO: 1,

  /**
   * Find ejecutado como este usuario (Security filters / USEREMAIL() en tablas).
   * Creador de la app / usuario con visión completa en filtros.
   */
  RUN_AS_USER_EMAIL: 'expert@infinity-solutions.community',

  /**
   * Opcional: Selector AppSheet fijo (ej. 'Filter(Intake_form, true)').
   * Si está vacío, el script prueba sin Selector y luego Filter(TABLE_NAME, true).
   */
  FIND_SELECTOR: '',
};

/**
 * Clave de API: CONFIG o propiedad de script APP_SHEET_APPLICATION_ACCESS_KEY.
 */
function getApplicationAccessKey_() {
  const fromProps = PropertiesService.getScriptProperties().getProperty('APP_SHEET_APPLICATION_ACCESS_KEY');
  const fromConfig = (CONFIG.APPLICATION_ACCESS_KEY || '').trim();
  return (fromProps && String(fromProps).trim()) || fromConfig;
}

/**
 * Evita ejecutar sin App ID, hoja o clave de acceso.
 */
function assertConfigFilled_() {
  const errs = [];
  if (!CONFIG.APP_ID || CONFIG.APP_ID === 'TU_APP_ID') {
    errs.push('CONFIG.APP_ID');
  }
  if (!getApplicationAccessKey_()) {
    errs.push('CONFIG.APPLICATION_ACCESS_KEY o propiedad APP_SHEET_APPLICATION_ACCESS_KEY');
  }
  if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID === 'TU_SPREADSHEET_ID') {
    errs.push('CONFIG.SPREADSHEET_ID');
  }
  if (errs.length) {
    throw new Error(
      'Configura en Código.gs: ' +
        errs.join(', ') +
        '. Para la clave: pégala en APPLICATION_ACCESS_KEY o crea la propiedad del script APP_SHEET_APPLICATION_ACCESS_KEY.'
    );
  }
}

/**
 * Extrae el array de filas del JSON de respuesta AppSheet (varias formas posibles).
 */
function extractRowsFromAppSheetJson_(json) {
  if (!json || typeof json !== 'object') return [];
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.Rows)) return json.Rows;
  if (Array.isArray(json.rows)) return json.rows;
  if (json.data && Array.isArray(json.data.Rows)) return json.data.Rows;
  return [];
}

/**
 * Construye Properties del Find (Locale, opcional RunAsUserEmail, opcional Selector).
 */
function buildFindProperties_(selector) {
  const props = {
    Locale: 'es-EC',
    Timezone: 'America/Guayaquil',
  };
  const runAs = (CONFIG.RUN_AS_USER_EMAIL || '').trim();
  if (runAs.indexOf('@') !== -1) {
    props.RunAsUserEmail = runAs;
  }
  const sel = (selector || (CONFIG.FIND_SELECTOR || '').trim()).trim();
  if (sel) props.Selector = sel;
  return props;
}

/**
 * POST Find; devuelve { code, text, json } (json puede ser null si el cuerpo no es JSON).
 */
function appSheetFindRaw_(selector) {
  const tableEnc = encodeURIComponent(CONFIG.TABLE_NAME);
  const url =
    'https://' +
    CONFIG.REGION_HOST +
    '/api/v2/apps/' +
    CONFIG.APP_ID +
    '/tables/' +
    tableEnc +
    '/Action';

  const payload = {
    Action: 'Find',
    Properties: buildFindProperties_(selector),
    Rows: [],
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { ApplicationAccessKey: getApplicationAccessKey_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  const text = response.getContentText();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    json = null;
  }
  return { code: code, text: text, json: json };
}

/**
 * POST Find a AppSheet: varios intentos si Rows viene vacío (Selector / identidad).
 */
function fetchRowsFromAppSheet_() {
  const runAs = (CONFIG.RUN_AS_USER_EMAIL || '').trim();
  Logger.log('RunAsUserEmail en Find: ' + (runAs ? runAs : '(no definido — puede devolver 0 filas con security filters)'));

  const attempts = [];

  const fixedSel = (CONFIG.FIND_SELECTOR || '').trim();
  if (fixedSel) {
    attempts.push({ label: 'FIND_SELECTOR configurado', selector: fixedSel });
  } else {
    attempts.push({ label: 'Find sin Selector (documentación “Read all rows”)', selector: null });
    attempts.push({
      label: 'Find con Filter(TABLE_NAME, true)',
      selector: 'Filter(' + CONFIG.TABLE_NAME + ', true)',
    });
  }

  let lastText = '';
  let lastCode = 0;

  for (let a = 0; a < attempts.length; a++) {
    const att = attempts[a];
    Logger.log('AppSheet Find: intento — ' + att.label);

    const res = appSheetFindRaw_(att.selector);
    lastCode = res.code;
    lastText = res.text;

    if (res.code < 200 || res.code >= 300) {
      var hint = '';
      if (res.code === 400 && res.text.indexOf('not found') !== -1 && String(CONFIG.APP_ID).indexOf('TU_') === 0) {
        hint =
          ' Parece que APP_ID sigue siendo de ejemplo; reemplázalo por el App ID real en CONFIG.';
      }
      if (
        res.text.indexOf('Bandwidth quota exceeded') !== -1 ||
        res.text.indexOf('quota exceeded') !== -1
      ) {
        hint =
          ' Superaste el cupo de la API de AppSheet (ancho de banda). Reduce la frecuencia del disparador ' +
          '(usa configurarTriggerCada5Min o configurarTriggerCada10Min) y/o revisa el plan de AppSheet. ' +
          'El cupo se reinicia con el tiempo; espera unas horas y vuelve a probar.';
      }
      throw new Error('AppSheet HTTP ' + res.code + ': ' + res.text.slice(0, 500) + hint);
    }

    if (!res.json) {
      Logger.log('La respuesta no es JSON válido (primeros 400 caracteres): ' + res.text.substring(0, 400));
      throw new Error('AppSheet devolvió cuerpo no JSON. HTTP ' + res.code);
    }

    const rows = extractRowsFromAppSheetJson_(res.json);
    Logger.log('  → filas extraídas: ' + rows.length);

    if (rows.length > 0) {
      return rows;
    }

    Logger.log('  → claves en JSON: ' + JSON.stringify(Object.keys(res.json)));
  }

  Logger.log(
    'DIAGNÓSTICO: Todos los intentos devolvieron 0 filas. Muestra del cuerpo (max 1200 chars):\n' +
      lastText.substring(0, 1200)
  );
  Logger.log(
    'Si la app tiene datos: (1) Verifica TABLE_NAME = nombre exacto en Data → Tables. ' +
      '(2) Activa CONFIG.RUN_AS_USER_EMAIL con un usuario que vea la tabla (Security filter / USEREMAIL()). ' +
      '(3) Prueba en Postman el mismo Find y revisa Security filters de ' +
      CONFIG.TABLE_NAME +
      '.'
  );

  return [];
}

/**
 * Extrae id de fila AppSheet (misma lógica que el mapa de estado).
 */
function intakeRowId_(row) {
  if (row.id != null && row.id !== '') return String(row.id).trim();
  if (row.ID != null && row.ID !== '') return String(row.ID).trim();
  if (row._RowNumber != null) return String(row._RowNumber).trim();
  return '';
}

/**
 * Primer valor no vacío de la fila para una lista de nombres de columna AppSheet.
 */
function rowValueFirstKey_(row, keyNames) {
  for (let i = 0; i < keyNames.length; i++) {
    const k = keyNames[i];
    if (!k || !Object.prototype.hasOwnProperty.call(row, k)) continue;
    const v = row[k];
    if (v != null && String(v).trim() !== '') return v;
  }
  for (let j = 0; j < keyNames.length; j++) {
    const k2 = keyNames[j];
    if (k2 && Object.prototype.hasOwnProperty.call(row, k2)) return row[k2];
  }
  return null;
}

/**
 * Convierte el valor de "Vencimiento tramite" de AppSheet a algo que Sheets entienda como fecha.
 * Vacío → '' (celda en blanco).
 */
function parseVencimientoForSheetCell_(raw) {
  if (raw == null || raw === '') return '';
  if (Object.prototype.toString.call(raw) === '[object Date]' && !isNaN(raw.getTime())) return raw;
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    return new Date((raw - 25569) * 86400 * 1000);
  }
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d;
  return String(raw).trim();
}

function dueCellsContentEqual_(a, b) {
  const na = normalizeDueForCompareDay_(a);
  const nb = normalizeDueForCompareDay_(b);
  return na === nb;
}

/** Misma fecha calendario (zona del script) → evita reescribir por desfase UTC vs celda. */
function normalizeDueForCompareDay_(v) {
  if (v == null || v === '') return '';
  const d = Object.prototype.toString.call(v) === '[object Date]' ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v).trim();
  const tz = Session.getScriptTimeZone() || 'America/Guayaquil';
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

/**
 * Mapas id -> Status (string) e id -> valor bruto de vencimiento (luego parseVencimientoForSheetCell_).
 */
function mapStatusAndVencimientoById_(appRows) {
  const statusById = {};
  const vencimientoById = {};
  const statusKey = CONFIG.COLUMNA_STATUS_APPSHEET;
  const venKeys = [];
  const mainVen = (CONFIG.COLUMNA_VENCIMIENTO_APPSHEET || '').trim();
  if (mainVen) venKeys.push(mainVen);
  (CONFIG.COLUMNA_VENCIMIENTO_APPSHEET_ALIASES || []).forEach(function (a) {
    const t = String(a || '').trim();
    if (t && venKeys.indexOf(t) === -1) venKeys.push(t);
  });

  appRows.forEach(function (row) {
    const id = intakeRowId_(row);
    if (!id) return;

    const st = row[statusKey];
    statusById[id] = st == null ? '' : String(st).trim();

    const rawVen = rowValueFirstKey_(row, venKeys);
    vencimientoById[id] = rawVen;
  });

  return { statusById: statusById, vencimientoById: vencimientoById };
}

/**
 * Convierte un índice de columna 1-based a letra (1=A, 2=B, 27=AA, ...).
 */
function columnIndexToLetter_(idx) {
  let s = '';
  let n = idx;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Busca la columna cuyo encabezado (fila CONFIG.FILA_ENCABEZADO) coincida con alguno
 * de los nombres aceptados (case-insensitive, sin espacios). Devuelve la LETRA o null.
 */
function findColumnLetterByHeader_(sheet, headerNames) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return null;
  const headers = sheet
    .getRange(CONFIG.FILA_ENCABEZADO, 1, 1, lastCol)
    .getValues()[0];
  const normalized = headerNames.map(function (n) {
    return String(n || '').trim().toLowerCase();
  });
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').trim().toLowerCase();
    if (!h) continue;
    if (normalized.indexOf(h) !== -1) {
      return columnIndexToLetter_(i + 1);
    }
  }
  return null;
}

/**
 * Resuelve las letras de columnas para ID, ESTADO y Result.
 * Escritura bloqueada por seguridad:
 *   - ESTADO_ACTUAL siempre en CONFIG.COLUMNA_ESTADO_OBJETIVO (CE)
 *   - Result siempre en CONFIG.COLUMNA_RESULT_OBJETIVO (BA)
 * No se usa detección automática para columnas de escritura.
 */
function resolveColumnLetters_(sheet) {
  const idFromHeader = findColumnLetterByHeader_(sheet, CONFIG.NOMBRES_ENCABEZADO_ID || []);

  const idLetter = idFromHeader || CONFIG.COLUMNA_ID_EN_HOJA_FALLBACK;
  const estadoLetter = (CONFIG.COLUMNA_ESTADO_OBJETIVO || '').trim();
  const resultLetter = (CONFIG.COLUMNA_RESULT_OBJETIVO || '').trim();

  if (!idFromHeader) {
    Logger.log(
      '⚠ No encontré la columna ID por encabezado (' +
        (CONFIG.NOMBRES_ENCABEZADO_ID || []).join(', ') +
        '). Uso fallback ' +
        CONFIG.COLUMNA_ID_EN_HOJA_FALLBACK +
        '.'
    );
  } else {
    Logger.log('Columna ID detectada por encabezado: ' + idLetter);
  }

  if (!estadoLetter) {
    throw new Error('CONFIG.COLUMNA_ESTADO_OBJETIVO está vacía. Debe ser CE.');
  }
  Logger.log('Columna ESTADO_ACTUAL bloqueada por configuración: ' + estadoLetter);

  if (!resultLetter) {
    throw new Error('CONFIG.COLUMNA_RESULT_OBJETIVO está vacía. Debe ser BA.');
  }
  Logger.log('Columna Result bloqueada por configuración: ' + resultLetter);

  return { idLetter: idLetter, estadoLetter: estadoLetter, resultLetter: resultLetter };
}

/**
 * Sincronización principal: lee AppSheet, recorre la hoja por ID y escribe ESTADO_ACTUAL y Result.
 */
function syncEstadoDesdeAppSheet() {
  assertConfigFilled_();
  const appRows = fetchRowsFromAppSheet_();
  Logger.log('Filas en response.Rows (AppSheet): ' + appRows.length);

  const maps = mapStatusAndVencimientoById_(appRows);
  const statusById = maps.statusById;
  const vencimientoById = maps.vencimientoById;
  Logger.log('IDs únicos con Status en mapa: ' + Object.keys(statusById).length);

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sh = ss.getSheetByName(CONFIG.NOMBRE_HOJA);
  if (!sh) throw new Error('No existe la hoja: ' + CONFIG.NOMBRE_HOJA);

  const lastRow = sh.getLastRow();
  if (lastRow <= CONFIG.FILA_ENCABEZADO) {
    Logger.log('No hay datos debajo del encabezado.');
    return;
  }

  const cols = resolveColumnLetters_(sh);
  const idCol = cols.idLetter;
  const estadoCol = cols.estadoLetter;
  const resultCol = cols.resultLetter;

  const startRow = CONFIG.FILA_ENCABEZADO + 1;
  const numRows = lastRow - CONFIG.FILA_ENCABEZADO;
  const idRange = sh.getRange(idCol + startRow + ':' + idCol + lastRow);
  const estadoRange = sh.getRange(estadoCol + startRow + ':' + estadoCol + lastRow);

  const ids = idRange.getValues();
  const estadosActuales = estadoRange.getValues();

  let resultRange = null;
  let resultActuales = [];
  if (resultCol) {
    resultRange = sh.getRange(resultCol + startRow + ':' + resultCol + lastRow);
    resultActuales = resultRange.getValues();
  }

  let matched = 0;
  let written = 0;
  let unchanged = 0;
  let writtenResult = 0;
  let unchangedResult = 0;
  let notInAppSheet = 0;
  const out = [];
  const outResult = [];

  for (let i = 0; i < numRows; i++) {
    const rawId = ids[i][0];
    const id = rawId == null || rawId === '' ? '' : String(rawId).trim();
    const prev = estadosActuales[i][0] == null ? '' : String(estadosActuales[i][0]).trim();
    const prevResult = resultCol && resultActuales[i] ? resultActuales[i][0] : null;

    if (!id) {
      out.push([prev]);
      if (resultCol) outResult.push([prevResult]);
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(statusById, id)) {
      notInAppSheet++;
      out.push([prev]);
      if (resultCol) outResult.push([prevResult]);
      continue;
    }

    matched++;
    const nuevo = statusById[id];
    if (nuevo !== prev) {
      written++;
      out.push([nuevo]);
    } else {
      unchanged++;
      out.push([prev]);
    }

    if (resultCol) {
      const rawVen = Object.prototype.hasOwnProperty.call(vencimientoById, id) ? vencimientoById[id] : null;
      const nuevoResult = parseVencimientoForSheetCell_(rawVen);
      if (dueCellsContentEqual_(prevResult, nuevoResult)) {
        unchangedResult++;
        outResult.push([prevResult]);
      } else {
        writtenResult++;
        outResult.push([nuevoResult]);
      }
    }
  }

  estadoRange.setValues(out);
  if (resultCol && resultRange && outResult.length === numRows) {
    resultRange.setValues(outResult);
  }

  Logger.log(
    'Columnas usadas → ID: ' + idCol + ' | ESTADO_ACTUAL: ' + estadoCol + (resultCol ? ' | Result: ' + resultCol : ' | Result: (omitido)')
  );
  Logger.log('Filas en hoja (rango ID): ' + numRows);
  Logger.log('Coincidencias ID AppSheet↔hoja: ' + matched);
  Logger.log('ESTADO_ACTUAL — escrituras: ' + written + ' | sin cambio: ' + unchanged);
  if (resultCol) Logger.log('Result — escrituras: ' + writtenResult + ' | sin cambio: ' + unchangedResult);
  Logger.log('ID en hoja sin match en AppSheet: ' + notInAppSheet);
}

/**
 * Ejecuta una vez syncEstadoDesdeAppSheet y deja el detalle en Registro de ejecución.
 * Si "escrituras" << "Filas en response.Rows", revisa:
 * - COLUMNA_ID_EN_HOJA debe ser la misma clave que usa el dashboard (campo `id`).
 * - COLUMNA_STATUS_APPSHEET debe coincidir exactamente con el nombre en AppSheet.
 * - Si muchas filas quedan "sin cambio", el script está bien: ya estaban sincronizadas.
 */
function ejecutarSyncConDiagnostico() {
  syncEstadoDesdeAppSheet();
}

/**
 * Helpers para (re)programar el disparador sin entrar a la UI.
 * Ejecuta UNA vez la función deseada. Elimina cualquier disparador previo de
 * syncEstadoDesdeAppSheet y crea uno nuevo con la frecuencia indicada.
 *
 * - configurarTriggerCada5Min: recomendado para tráfico normal.
 * - configurarTriggerCada10Min: aún más conservador, ideal si ves errores de cuota.
 * - eliminarTriggers: borra todos los disparadores de la función (útil al depurar).
 */
function configurarTriggerCada5Min() {
  reemplazarTriggerMinutos_(5);
}

function configurarTriggerCada10Min() {
  reemplazarTriggerMinutos_(10);
}

function eliminarTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === 'syncEstadoDesdeAppSheet') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  Logger.log('Disparadores eliminados: ' + removed);
}

function reemplazarTriggerMinutos_(minutos) {
  eliminarTriggers();
  ScriptApp.newTrigger('syncEstadoDesdeAppSheet')
    .timeBased()
    .everyMinutes(minutos)
    .create();
  Logger.log('✓ Disparador creado: syncEstadoDesdeAppSheet cada ' + minutos + ' minutos.');
}
