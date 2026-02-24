/* ==========================================
   DASHBOARD TRAZADOS VIALES - App Logic
   ========================================== */

// Global state
let dashboardData = null;
let currentPage = 'ranking';
let filtroFase = 'Todos'; // filtro activo por Fase_del_Tramite
let filtroTipo = 'Todos'; // filtro activo por Tipo

// Color map for tramite types
const TYPE_COLORS = {
    'TV': '#1B3A5C',
    'CV': '#2A7DE1',
    'RV': '#4CAF50',
    'STP': '#FF9800',
    'CEV': '#9C27B0',
    'CI': '#E91E63',
    'DCP': '#795548'
};

const TYPE_NAMES = {
    'TV': 'Trazado Vial',
    'CV': 'Certificacion Vial',
    'RV': 'Replanteo Vial',
    'STP': 'Seccion Transversal Proyectada',
    'CEV': 'Colocacion de Eje Vial',
    'CI': 'Colocacion de Infraestructura',
    'DCP': 'Factibilidad Declaratoria Camino Publico'
};

/* ==========================================
   HELPERS: Extract type from phase code
   ========================================== */
function extractTipo(faseCode) {
    if (!faseCode) return '';
    // "RV-01" → "RV", "TV-01_" → "TV", "CEV-02" → "CEV"
    return faseCode.replace(/-\d+.*$/, '');
}

function getFilteredIntake() {
    if (!dashboardData) return [];
    let data = dashboardData.intake;
    if (filtroTipo !== 'Todos') {
        data = data.filter(i => extractTipo(i.Fase_del_Tramite) === filtroTipo);
    }
    if (filtroFase !== 'Todos') {
        data = data.filter(i => i.Fase_del_Tramite === filtroFase);
    }
    return data;
}

/* ==========================================
   INITIALIZATION
   ========================================== */
document.addEventListener('DOMContentLoaded', () => {
    loadData();
});

async function loadData() {
    showLoading(true);
    try {
        dashboardData = await fetchAllDashboardData();
        console.log('Dashboard data loaded:', dashboardData);
        buildFilters();
        renderAllPages();
    } catch (error) {
        console.error('Failed to load data:', error);
        dashboardData = getFallbackData();
        buildFilters();
        renderAllPages();
    } finally {
        showLoading(false);
    }
}

function showLoading(show) {
    const el = document.getElementById('loading');
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
}

/* ==========================================
   FILTERS
   ========================================== */
function buildFilters() {
    if (!dashboardData) return;

    // Collect unique Fase_del_Tramite values
    const fasesUnicas = [...new Set(dashboardData.intake.map(i => i.Fase_del_Tramite).filter(Boolean))].sort();
    const tiposUnicos = [...new Set(dashboardData.intake.map(i => extractTipo(i.Fase_del_Tramite)).filter(Boolean))].sort();

    // Populate Tipo filter
    const tipoSelect = document.getElementById('filtro-tipo');
    if (tipoSelect) {
        tipoSelect.innerHTML = '<option value="Todos">Todos los Tipos</option>';
        tiposUnicos.forEach(t => {
            const name = TYPE_NAMES[t] || t;
            tipoSelect.innerHTML += `<option value="${t}">${t} - ${name}</option>`;
        });
    }

    // Populate Fase filter
    const faseSelect = document.getElementById('filtro-fase');
    if (faseSelect) {
        faseSelect.innerHTML = '<option value="Todos">Todas las Fases</option>';
        fasesUnicas.forEach(f => {
            const tipo = extractTipo(f);
            const faseInfo = dashboardData.fases.find(fs => fs.Codigo === f);
            const label = faseInfo ? `${f} - ${faseInfo.Nombre_Fase}` : f;
            faseSelect.innerHTML += `<option value="${f}">${label}</option>`;
        });
    }
}

function onFiltroTipoChange(value) {
    filtroTipo = value;
    // Reset fase filter when tipo changes
    filtroFase = 'Todos';
    const faseSelect = document.getElementById('filtro-fase');
    if (faseSelect) faseSelect.value = 'Todos';
    renderAllPages();
}

