(() => {
  'use strict';

  const STORAGE_KEY = 'railtimeline.web.poc1.state.v1';
  const DB_NAME = 'RailTimelineWebPOC';
  const DB_VERSION = 1;
  const branches = Array.from({ length: 16 }, (_, i) => String(807 + i));
  const lzbBranches = new Set(['813', '814', '818', '820', '821', '822']);

  const defaultPreparation = () => ({
    routeTemplateId: '',
    routeQuery: '',
    journeyStartPointId: '',
    journeyEndPointId: '',
    unitMode: 'US',
    headBranch: '807',
    tailBranch: '808',
    motorPosition: 'M1',
    passengerTotal: '',
    assistanceTotal: '',
    initialNote: '',
  });

  const defaultState = () => ({
    screen: 'home',
    preparation: defaultPreparation(),
    active: null,
    history: [],
    knowledge: [],
    documents: { lim: null, dhltv: null },
  });

  let state = loadState();
  let catalog = window.RT_DEFAULT_CATALOG;
  const pkReference = window.RT_PK_REFERENCE || {};
  let gps = { watchId: null, status: 'off', position: null, match: null, error: '' };
  let toastTimer = null;
  let currentObjectUrl = null;

  const main = document.getElementById('main');
  const toast = document.getElementById('toast');
  const modalRoot = document.getElementById('modal-root');
  const railPosition = document.getElementById('rail-position');

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return {
        ...defaultState(),
        ...parsed,
        preparation: { ...defaultPreparation(), ...(parsed.preparation || {}) },
        documents: { lim: null, dhltv: null, ...(parsed.documents || {}) },
      };
    } catch (_) {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB no disponible'));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB'));
    });
  }

  async function idbPut(key, value) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  async function idbGet(key) {
    const db = await openDb();
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const req = tx.objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return value;
  }

  async function idbDelete(key) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  async function init() {
    try {
      const custom = await idbGet('customCatalog');
      if (custom && Array.isArray(custom.routes)) catalog = custom;
    } catch (_) {
      // La POC sigue siendo funcional sin IndexedDB; solo se pierde persistencia binaria.
    }
    bindGlobalEvents();
    updateClock();
    setInterval(updateClock, 1000);
    updateGpsHeader();
    render();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  function bindGlobalEvents() {
    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.addEventListener('click', () => navigate(btn.dataset.nav));
    });
    main.addEventListener('click', onMainClick);
    main.addEventListener('change', onMainChange);
    main.addEventListener('input', onMainInput);

    document.getElementById('catalog-file').addEventListener('change', handleCatalogFile);
    document.getElementById('knowledge-file').addEventListener('change', handleKnowledgeFile);
    document.getElementById('lim-file').addEventListener('change', e => handlePdfFile('lim', e));
    document.getElementById('dhltv-file').addEventListener('change', e => handlePdfFile('dhltv', e));
  }

  function navigate(screen) {
    state.screen = screen;
    saveState();
    render();
  }

  function render() {
    document.querySelectorAll('.nav-button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.nav === state.screen);
    });
    switch (state.screen) {
      case 'prepare': main.innerHTML = renderPreparation(); break;
      case 'ebula': main.innerHTML = renderEbula(); break;
      case 'knowledge': main.innerHTML = renderKnowledge(); break;
      case 'history': main.innerHTML = renderHistory(); break;
      case 'data': main.innerHTML = renderData(); break;
      default: main.innerHTML = renderHome(); break;
    }
  }

  function renderHome() {
    const active = state.active;
    const custom = catalog !== window.RT_DEFAULT_CATALOG;
    return `
      <section class="page">
        <div class="hero">
          <span class="poc-pill">PRUEBA DE CONCEPTO · LOCAL-FIRST</span>
          <h1>RailTimeline en el navegador</h1>
          <p>Primera prueba funcional basada en la beta91: catálogo real, preparación de servicio, eBuLa navegable, GPS→PK, Habilitación, PDFs locales e histórico. Todo se ejecuta en el navegador; esta POC no envía datos a ningún servidor.</p>
          <div class="actions">
            ${active ? `<button class="btn primary" data-action="resume-service">CONTINUAR SURCO ${esc(active.trainNumber)}</button>` : `<button class="btn primary" data-action="new-service">NUEVO SERVICIO</button>`}
            <button class="btn tonal" data-nav-inline="data">VER DATOS LOCALES</button>
          </div>
        </div>

        <div class="grid three">
          <div class="card"><div class="metric"><strong>${catalog.routes.length}</strong><span>recorridos<br>${custom ? 'catálogo importado' : 'catálogo beta91'}</span></div></div>
          <div class="card"><div class="metric"><strong>${state.history.length}</strong><span>servicios<br>guardados localmente</span></div></div>
          <div class="card"><div class="metric"><strong>${Object.values(pkReference).reduce((n,v)=>n+v.length,0)}</strong><span>referencias PK<br>IDEAdif offline</span></div></div>
        </div>

        <div class="grid two" style="margin-top:14px">
          <div class="card primary">
            <h2>Flujo ya operativo en esta POC</h2>
            <div class="note-list">
              <div class="note"><strong>1 · Preparación</strong><div class="help">Busca un surco real del RTLim, define trayecto, US/UM, ramas y documentos.</div></div>
              <div class="note"><strong>2 · eBuLa</strong><div class="help">Construye la secuencia con hitos y cambios de velocidad del catálogo. Puedes confirmar pasos o alinear la fila con el PK GPS.</div></div>
              <div class="note"><strong>3 · Persistencia local</strong><div class="help">Estado e histórico en LocalStorage; PDFs y catálogo personalizado en IndexedDB.</div></div>
            </div>
          </div>
          <div class="card accent">
            <h2>Qué quiero validar con este primer test</h2>
            <p class="help">Que una futura RailTimeline Web puede ser una PWA sin servidor de aplicación: HTML/JS estático en cualquier hosting, datos operativos almacenados en la tablet y GPS del propio navegador. En esta fase no intento replicar todavía el parser PDF de Android ni la lógica completa de servicio.</p>
            <div class="divider"></div>
            <div class="actions">
              <button class="btn good" data-action="gps-start">ACTIVAR GPS</button>
              <button class="btn" data-nav-inline="knowledge">PROBAR HABILITACIÓN</button>
            </div>
          </div>
        </div>
      </section>`;
  }

  function renderPreparation() {
    const prep = state.preparation;
    const route = getRoute(prep.routeTemplateId);
    const points = route?.points || [];
    const startId = prep.journeyStartPointId || points[0]?.id || '';
    const endId = prep.journeyEndPointId || points.at(-1)?.id || '';
    return `
      <section class="page">
        <div class="page-title-row">
          <div><h1>Preparación</h1><div class="subtle">Configuración del servicio · los cambios se guardan en este navegador</div></div>
          <div class="actions"><button class="btn" data-action="clear-prep">LIMPIAR</button><button class="btn primary" data-action="start-service" ${route ? '' : 'disabled'}>INICIAR SERVICIO</button></div>
        </div>

        <div class="grid two">
          <div class="card">
            <h2>Información general</h2>
            <label class="field">Buscar surco, origen o destino
              <input id="route-search" autocomplete="off" value="${escAttr(prep.routeQuery || route?.trainNumber || '')}" placeholder="Ej. 6472, Chamartín, Valencia…" />
            </label>
            <div id="route-results" class="route-results">${renderRouteResults(prep.routeQuery || route?.trainNumber || '')}</div>
            ${route ? `
              <div class="divider"></div>
              <div class="kv">
                <dt>Surco</dt><dd><strong>${esc(route.trainNumber)}</strong></dd>
                <dt>Recorrido</dt><dd>${esc(route.origin)} → ${esc(route.destination)}</dd>
                <dt>Líneas</dt><dd>${route.headerLines.map(x=>`<span class="badge">L${esc(x)}</span>`).join(' ')}</dd>
                <dt>Hitos</dt><dd>${route.points.length}</dd>
              </div>` : `<p class="help" style="margin-top:12px">Selecciona uno de los recorridos del catálogo real incluido en beta91.</p>`}
          </div>

          <div class="card">
            <h2>Trayecto y composición</h2>
            <div class="form-grid">
              <label class="field">Origen del trayecto
                <select data-field="journeyStartPointId" ${route ? '' : 'disabled'}>${points.map(p=>`<option value="${escAttr(p.id)}" ${p.id===startId?'selected':''}>${esc(p.name)} · ${fmtPk(p.kilometer)}</option>`).join('')}</select>
              </label>
              <label class="field">Destino del trayecto
                <select data-field="journeyEndPointId" ${route ? '' : 'disabled'}>${points.map(p=>`<option value="${escAttr(p.id)}" ${p.id===endId?'selected':''}>${esc(p.name)} · ${fmtPk(p.kilometer)}</option>`).join('')}</select>
              </label>
              <label class="field">Unidad
                <div class="segmented"><button data-segment="unitMode" data-value="US" class="${prep.unitMode==='US'?'active':''}">US</button><button data-segment="unitMode" data-value="UM" class="${prep.unitMode==='UM'?'active':''}">UM</button></div>
              </label>
              <label class="field">Posición motor
                <div class="segmented"><button data-segment="motorPosition" data-value="M1" class="${prep.motorPosition==='M1'?'active':''}">M1</button><button data-segment="motorPosition" data-value="M2" class="${prep.motorPosition==='M2'?'active':''}">M2</button></div>
              </label>
              <label class="field">Rama cabeza
                <select data-field="headBranch">${branches.map(b=>`<option value="${b}" ${b===prep.headBranch?'selected':''}>${b}${lzbBranches.has(b)?' · LZB':''}</option>`).join('')}</select>
              </label>
              <label class="field">Rama cola ${prep.unitMode==='UM'?'':'(no usada en US)'}
                <select data-field="tailBranch" ${prep.unitMode==='UM'?'':'disabled'}>${branches.map(b=>`<option value="${b}" ${b===prep.tailBranch?'selected':''}>${b}${lzbBranches.has(b)?' · LZB':''}</option>`).join('')}</select>
              </label>
              <label class="field">Viajeros<input data-field="passengerTotal" inputmode="numeric" value="${escAttr(prep.passengerTotal)}" placeholder="Opcional" /></label>
              <label class="field">Asistencias<input data-field="assistanceTotal" inputmode="numeric" value="${escAttr(prep.assistanceTotal)}" placeholder="Opcional" /></label>
            </div>
          </div>
        </div>

        <div class="grid two" style="margin-top:14px">
          <div class="card">
            <h2>Documentos locales</h2>
            <div class="note-list">
              ${documentRow('lim','LIM',state.documents.lim)}
              ${documentRow('dhltv','DHLTV',state.documents.dhltv)}
            </div>
            <p class="help" style="margin-top:12px">En esta POC el PDF se guarda como Blob en IndexedDB. Cierra y vuelve a abrir el navegador: seguirá disponible sin subirlo a ningún sitio.</p>
          </div>
          <div class="card">
            <h2>Observaciones iniciales</h2>
            <label class="field">Nota<textarea data-field="initialNote" placeholder="Observaciones del servicio…">${esc(prep.initialNote)}</textarea></label>
            ${route ? `<div class="divider"></div><span class="badge ${route.warnings?.length?'warn':'good'}">${route.warnings?.length ? `${route.warnings.length} avisos de catálogo` : 'Ruta sin avisos de catálogo'}</span>` : ''}
          </div>
        </div>
      </section>`;
  }

  function renderRouteResults(query) {
    const q = normalize(query);
    const selected = state.preparation.routeTemplateId;
    const routes = catalog.routes
      .filter(r => !q || normalize(`${r.trainNumber} ${r.origin} ${r.destination}`).includes(q))
      .slice(0, 24);
    if (!routes.length) return `<div class="empty" style="min-height:90px;border:0">No hay coincidencias.</div>`;
    return routes.map(r => `
      <button class="route-row ${r.id===selected?'selected':''}" data-action="select-route" data-route-id="${escAttr(r.id)}">
        <strong>${esc(r.trainNumber)}</strong><span>${esc(r.origin)} → ${esc(r.destination)}</span><small>${r.headerLines.map(x=>'L'+x).join(' · ')}</small>
      </button>`).join('');
  }

  function documentRow(kind, label, meta) {
    return `<div class="note"><div class="note-head"><div><strong>${label}</strong><div class="help">${meta ? esc(meta.name) : 'No cargado'}</div></div><span class="badge ${meta?'good':''}">${meta?'LOCAL':'VACÍO'}</span></div><div class="actions"><button class="btn" data-action="pick-pdf" data-kind="${kind}">${meta?'SUSTITUIR':'CARGAR PDF'}</button>${meta?`<button class="btn tonal" data-action="open-pdf" data-kind="${kind}">ABRIR</button><button class="btn danger" data-action="remove-pdf" data-kind="${kind}">QUITAR</button>`:''}</div></div>`;
  }

  function renderEbula() {
    if (!state.active) return emptyPage('eBuLa', 'No hay ningún servicio activo.', `<button class="btn primary" data-action="new-service">PREPARAR SERVICIO</button>`);
    const route = getRoute(state.active.routeId);
    if (!route) return emptyPage('eBuLa', 'El recorrido activo no existe en el catálogo actual.', '');
    const timeline = buildTimeline(route, state.active.preparation);
    const index = clamp(state.active.currentIndex || 0, 0, Math.max(0, timeline.length - 1));
    const current = timeline[index];
    const next = timeline.slice(index + 1, index + 4);
    return `
      <section class="page">
        <div class="page-title-row">
          <div><h1>eBuLa · Surco ${esc(route.trainNumber)}</h1><div class="subtle">${esc(route.origin)} → ${esc(route.destination)} · ${timeline.length} elementos</div></div>
          <div class="actions"><button class="btn" data-action="gps-start">${gps.watchId===null?'ACTIVAR GPS':'GPS ACTIVO'}</button><button class="btn danger" data-action="finish-service">FINALIZAR</button></div>
        </div>
        <div class="timeline-shell">
          <div class="card" style="padding:0;overflow:auto;max-height:calc(100vh - 150px)">
            <table class="ebula-table">
              <thead><tr><th>#</th><th>PK</th><th>Hito / indicación</th><th>Hora</th><th>V</th><th>Línea</th></tr></thead>
              <tbody>${timeline.map((item,i)=>renderTimelineRow(item,i,index)).join('')}</tbody>
            </table>
          </div>
          <aside>
            <div class="current-box">
              <div class="eyebrow">Posición eBuLa ${index+1}/${timeline.length}</div>
              <div class="current-name">${esc(current?.label || '—')}</div>
              <div class="subtle">${current ? `${fmtPk(current.pk)} · ${current.line ? 'L'+current.line : 'sin línea'}` : ''}</div>
              <div class="actions" style="margin-top:12px"><button class="btn" data-action="timeline-prev" ${index===0?'disabled':''}>←</button><button class="btn primary" data-action="timeline-next" ${index>=timeline.length-1?'disabled':''}>CONFIRMAR PASO →</button></div>
              <div class="next-list">${next.map((n,j)=>`<div class="next-item"><small>+${j+1} · ${fmtPk(n.pk)}</small><strong>${esc(n.label)}</strong></div>`).join('') || '<div class="next-item">Fin de recorrido</div>'}</div>
            </div>
            <div id="gps-panel" class="card" style="margin-top:12px">${renderGpsPanelHtml(route,timeline)}</div>
            <div class="card" style="margin-top:12px">
              <h3>Documentos</h3>
              <div class="actions">${state.documents.lim?'<button class="btn" data-action="open-pdf" data-kind="lim">LIM</button>':''}${state.documents.dhltv?'<button class="btn" data-action="open-pdf" data-kind="dhltv">DHLTV</button>':''}${(!state.documents.lim&&!state.documents.dhltv)?'<span class="help">Sin PDFs cargados.</span>':''}</div>
            </div>
          </aside>
        </div>
      </section>`;
  }

  function renderTimelineRow(item, i, currentIndex) {
    const cls = `${item.type==='speed'?'speed ':''}${i<currentIndex?'past ':''}${i===currentIndex?'current':''}`;
    const time = item.time ? item.time.slice(0,5) : '—';
    return `<tr class="${cls}" data-action="timeline-set" data-index="${i}" title="Seleccionar esta fila"><td>${i+1}</td><td class="pk">${fmtPk(item.pk)}</td><td>${esc(item.label)}</td><td>${esc(time)}</td><td>${item.speed ? `<span class="speed-chip">${item.speed}</span>` : '—'}</td><td>${item.line ? 'L'+esc(item.line) : '—'}</td></tr>`;
  }

  function renderGpsPanelHtml(route, timeline) {
    const pos = gps.position;
    const match = gps.match;
    const supported = 'geolocation' in navigator;
    const status = !supported ? 'No disponible' : gps.status === 'error' ? gps.error : gps.watchId === null ? 'Desconectado' : 'Recibiendo posición';
    const speed = pos?.coords?.speed == null ? '—' : `${Math.max(0,pos.coords.speed*3.6).toFixed(1)} km/h`;
    const accuracy = pos?.coords?.accuracy == null ? '—' : `±${Math.round(pos.coords.accuracy)} m`;
    return `<h3>GPS / PK</h3><div class="subtle">${esc(status)}</div>
      <div class="gps-details">
        <div><small>PK calculado</small><strong>${match ? `L${match.line} · ${fmtPk(match.pk)}` : '—'}</strong></div>
        <div><small>Distancia ref.</small><strong>${match ? `${Math.round(match.distance)} m` : '—'}</strong></div>
        <div><small>Velocidad GPS</small><strong>${speed}</strong></div>
        <div><small>Precisión GNSS</small><strong>${accuracy}</strong></div>
      </div>
      <div class="actions" style="margin-top:10px"><button class="btn good" data-action="gps-start" ${!supported?'disabled':''}>${gps.watchId===null?'CONECTAR':'REINICIAR'}</button><button class="btn tonal" data-action="gps-align" ${match?'':'disabled'}>ALINEAR eBuLa</button></div>
      <p class="help" style="margin:10px 0 0">La POC busca el punto IDEAdif más cercano únicamente entre las líneas del recorrido (${route.headerLines.map(x=>'L'+x).join(', ')}). Aún no aplica la fusión avanzada GNSS + velocidad + hitos de Android.</p>`;
  }

  function renderKnowledge() {
    const activeRoute = state.active ? getRoute(state.active.routeId) : getRoute(state.preparation.routeTemplateId);
    const routeKeys = activeRoute ? new Set(activeRoute.points.map(p => knowledgeKey(p.name))) : null;
    const query = state.knowledgeQuery || '';
    const q = normalize(query);
    const notes = state.knowledge.filter(n => (!routeKeys || routeKeys.has(knowledgeKey(n.Name))) && (!q || normalize(`${n.Name} ${n.Content}`).includes(q)));
    return `
      <section class="page">
        <div class="page-title-row"><div><h1>Habilitación</h1><div class="subtle">Formato oficial .rtkb.json · almacenado solo en este navegador</div></div><button class="btn primary" data-action="pick-knowledge">IMPORTAR HABILITACIÓN</button></div>
        <div class="grid two">
          <div class="card">
            <h2>Consulta</h2>
            <label class="field">Buscar dependencia<input id="knowledge-search" value="${escAttr(query)}" placeholder="Bifurcación, estación, taller…" /></label>
            <div class="divider"></div>
            <div class="kv"><dt>Notas cargadas</dt><dd>${state.knowledge.length}</dd><dt>Filtro de recorrido</dt><dd>${activeRoute ? `Surco ${esc(activeRoute.trainNumber)} · ${esc(activeRoute.origin)} → ${esc(activeRoute.destination)}` : 'Ninguno · mostrando toda la base'}</dd></div>
          </div>
          <div class="card accent"><h2>Comportamiento web</h2><p class="help">El mismo JSON generado por RailTimeline Utils puede importarse desde el navegador. En una PWA definitiva se puede vincular automáticamente la dependencia correspondiente al PK/hito actual, igual que en Android.</p></div>
        </div>
        <div id="knowledge-results" class="note-list" style="margin-top:14px">${renderKnowledgeResults(notes)}</div>
      </section>`;
  }

  function renderKnowledgeResults(notes) {
    if (!state.knowledge.length) return `<div class="empty"><div><strong>No hay base de Habilitación cargada.</strong><p class="help">Importa un fichero <span class="code">habilitacion.rtkb.json</span> para probar la consulta.</p></div></div>`;
    if (!notes.length) return `<div class="empty">No hay notas que coincidan con el filtro actual.</div>`;
    return notes.slice(0,100).map(n => `<article class="note"><div class="note-head"><strong>${esc(n.Name)}</strong><span class="badge primary">HABILITACIÓN</span></div><pre>${esc(n.Content)}</pre></article>`).join('');
  }

  function renderHistory() {
    return `
      <section class="page">
        <div class="page-title-row"><div><h1>Histórico</h1><div class="subtle">Servicios de esta POC almacenados en LocalStorage</div></div></div>
        <div class="card" style="padding:0">${state.history.length ? state.history.map(h => `<div class="history-row"><strong>${formatDate(h.startedAt)}</strong><span class="badge primary">${esc(h.trainNumber)}</span><div>${esc(h.origin)} → ${esc(h.destination)}<div class="help">${formatDateTime(h.startedAt)} — ${formatDateTime(h.finishedAt)}</div></div><span class="badge good">FINALIZADO</span></div>`).join('') : `<div class="empty" style="border:0">Todavía no has finalizado ningún servicio en la POC.</div>`}</div>
      </section>`;
  }

  function renderData() {
    const custom = catalog !== window.RT_DEFAULT_CATALOG;
    const secure = window.isSecureContext;
    const sw = 'serviceWorker' in navigator;
    return `
      <section class="page">
        <div class="page-title-row"><div><h1>Datos y almacenamiento</h1><div class="subtle">Prueba de arquitectura sin backend</div></div></div>
        <div class="grid two">
          <div class="card">
            <h2>Catálogo LIM</h2>
            <div class="kv"><dt>Origen</dt><dd>${custom?'Importado en navegador':'default.rtlim.json · beta91'}</dd><dt>Recorridos</dt><dd>${catalog.routes.length}</dd><dt>Schema</dt><dd>${esc(String(catalog.schemaVersion ?? '—'))}</dd><dt>Catalog ID</dt><dd class="code">${esc(catalog.catalogId || '—')}</dd></div>
            <div class="actions" style="margin-top:14px"><button class="btn primary" data-action="pick-catalog">IMPORTAR .RTLIM.JSON</button>${custom?'<button class="btn danger" data-action="restore-catalog">VOLVER AL INCLUIDO</button>':''}</div>
          </div>
          <div class="card">
            <h2>Capacidades del navegador</h2>
            <div class="kv"><dt>Contexto seguro</dt><dd><span class="badge ${secure?'good':'warn'}">${secure?'SÍ':'NO'}</span></dd><dt>Geolocation API</dt><dd>${'geolocation' in navigator?'Disponible':'No disponible'}</dd><dt>IndexedDB</dt><dd>${'indexedDB' in window?'Disponible':'No disponible'}</dd><dt>Service Worker</dt><dd>${sw?'Disponible':'No disponible'}</dd><dt>Modo</dt><dd>${location.protocol === 'file:' ? 'Archivo local · GPS/PWA limitados' : 'HTTP/HTTPS · recomendado'}</dd></div>
          </div>
        </div>
        <div class="grid two" style="margin-top:14px">
          <div class="card">
            <h2>Documentos en IndexedDB</h2>
            ${documentRow('lim','LIM',state.documents.lim)}<div style="height:9px"></div>${documentRow('dhltv','DHLTV',state.documents.dhltv)}
          </div>
          <div class="card accent">
            <h2>Privacidad de esta POC</h2>
            <p class="help">No contiene llamadas de red ni analítica. El hosting solo serviría los ficheros estáticos de la aplicación. El catálogo, la configuración, el histórico, los PDFs y la Habilitación viven en el almacenamiento del navegador de cada tablet.</p>
            <div class="divider"></div>
            <button class="btn danger" data-action="reset-all">BORRAR DATOS DE LA POC</button>
          </div>
        </div>
      </section>`;
  }

  function emptyPage(title, text, actions) {
    return `<section class="page"><div class="page-title-row"><div><h1>${esc(title)}</h1></div></div><div class="empty"><div><strong>${esc(text)}</strong><div class="actions" style="justify-content:center;margin-top:15px">${actions}</div></div></div></section>`;
  }

  async function onMainClick(event) {
    const nav = event.target.closest('[data-nav-inline]');
    if (nav) return navigate(nav.dataset.navInline);
    const el = event.target.closest('[data-action],[data-segment]');
    if (!el) return;

    if (el.dataset.segment) {
      state.preparation[el.dataset.segment] = el.dataset.value;
      saveState();
      render();
      return;
    }

    const action = el.dataset.action;
    switch (action) {
      case 'new-service': state.preparation = defaultPreparation(); saveState(); navigate('prepare'); break;
      case 'resume-service': navigate('ebula'); break;
      case 'clear-prep': state.preparation = defaultPreparation(); saveState(); render(); break;
      case 'select-route': selectRoute(el.dataset.routeId); break;
      case 'start-service': startService(); break;
      case 'timeline-prev': moveTimeline(-1); break;
      case 'timeline-next': moveTimeline(1); break;
      case 'timeline-set': setTimelineIndex(Number(el.dataset.index)); break;
      case 'finish-service': finishService(); break;
      case 'gps-start': startGps(); break;
      case 'gps-align': alignTimelineToGps(); break;
      case 'pick-catalog': document.getElementById('catalog-file').click(); break;
      case 'restore-catalog': await restoreDefaultCatalog(); break;
      case 'pick-knowledge': document.getElementById('knowledge-file').click(); break;
      case 'pick-pdf': document.getElementById(`${el.dataset.kind}-file`).click(); break;
      case 'open-pdf': await openPdf(el.dataset.kind); break;
      case 'remove-pdf': await removePdf(el.dataset.kind); break;
      case 'reset-all': await resetAll(); break;
    }
  }

  function onMainChange(event) {
    const field = event.target.dataset.field;
    if (!field) return;
    state.preparation[field] = event.target.value;
    saveState();
  }

  function onMainInput(event) {
    if (event.target.id === 'route-search') {
      state.preparation.routeQuery = event.target.value;
      saveState();
      const box = document.getElementById('route-results');
      if (box) box.innerHTML = renderRouteResults(event.target.value);
      return;
    }
    if (event.target.id === 'knowledge-search') {
      state.knowledgeQuery = event.target.value;
      saveState();
      const activeRoute = state.active ? getRoute(state.active.routeId) : getRoute(state.preparation.routeTemplateId);
      const routeKeys = activeRoute ? new Set(activeRoute.points.map(p=>knowledgeKey(p.name))) : null;
      const q = normalize(event.target.value);
      const notes = state.knowledge.filter(n => (!routeKeys || routeKeys.has(knowledgeKey(n.Name))) && (!q || normalize(`${n.Name} ${n.Content}`).includes(q)));
      const box = document.getElementById('knowledge-results');
      if (box) box.innerHTML = renderKnowledgeResults(notes);
      return;
    }
    const field = event.target.dataset.field;
    if (field) {
      state.preparation[field] = event.target.value;
      saveState();
    }
  }

  function selectRoute(routeId) {
    const route = getRoute(routeId);
    if (!route) return;
    state.preparation.routeTemplateId = routeId;
    state.preparation.routeQuery = route.trainNumber;
    state.preparation.journeyStartPointId = route.points[0]?.id || '';
    state.preparation.journeyEndPointId = route.points.at(-1)?.id || '';
    saveState();
    render();
  }

  function startService() {
    const route = getRoute(state.preparation.routeTemplateId);
    if (!route) return showToast('Selecciona un recorrido.');
    const timeline = buildTimeline(route, state.preparation);
    if (!timeline.length) return showToast('El trayecto seleccionado no contiene elementos.');
    state.active = {
      id: `web-${Date.now()}`,
      routeId: route.id,
      trainNumber: route.trainNumber,
      origin: selectedJourneyPoints(route,state.preparation)[0]?.name || route.origin,
      destination: selectedJourneyPoints(route,state.preparation)[1]?.name || route.destination,
      startedAt: new Date().toISOString(),
      currentIndex: 0,
      preparation: { ...state.preparation },
    };
    saveState();
    showToast(`Servicio ${route.trainNumber} iniciado.`);
    navigate('ebula');
  }

  function moveTimeline(delta) {
    if (!state.active) return;
    const route = getRoute(state.active.routeId);
    const timeline = buildTimeline(route, state.active.preparation);
    state.active.currentIndex = clamp((state.active.currentIndex || 0) + delta, 0, Math.max(0,timeline.length-1));
    saveState();
    render();
  }

  function setTimelineIndex(index) {
    if (!state.active) return;
    state.active.currentIndex = index;
    saveState();
    render();
  }

  function finishService() {
    if (!state.active) return;
    if (!confirm(`¿Finalizar el surco ${state.active.trainNumber}?`)) return;
    state.history.unshift({ ...state.active, finishedAt: new Date().toISOString() });
    state.active = null;
    saveState();
    showToast('Servicio guardado en histórico.');
    navigate('history');
  }

  function buildTimeline(route, prep) {
    if (!route) return [];
    const [startPoint,endPoint] = selectedJourneyPoints(route, prep);
    const startRank = startPoint ? itemRank(route, startPoint) : -Infinity;
    const endRank = endPoint ? itemRank(route, endPoint) : Infinity;
    const lo = Math.min(startRank,endRank), hi = Math.max(startRank,endRank);
    const points = route.points.map(p => ({
      id: `p:${p.id}`,
      type: 'point',
      kind: p.kind,
      pk: Number(p.kilometer),
      line: route.segments.find(s=>s.sequence===p.segmentSequence)?.lineCode || '',
      label: p.name,
      time: p.plannedArrival || p.plannedPass || p.plannedDeparture || '',
      speed: null,
      rank: itemRank(route,p),
    }));
    const speeds = (route.ebulaSpeedChanges || []).map((s,i) => ({
      id: `s:${s.sequence ?? i}:${s.segmentSequence}:${s.kilometer}`,
      type: 'speed',
      kind: 'SPEED',
      pk: Number(s.kilometer),
      line: route.segments.find(seg=>seg.sequence===s.segmentSequence)?.lineCode || '',
      label: `Cambio de velocidad · ${s.speedKmh} km/h`,
      time: '',
      speed: s.speedKmh,
      rank: itemRank(route,s),
    }));
    return points.concat(speeds).filter(x=>x.rank>=lo-1e-7 && x.rank<=hi+1e-7).sort((a,b)=>a.rank-b.rank || (a.type==='point'?-1:1));
  }

  function selectedJourneyPoints(route, prep) {
    const start = route.points.find(p=>p.id===prep.journeyStartPointId) || route.points[0];
    const end = route.points.find(p=>p.id===prep.journeyEndPointId) || route.points.at(-1);
    return [start,end];
  }

  function itemRank(route, item) {
    const seg = route.segments.find(s=>s.sequence===item.segmentSequence);
    if (!seg) return Number(item.sequence || 0);
    const span = Math.abs(Number(seg.endPk)-Number(seg.startPk));
    const progress = span < 1e-9 ? 0 : (seg.increasingPk ? (Number(item.kilometer)-Number(seg.startPk))/span : (Number(seg.startPk)-Number(item.kilometer))/span);
    return Number(seg.sequence) * 1000 + clamp(progress,0,1) * 999;
  }

  function startGps() {
    if (!('geolocation' in navigator)) return showToast('Este navegador no ofrece Geolocation API.');
    if (!window.isSecureContext && location.protocol !== 'file:') showToast('El GPS del navegador suele requerir HTTPS o localhost.');
    if (gps.watchId !== null) navigator.geolocation.clearWatch(gps.watchId);
    gps.status = 'starting'; gps.error = '';
    gps.watchId = navigator.geolocation.watchPosition(position => {
      gps.position = position;
      gps.status = 'active';
      gps.match = calculateRailPk(position.coords.latitude, position.coords.longitude);
      updateGpsHeader();
      updateGpsPanel();
    }, error => {
      gps.status = 'error';
      gps.error = error.message || 'No se pudo obtener la posición.';
      gps.match = null;
      updateGpsHeader();
      updateGpsPanel();
    }, { enableHighAccuracy: true, maximumAge: 1500, timeout: 12000 });
    updateGpsHeader();
    updateGpsPanel();
  }

  function calculateRailPk(lat, lon) {
    const route = state.active ? getRoute(state.active.routeId) : getRoute(state.preparation.routeTemplateId);
    const lines = route?.headerLines?.length ? route.headerLines : Object.keys(pkReference);
    let best = null;
    for (const line of lines) {
      for (const row of pkReference[line] || []) {
        const distance = haversine(lat, lon, row[2], row[3]);
        if (!best || distance < best.distance) best = { line, pk: row[1], lat: row[2], lon: row[3], distance };
      }
    }
    return best;
  }

  function alignTimelineToGps() {
    if (!state.active || !gps.match) return;
    const route = getRoute(state.active.routeId);
    const timeline = buildTimeline(route, state.active.preparation);
    const candidates = timeline.map((item,index)=>({item,index})).filter(x=>x.item.line===gps.match.line && Number.isFinite(x.item.pk));
    if (!candidates.length) return showToast('No hay filas eBuLa de esa línea para alinear.');
    candidates.sort((a,b)=>Math.abs(a.item.pk-gps.match.pk)-Math.abs(b.item.pk-gps.match.pk));
    state.active.currentIndex = candidates[0].index;
    saveState();
    render();
    showToast(`Alineado con ${fmtPk(gps.match.pk)} de L${gps.match.line}.`);
  }

  function updateGpsHeader() {
    if (!railPosition) return;
    if (gps.match) {
      railPosition.classList.add('good');
      railPosition.innerHTML = `<span class="status-dot"></span><span>L${esc(gps.match.line)} · ${fmtPk(gps.match.pk)} · ${Math.round(gps.match.distance)} m</span>`;
    } else {
      railPosition.classList.remove('good');
      railPosition.innerHTML = `<span class="status-dot"></span><span>${gps.watchId===null?'GPS desconectado':gps.status==='error'?'GPS sin posición':'Buscando GPS…'}</span>`;
    }
  }

  function updateGpsPanel() {
    const box = document.getElementById('gps-panel');
    if (!box || !state.active) return;
    const route = getRoute(state.active.routeId);
    box.innerHTML = renderGpsPanelHtml(route, buildTimeline(route,state.active.preparation));
  }

  async function handlePdfFile(kind, event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      await idbPut(`doc:${kind}`, file);
      state.documents[kind] = { name: file.name, size: file.size, type: file.type || 'application/pdf', savedAt: Date.now() };
      saveState();
      showToast(`${kind.toUpperCase()} guardado localmente.`);
      render();
    } catch (error) {
      showToast(`No se pudo guardar el PDF: ${error.message}`);
    }
  }

  async function openPdf(kind) {
    try {
      const blob = await idbGet(`doc:${kind}`);
      if (!blob) return showToast('El documento ya no está disponible.');
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = URL.createObjectURL(blob);
      const title = state.documents[kind]?.name || kind.toUpperCase();
      modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><strong>${esc(title)}</strong><button class="btn" id="modal-close">CERRAR</button></div><iframe src="${escAttr(currentObjectUrl)}" title="${escAttr(title)}"></iframe></div></div>`;
      document.getElementById('modal-close').onclick = closeModal;
      modalRoot.querySelector('.modal-backdrop').addEventListener('click', e => { if (e.target.classList.contains('modal-backdrop')) closeModal(); });
    } catch (error) { showToast(`No se pudo abrir: ${error.message}`); }
  }

  function closeModal() {
    modalRoot.innerHTML = '';
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
  }

  async function removePdf(kind) {
    await idbDelete(`doc:${kind}`).catch(()=>{});
    state.documents[kind] = null;
    saveState();
    render();
  }

  async function handleCatalogFile(event) {
    const file = event.target.files?.[0]; event.target.value='';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.routes) || !data.routes.length) throw new Error('No contiene routes válidas');
      if (!data.routes.every(r => r.id && r.trainNumber && Array.isArray(r.points) && Array.isArray(r.segments))) throw new Error('El catálogo no tiene el esquema esperado');
      catalog = data;
      await idbPut('customCatalog', data);
      if (state.preparation.routeTemplateId && !getRoute(state.preparation.routeTemplateId)) state.preparation = defaultPreparation();
      if (state.active && !getRoute(state.active.routeId)) state.active = null;
      saveState();
      showToast(`Catálogo importado: ${data.routes.length} recorridos.`);
      render();
    } catch (error) { showToast(`RTLim no válido: ${error.message}`); }
  }

  async function restoreDefaultCatalog() {
    await idbDelete('customCatalog').catch(()=>{});
    catalog = window.RT_DEFAULT_CATALOG;
    if (state.preparation.routeTemplateId && !getRoute(state.preparation.routeTemplateId)) state.preparation = defaultPreparation();
    saveState();
    showToast('Catálogo incluido restaurado.');
    render();
  }

  async function handleKnowledgeFile(event) {
    const file = event.target.files?.[0]; event.target.value='';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (Number(data.FormatVersion) !== 1 || !Array.isArray(data.Dependencies)) throw new Error('Formato de Habilitación no compatible');
      state.knowledge = data.Dependencies.filter(x=>String(x.Name||'').trim() && String(x.Content||'').trim()).map(x=>({Name:String(x.Name).trim(),Content:String(x.Content).trim()}));
      saveState();
      showToast(`Habilitación importada: ${state.knowledge.length} notas.`);
      render();
    } catch (error) { showToast(`No se pudo importar: ${error.message}`); }
  }

  async function resetAll() {
    if (!confirm('¿Borrar todos los datos creados por esta POC en este navegador?')) return;
    for (const key of ['doc:lim','doc:dhltv','customCatalog']) await idbDelete(key).catch(()=>{});
    state = defaultState();
    catalog = window.RT_DEFAULT_CATALOG;
    localStorage.removeItem(STORAGE_KEY);
    showToast('Datos locales borrados.');
    render();
  }

  function getRoute(id) { return catalog.routes.find(r=>r.id===id); }
  function normalize(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim(); }
  function knowledgeKey(value) { return normalize(value).replace(/\bPTA\b/g,'PUERTA').replace(/\bSTA\b/g,'SANTA').replace(/\bA V\b/g,'AV').replace(/\bBIFURCACION\b/g,'BIF').replace(/\s+/g,' ').trim(); }
  function clamp(v,min,max) { return Math.max(min,Math.min(max,v)); }
  function fmtPk(pk) {
    if (!Number.isFinite(Number(pk))) return '—';
    const meters = Math.round(Number(pk)*1000);
    const km = Math.trunc(meters/1000);
    return `PK ${km}+${String(Math.abs(meters%1000)).padStart(3,'0')}`;
  }
  function haversine(lat1,lon1,lat2,lon2) {
    const R=6371000, rad=Math.PI/180;
    const p1=lat1*rad,p2=lat2*rad,dP=(lat2-lat1)*rad,dL=(lon2-lon1)*rad;
    const a=Math.sin(dP/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dL/2)**2;
    return 2*R*Math.asin(Math.sqrt(a));
  }
  function updateClock() {
    const now = new Date();
    document.getElementById('clock-date').textContent = new Intl.DateTimeFormat('es-ES',{day:'2-digit',month:'2-digit',year:'numeric'}).format(now);
    document.getElementById('clock-time').textContent = new Intl.DateTimeFormat('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now);
  }
  function formatDate(iso) { try { return new Intl.DateTimeFormat('es-ES',{day:'2-digit',month:'2-digit',year:'2-digit'}).format(new Date(iso)); } catch (_) { return '—'; } }
  function formatDateTime(iso) { try { return new Intl.DateTimeFormat('es-ES',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(iso)); } catch (_) { return '—'; } }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escAttr(value) { return esc(value).replace(/`/g,'&#96;'); }
  function showToast(message) {
    clearTimeout(toastTimer); toast.textContent = message; toast.classList.add('show');
    toastTimer = setTimeout(()=>toast.classList.remove('show'),2800);
  }

  init();
})();