function onFiltroFaseChange(value) {
    filtroFase = value;
    renderAllPages();
}

/* ==========================================
   NAVIGATION
   ========================================== */
function navigateTo(page, detail = null) {
    currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    const targetPage = document.getElementById(`page-${page}`);
    if (targetPage) targetPage.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });
    if (page === 'detalle' && detail) {
        renderDetallePage(detail);
    }
}

/* ==========================================
   RENDER ALL PAGES
   ========================================== */
function renderAllPages() {
    if (!dashboardData) return;
    renderRankingPage();
    renderProductividadPage();
    renderTipoPage();
}

/* ==========================================
   PAGE 1: RANKING
   ========================================== */
function renderRankingPage() {
    const intake = getFilteredIntake();
    const { tipos } = dashboardData;

    // Date range
    const dateEl = document.getElementById('date-range');
    if (intake.length > 0) {
        const dates = intake.map(i => new Date(i['Start date'])).filter(d => !isNaN(d.getTime())).sort((a, b) => a - b);
        if (dates.length > 0) {
            dateEl.textContent = `${formatDate(dates[0])} - ${formatDate(dates[dates.length - 1])}`;
        } else {
            dateEl.textContent = 'Sin fechas';
        }
    } else {
        dateEl.textContent = 'Sin datos';
    }

    // Count by type
    const typeCounts = {};
    Object.keys(TYPE_NAMES).forEach(code => { typeCounts[code] = 0; });
    intake.forEach(item => {
        const tipo = extractTipo(item.Fase_del_Tramite);
        if (tipo) {
            typeCounts[tipo] = (typeCounts[tipo] || 0) + 1;
        }
    });

    // Sort by count desc
    const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((sum, [, v]) => sum + v, 0);

    // Ranking cards (top 3)
    const cardsContainer = document.getElementById('ranking-cards');
    cardsContainer.innerHTML = '';
    sorted.filter(([, c]) => c > 0).slice(0, 3).forEach(([code, count], idx) => {
        const name = TYPE_NAMES[code] || code;
        cardsContainer.innerHTML += `
            <div class="ranking-card">
                <div class="ranking-position pos-${idx + 1}">${idx + 1}</div>
                <div class="ranking-info">
                    <div class="ranking-name">${ordinal(idx + 1)} mas frecuente</div>
                    <div class="ranking-value">${count}</div>
                    <div class="ranking-label">${name}</div>
                </div>
            </div>
        `;
    });

    // Total
    document.getElementById('total-value').textContent = total;

    // Table
    const tbody = document.getElementById('ranking-table-body');
    tbody.innerHTML = '';
    sorted.forEach(([code, count]) => {
        const name = TYPE_NAMES[code] || code;
        tbody.innerHTML += `
            <tr>
                <td>
                    <span style="display:inline-flex;align-items:center;gap:8px;">
                        <span class="code-badge" style="background:${TYPE_COLORS[code] || '#888'}">${code}</span>
                        ${name}
                    </span>
                </td>
                <td style="text-align:center;font-weight:600">${count}</td>
            </tr>
        `;
    });
    document.getElementById('grand-total').textContent = total;

    // Donut chart
    renderDonutChart(sorted.filter(([, c]) => c > 0), total);
}

function renderDonutChart(sorted, total) {
    const canvas = document.getElementById('donutChart');
    const ctx = canvas.getContext('2d');
    const size = 200;
    const center = size / 2;
    const outerRadius = 90;
    const innerRadius = 55;

    ctx.clearRect(0, 0, size, size);

    if (total === 0) {
        ctx.beginPath();
        ctx.arc(center, center, outerRadius, 0, 2 * Math.PI);
        ctx.arc(center, center, innerRadius, 2 * Math.PI, 0, true);
        ctx.closePath();
        ctx.fillStyle = '#E0E0E0';
        ctx.fill();
    } else {
        let startAngle = -Math.PI / 2;
        sorted.forEach(([code, count]) => {
            if (count === 0) return;
            const sliceAngle = (count / total) * 2 * Math.PI;
            ctx.beginPath();
            ctx.arc(center, center, outerRadius, startAngle, startAngle + sliceAngle);
            ctx.arc(center, center, innerRadius, startAngle + sliceAngle, startAngle, true);
            ctx.closePath();
            ctx.fillStyle = TYPE_COLORS[code] || '#888';
            ctx.fill();
            startAngle += sliceAngle;
        });
    }

    // Center text
    ctx.fillStyle = '#1B3A5C';
    ctx.font = '700 28px Inter';
    ctx.textAlign = 'center';
    ctx.fillText(total, center, center + 4);
    ctx.font = '400 10px Inter';
    ctx.fillStyle = '#888';
    ctx.fillText('Total', center, center + 18);

    // Legend
    const legendContainer = document.getElementById('donut-legend');
    legendContainer.innerHTML = '';
    sorted.forEach(([code, count]) => {
        if (count === 0) return;
        const name = TYPE_NAMES[code] || code;
        legendContainer.innerHTML += `
            <div class="legend-item">
                <div class="legend-dot" style="background:${TYPE_COLORS[code] || '#888'}"></div>
                <span>${name} (${count})</span>
            </div>
        `;
    });
}

/* ==========================================
   PAGE 2: PRODUCTIVIDAD
   ========================================== */
function renderProductividadPage() {
    const intake = getFilteredIntake();
    const { tiempos } = dashboardData;

    // Filter tiempos to only those linked to filtered intake
    const intakeIds = new Set(intake.map(i => i.id));
    const filteredTiempos = tiempos.filter(t => intakeIds.has(t.id_tramite));

    const totalFases = filteredTiempos.length;
    const completadas = filteredTiempos.filter(t => t.fecha_hora_fin && t.fecha_hora_fin !== '').length;
    const enProgreso = totalFases - completadas;

    // Responsables - from intake Responsible field
    const respMap = {};
    intake.forEach(item => {
        const resp = item.Responsible || 'Sin asignar';
        if (!respMap[resp]) respMap[resp] = { total: 0, completadas: 0, enProgreso: 0, tramites: [] };
        respMap[resp].total++;
        respMap[resp].tramites.push(item);

        // Check tiempos for this tramite
        const tramiteTiempos = filteredTiempos.filter(t => t.id_tramite === item.id);
        const hasCompleted = tramiteTiempos.some(t => t.fecha_hora_fin && t.fecha_hora_fin !== '');
        const hasInProgress = tramiteTiempos.some(t => !t.fecha_hora_fin || t.fecha_hora_fin === '');

        if (hasCompleted) respMap[resp].completadas++;
        if (hasInProgress || tramiteTiempos.length === 0) respMap[resp].enProgreso++;
    });

    const responsables = Object.entries(respMap).sort((a, b) => b[1].total - a[1].total);

    // KPIs
    const kpiContainer = document.getElementById('prod-kpis');
    kpiContainer.innerHTML = `
        <div class="kpi-card">
            <span class="kpi-label">Total Tramites</span>
            <span class="kpi-value" style="color:#1B3A5C">${intake.length}</span>
        </div>
        <div class="kpi-card">
            <span class="kpi-label">Fases Registradas</span>
            <span class="kpi-value" style="color:#4CAF50">${totalFases}</span>
        </div>
        <div class="kpi-card">
            <span class="kpi-label">Fases Completadas</span>
            <span class="kpi-value" style="color:#2A7DE1">${completadas}</span>
        </div>
        <div class="kpi-card">
            <span class="kpi-label">Responsables</span>
            <span class="kpi-value" style="color:#FF9800">${responsables.length}</span>
        </div>
    `;

    // Responsables table
    const tbody = document.getElementById('prod-table-body');
    tbody.innerHTML = '';
    responsables.forEach(([resp, r]) => {
        const displayName = resp.length > 30 ? resp.substring(0, 30) + '...' : resp;
        tbody.innerHTML += `
            <tr>
                <td title="${resp}">${displayName}</td>
                <td style="text-align:center">${r.total}</td>
                <td style="text-align:center;color:#4CAF50;font-weight:600">${r.completadas}</td>
                <td style="text-align:center;color:#FF9800;font-weight:600">${r.enProgreso}</td>
            </tr>
        `;
    });

    const totalComp = responsables.reduce((s, [, r]) => s + r.completadas, 0);
    const totalProg = responsables.reduce((s, [, r]) => s + r.enProgreso, 0);
    document.getElementById('prod-total-fases').textContent = intake.length;
    document.getElementById('prod-total-comp').textContent = totalComp;
    document.getElementById('prod-total-prog').textContent = totalProg;

    // Progress bars by type
    const barsContainer = document.getElementById('prod-bars');
    barsContainer.innerHTML = '';

    const typeProgress = {};
    intake.forEach(item => {
        const tipo = extractTipo(item.Fase_del_Tramite);
        if (!tipo) return;
        if (!typeProgress[tipo]) typeProgress[tipo] = { total: 0, tramites: [] };
        typeProgress[tipo].total++;
        typeProgress[tipo].tramites.push(item);
    });

    // For each type, calculate average advance based on Fases_Tramite Avance
    Object.entries(typeProgress).forEach(([code, data]) => {
        const { fases } = dashboardData;
        const typeFases = fases.filter(f => f.Tipo === code);
        const totalTypeFases = typeFases.length;

        // For each tramite of this type, figure out how far along it is
        let totalAdvance = 0;
        data.tramites.forEach(item => {
            const currentFase = item.Fase_del_Tramite;
            const faseInfo = fases.find(f => f.Codigo === currentFase);
            const advance = faseInfo ? (parseFloat(faseInfo.Avance) || 0) : 0;
            totalAdvance += advance;
        });
        const avgAdvance = data.total > 0 ? Math.round(totalAdvance / data.total) : 0;

        const name = TYPE_NAMES[code] || code;
        const color = TYPE_COLORS[code] || '#888';
        barsContainer.innerHTML += `
            <div class="bar-item">
                <div class="bar-label-row">
                    <span class="bar-name">${name} (${data.total})</span>
                    <span class="bar-pct" style="color:${color}">${avgAdvance}%</span>
                </div>
                <div class="bar-bg">
                    <div class="bar-fill" style="width:${avgAdvance}%;background:${color}"></div>
                </div>
            </div>
        `;
    });
}

/* ==========================================
   PAGE 3: TIPO DE TRAMITE
   ========================================== */
function renderTipoPage() {
    const intake = getFilteredIntake();
    const { fases } = dashboardData;

    // Count phases per type
    const typePhaseCount = {};
    fases.forEach(f => {
        const tipo = f.Tipo;
        typePhaseCount[tipo] = (typePhaseCount[tipo] || 0) + 1;
    });

    // Count tramites per type
    const typeTramiteCount = {};
    intake.forEach(item => {
        const tipo = extractTipo(item.Fase_del_Tramite);
        typeTramiteCount[tipo] = (typeTramiteCount[tipo] || 0) + 1;
    });

    const totalTypes = Object.keys(TYPE_NAMES).length;
    const totalPhases = fases.length;
    const avgPhases = totalTypes > 0 ? (totalPhases / totalTypes).toFixed(1) : 0;
    const maxPhases = Math.max(...Object.values(typePhaseCount), 0);

    document.getElementById('tipos-badge').textContent = `${totalTypes} Tipos Registrados`;

    // KPIs
    const kpiContainer = document.getElementById('tipo-kpis');
    kpiContainer.innerHTML = `
        <div class="kpi-card">
            <span class="kpi-label">Total Tipos</span>
            <span class="kpi-value" style="color:#1B3A5C">${totalTypes}</span>
        </div>
        <div class="kpi-card">
            <span class="kpi-label">Total Fases</span>
            <span class="kpi-value" style="color:#2A7DE1">${totalPhases}</span>
        </div>
        <div class="kpi-card">
            <span class="kpi-label">Tramites Activos</span>
            <span class="kpi-value" style="color:#4CAF50">${intake.length}</span>
        </div>
        <div class="kpi-card">
            <span class="kpi-label">Prom. Fases/Tipo</span>
            <span class="kpi-value" style="color:#FF9800">${avgPhases}</span>
        </div>
    `;

    // Table - show each tramite grouped by type
    const tbody = document.getElementById('tipo-table-body');
    tbody.innerHTML = '';

    Object.entries(TYPE_NAMES).forEach(([code, name]) => {
        const tramites = intake.filter(i => extractTipo(i.Fase_del_Tramite) === code);
        const phaseCount = typePhaseCount[code] || 0;

        if (tramites.length === 0) {
            tbody.innerHTML += `
                <tr class="clickable-row" onclick="openTipoDetail('${code}')">
                    <td><span class="code-badge" style="background:${TYPE_COLORS[code]}">${code}</span></td>
                    <td style="font-weight:600;color:#1B3A5C">${name}</td>
                    <td>${phaseCount}</td>
                    <td><span class="phase-pill" style="background:#F5F5F5;color:#999">-</span></td>
                    <td><span class="status-pill sin-tramite">Sin tramite</span></td>
                </tr>
            `;
        } else {
            tramites.forEach((item, idx) => {
                const faseActual = item.Fase_del_Tramite || '-';
                const faseInfo = dashboardData.fases.find(f => f.Codigo === faseActual);
                const avance = faseInfo ? (parseFloat(faseInfo.Avance) || 0) : 0;
                const tiempoRecord = dashboardData.tiempos.find(t => t.id_tramite === item.id);
                const enProgreso = tiempoRecord && (!tiempoRecord.fecha_hora_fin || tiempoRecord.fecha_hora_fin === '');
                const estado = enProgreso ? 'En Progreso' : (avance >= 100 ? 'Completado' : 'Iniciado');
                const estadoClass = enProgreso ? 'en-progreso' : (avance >= 100 ? 'completado' : 'iniciado');

                tbody.innerHTML += `
                    <tr class="clickable-row" onclick="openDetail('${item.id}')">
                        <td><span class="code-badge" style="background:${TYPE_COLORS[code]}">${code}</span></td>
                        <td style="font-weight:600;color:#1B3A5C">${item.Name || item.DEX || name}</td>
                        <td>${phaseCount}</td>
                        <td><span class="phase-pill" style="background:#E3F2FD;color:#1565C0">${faseActual}</span></td>
                        <td><span class="status-pill ${estadoClass}">${estado}</span></td>
                    </tr>
                `;
            });
        }
    });

    // Horizontal bar chart
    const barsContainer = document.getElementById('tipo-bars');
    barsContainer.innerHTML = '';

    Object.entries(TYPE_NAMES).forEach(([code]) => {
        const count = typeTramiteCount[code] || 0;
        const maxTramites = Math.max(...Object.values(typeTramiteCount), 1);
        const widthPct = (count / maxTramites) * 100;
        const color = TYPE_COLORS[code];

        barsContainer.innerHTML += `
            <div class="hbar-item">
                <span class="hbar-label" style="color:${color}">${code}</span>
                <div class="hbar-bg">
                    <div class="hbar-fill" style="width:${widthPct}%;background:${color}"></div>
                </div>
                <span class="hbar-value" style="color:${color}">${count}</span>
            </div>
        `;
    });

    // Summary
    const summaryContainer = document.getElementById('tipo-summary');
    const totalTramites = intake.length;
    summaryContainer.innerHTML = `
        <div class="summary-item">
            <span class="summary-value" style="color:#1B3A5C">${totalTramites}</span>
            <span class="summary-label">Tramites</span>
        </div>
        <div class="summary-item">
            <span class="summary-value" style="color:#2A7DE1">${totalPhases}</span>
            <span class="summary-label">Fases</span>
        </div>
        <div class="summary-item">
            <span class="summary-value" style="color:#4CAF50">${maxPhases}</span>
            <span class="summary-label">Max Fases</span>
        </div>
    `;
}

/* ==========================================
   PAGE 4: DETALLE DE TRAMITE
   ========================================== */
function openTipoDetail(typeCode) {
    // Open detail showing all tramites of this type
    const intake = dashboardData.intake.filter(i => extractTipo(i.Fase_del_Tramite) === typeCode);
    if (intake.length > 0) {
        openDetail(intake[0].id);
    }
}

function openDetail(tramiteId) {
    navigateTo('detalle', tramiteId);
}

function renderDetallePage(tramiteId) {
    const { intake, fases, tiempos } = dashboardData;

    const item = intake.find(i => i.id === tramiteId);
    if (!item) return;

    const faseActual = item.Fase_del_Tramite || '';
    const typeCode = extractTipo(faseActual);
    const name = TYPE_NAMES[typeCode] || typeCode;
    const color = TYPE_COLORS[typeCode] || '#888';
    const typeFases = fases.filter(f => f.Tipo === typeCode).sort((a, b) => (a.Orden || 0) - (b.Orden || 0));
    const tramiteTiempos = tiempos.filter(t => t.id_tramite === tramiteId);

    // Header
    document.getElementById('detail-code').textContent = typeCode;
    document.getElementById('detail-code').style.background = color;
    document.getElementById('detail-name').textContent = item.Name || name;
    document.getElementById('detail-phase').textContent = `Fase Actual: ${faseActual}`;

    const faseInfo = fases.find(f => f.Codigo === faseActual);
    const avance = faseInfo ? (parseFloat(faseInfo.Avance) || 0) : 0;
    const tiempoActual = tramiteTiempos.find(t => t.fase === faseActual);
    const enProgreso = tiempoActual && (!tiempoActual.fecha_hora_fin || tiempoActual.fecha_hora_fin === '');

    const estado = enProgreso ? 'En Progreso' : (avance >= 100 ? 'Completado' : 'Iniciado');
    const statusEl = document.getElementById('detail-status');
    statusEl.innerHTML = `<span class="status-dot"></span> ${estado}`;

    if (estado === 'En Progreso') {
        statusEl.style.background = '#FFF3E0';
        statusEl.style.color = '#E65100';
        statusEl.querySelector('.status-dot').style.background = '#FF9800';
    } else if (estado === 'Completado') {
        statusEl.style.background = '#E8F5E9';
        statusEl.style.color = '#2E7D32';
        statusEl.querySelector('.status-dot').style.background = '#4CAF50';
    } else {
        statusEl.style.background = '#E3F2FD';
        statusEl.style.color = '#1565C0';
        statusEl.querySelector('.status-dot').style.background = '#2A7DE1';
    }

    // Determine phase statuses
    const currentFaseOrden = typeFases.findIndex(f => f.Codigo === faseActual);
    let completedCount = 0;
    let inProgressCount = 0;
    let pendingCount = 0;

    const phaseStatuses = typeFases.map((fase, idx) => {
        const faseCode = fase.Codigo;
        const tiempoData = tramiteTiempos.find(t => t.fase === faseCode);

        let status = 'pending';
        let dateText = 'Pendiente';

        if (tiempoData) {
            if (tiempoData.fecha_hora_fin && tiempoData.fecha_hora_fin !== '') {
                status = 'completed';
                dateText = `Completada - ${formatDate(new Date(tiempoData.fecha_hora_fin))}`;
                completedCount++;
            } else {
                status = 'in-progress';
                dateText = `En progreso - Iniciada ${formatDate(new Date(tiempoData.fecha_hora))}`;
                inProgressCount++;
            }
        } else if (idx < currentFaseOrden) {
            status = 'completed';
            dateText = 'Completada';
            completedCount++;
        } else if (idx === currentFaseOrden) {
            status = 'in-progress';
            dateText = 'En progreso';
            inProgressCount++;
        } else {
            pendingCount++;
        }

        return { ...fase, status, dateText };
    });

    // Phases count
    document.getElementById('detail-phases-count').textContent =
        `${completedCount} de ${typeFases.length} completadas`;

    // Phases list
    const phasesContainer = document.getElementById('detail-phases-list');
    phasesContainer.innerHTML = '';

    phaseStatuses.forEach((fase) => {
        const faseCode = fase.Codigo;
        const faseName = fase.Nombre_Fase || faseCode;
        const isActive = fase.status === 'in-progress' ? 'active' : '';
        const isPending = fase.status === 'pending' ? 'pending-phase' : '';

        phasesContainer.innerHTML += `
            <div class="phase-row ${isActive} ${isPending}">
                <div class="phase-dot ${fase.status}">
                    ${fase.status === 'completed' ? '<i class="lucide lucide-check"></i>' : ''}
                </div>
                <div class="phase-info">
                    <div class="phase-name">${faseCode}: ${faseName}</div>
                    <div class="phase-desc ${fase.status}">${fase.dateText}</div>
                </div>
                <span class="phase-status ${fase.status}">
                    ${fase.status === 'completed' ? 'Completada' : fase.status === 'in-progress' ? 'En Progreso' : 'Pendiente'}
                </span>
            </div>
        `;
    });

    // Info fields
    const infoContainer = document.getElementById('detail-info-fields');
    const solicitante = item.Name || 'N/A';
    const responsable = item.Responsible || 'Sin asignar';
    const fechaInicio = item['Start date'] || '';
    const parroquia = item.PARROQUIA || 'N/A';
    const dex = item.DEX || 'N/A';
    const prioridad = item.Sumilla_Inicial || item.Priority || 'N/A';

    const diasTranscurridos = fechaInicio ?
        Math.max(0, Math.floor((new Date() - new Date(fechaInicio)) / (1000 * 60 * 60 * 24))) : 0;

    infoContainer.innerHTML = `
        <div class="info-field">
            <span class="info-field-label">Solicitante:</span>
            <span class="info-field-value">${solicitante}</span>
        </div>
        <div class="info-field">
            <span class="info-field-label">Responsable:</span>
            <span class="info-field-value" title="${responsable}">${responsable.length > 25 ? responsable.substring(0, 25) + '...' : responsable}</span>
        </div>
        <div class="info-field">
            <span class="info-field-label">DEX:</span>
            <span class="info-field-value">${dex}</span>
        </div>
        <div class="info-field">
            <span class="info-field-label">Fecha Inicio:</span>
            <span class="info-field-value">${fechaInicio ? formatDate(new Date(fechaInicio)) : 'N/A'}</span>
        </div>
        <div class="info-field">
            <span class="info-field-label">Dias Transcurridos:</span>
            <span class="info-field-value" style="color:#FF9800">${diasTranscurridos} dias</span>
        </div>
        <div class="info-field">
            <span class="info-field-label">Parroquia:</span>
            <span class="info-field-value">${parroquia}</span>
        </div>
        <div class="info-field">
            <span class="info-field-label">Prioridad:</span>
            <span class="priority-badge">${prioridad}</span>
        </div>
    `;

    // Progress bar
    const totalFasesCount = typeFases.length;
    const pctComplete = totalFasesCount > 0 ? Math.round((completedCount / totalFasesCount) * 100) : 0;

    document.getElementById('detail-progress-bar').style.width = `${pctComplete}%`;
    document.getElementById('detail-progress-pct').textContent = `${pctComplete}% Completado`;
    document.getElementById('detail-progress-frac').textContent = `${completedCount} / ${totalFasesCount} fases`;

    const statsContainer = document.getElementById('detail-progress-stats');
    statsContainer.innerHTML = `
        <div class="progress-stat listas">
            <span class="progress-stat-value" style="color:#4CAF50">${completedCount}</span>
            <span class="progress-stat-label">Listas</span>
        </div>
        <div class="progress-stat activa">
            <span class="progress-stat-value" style="color:#FF9800">${inProgressCount}</span>
            <span class="progress-stat-label">Activa</span>
        </div>
        <div class="progress-stat pendientes">
            <span class="progress-stat-value" style="color:#999">${pendingCount}</span>
            <span class="progress-stat-label">Pendientes</span>
        </div>
    `;
}

/* ==========================================
   UTILITY FUNCTIONS
   ========================================== */
function formatDate(date) {
    if (!date || isNaN(date.getTime())) return 'N/A';
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${date.getDate()} ${months[date.getMonth()]}, ${date.getFullYear()}`;
}

function ordinal(n) {
    if (n === 1) return '1er';
    if (n === 2) return '2do';
    if (n === 3) return '3er';
    return `${n}to`;
}
