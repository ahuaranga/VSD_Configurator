// =========================================================
// 0. MAPA DE VINCULACIÓN Y VARIABLES GLOBALES
// =========================================================
const TAG_MAP = {
    // --- GRUPO 1: ALARMAS ---
    'overcurrent': 'vsd_ol_setpoint_0',   // Reg 717
    'undercurrent': 'vsd_ul_setpoint',    // Reg 751
    
    // --- GRUPO 2: MONITORIZACIÓN (Graficador) ---
    'vsd_supply_voltage': 'vsd_supply_voltage', // Reg 2103
    'vsd_temperature': 'vsd_temperature'        // Reg 2102
};

const UNIT_MAP = {
    'vsd_supply_voltage': 'V',
    'vsd_temperature': '°C',
    'overcurrent': 'A',
    'undercurrent': 'A'
};

// Configuración por defecto
let savedConfig = {
    port: null,
    baudrate: 19200,
    bytesize: 8,
    parity: 'N', // Por defecto None
    stopbits: 1,
    timeout: 1
};

let connectionInterval = null; // Animación de barra de progreso
let pollingInterval = null;    // Timer de lectura constante
let isCommActive = false;      // Bandera de estado de conexión
let pollErrorCount = 0;        // Contador de errores consecutivos (Watchdog)

// --- VARIABLES GLOBALES DEL GRAFICADOR ---
let myChart = null;          // Instancia de Chart.js
let isCharting = false;      // Estado de ejecución de gráfica
let chartInterval = null;    // Timer de actualización de gráfica

// --- DATOS DEL MENÚ ---
const menuData = [
    { 
        id: 1, name: "VSD", 
        subItems: [
            "Operator", "Summary", "Alarms", "Speed", "Time", 
            "Configure", "Expert", "Gas Lock", "PMM Configure", "PMM Configure 2", "Diagnostics"
        ] 
    },
    { id: 2, name: "DHT", subItems: ["Status", "Settings"] },
    { id: 3, name: "Power Analyzer", subItems: ["Voltage", "Current", "Power"] },
    { id: 4, name: "IO", subItems: ["Inputs", "Outputs"] },
    { id: 5, name: "Data Acquisition", subItems: [] },
    { id: 6, name: "Logs/Trends", subItems: [] },
    { id: 7, name: "Utilities", subItems: [] },
    { id: 8, name: "Controller", subItems: [] }
];

// Referencias DOM Globales
const mainMenu = document.getElementById('mainMenu');
const subMenu = document.getElementById('subMenu');
const mainList = document.getElementById('mainList');
const subList = document.getElementById('subList');
const breadcrumb = document.getElementById('breadcrumb');

let isMenuOpen = false;
let currentMainIndex = -1;
let currentSubIndex = -1;
let currentViewRows = [];
let currentFocusIndex = 0;
let currentEditingId = '';

// =========================================================
// 1. MANEJO DE TECLADO Y MOUSE
// =========================================================
document.addEventListener('keydown', (e) => {
    // Bloquear teclado si hay modales abiertos
    const alarmOpen = document.getElementById('alarm-modal').style.display === 'flex';
    const configOpen = document.getElementById('config-modal').style.display === 'flex';
    const statusOpen = document.getElementById('status-modal').style.display === 'flex';
    
    if (isMenuOpen || currentViewRows.length === 0 || alarmOpen || configOpen || statusOpen) return;
    
    // Evitar scroll con flechas
    if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].indexOf(e.code) > -1) e.preventDefault();

    if (e.key === 'ArrowDown') moveFocus(1);
    else if (e.key === 'ArrowUp') moveFocus(-1);
    else if (e.key === 'ArrowRight') jumpBlock(1);
    else if (e.key === 'ArrowLeft') jumpBlock(-1);
});

function initViewNavigation(viewElement) {
    currentViewRows = Array.from(viewElement.querySelectorAll('.form-row'));
    let initialIndex = 0;
    
    const staticRow = viewElement.querySelector('.highlight-cyan');
    if (staticRow) {
        initialIndex = currentViewRows.indexOf(staticRow);
        staticRow.classList.remove('highlight-cyan');
    }

    currentViewRows.forEach((row, index) => {
        row.onclick = null; 
        row.addEventListener('click', () => setActiveRow(index));
    });

    if (currentViewRows.length > 0) setTimeout(() => setActiveRow(initialIndex), 10);
}

function setActiveRow(index) {
    if (index < 0 || index >= currentViewRows.length) return;
    currentFocusIndex = index;
    currentViewRows.forEach(row => {
        row.classList.remove('active-param');
        row.classList.remove('highlight-cyan');
    });
    const activeRow = currentViewRows[index];
    activeRow.classList.add('active-param');
    activeRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function moveFocus(direction) {
    let newIndex = currentFocusIndex + direction;
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= currentViewRows.length) newIndex = currentViewRows.length - 1;
    setActiveRow(newIndex);
}

function jumpBlock(direction) {
    let currentEl = currentViewRows[currentFocusIndex];
    if (!currentEl) return;
    let currentParent = currentEl.closest('fieldset, .control-box');
    let targetIndex = currentFocusIndex;
    let found = false;

    if (direction > 0) { 
        for(let i = currentFocusIndex + 1; i < currentViewRows.length; i++) {
            let nextParent = currentViewRows[i].closest('fieldset, .control-box');
            if (nextParent !== currentParent) { targetIndex = i; found = true; break; }
        }
    } else { 
        for(let i = currentFocusIndex - 1; i >= 0; i--) {
            let prevParent = currentViewRows[i].closest('fieldset, .control-box');
            if (prevParent !== currentParent) {
                let startOfBlock = i;
                while (startOfBlock > 0 && currentViewRows[startOfBlock-1].closest('fieldset, .control-box') === prevParent) {
                    startOfBlock--;
                }
                targetIndex = startOfBlock; found = true; break;
            }
        }
    }
    if (found) setActiveRow(targetIndex);
}

// =========================================================
// 2. MODAL ALARMAS (Lectura/Escritura Real + Lógica UI)
// =========================================================
function openAlarmModal(idSuffix, titleText) {
    currentEditingId = idSuffix;
    document.getElementById('modal-title').innerText = titleText || "Configuración";

    // Referencias a elementos condicionales del modal
    const maintRow = document.getElementById('row-maint-bypass'); // Fila 7
    const startRow = document.getElementById('row-start-bypass'); // Fila 6
    const btnCurve = document.getElementById('btn-edit-curve');   // Botón Curva

    // 1. Resetear visibilidad por defecto (Estado Standard)
    if(maintRow) maintRow.style.display = 'none';
    if(startRow) startRow.style.display = 'flex'; // Visible por defecto
    if(btnCurve) btnCurve.style.display = 'block'; // Visible por defecto

    // 2. Lógica específica por tipo de alarma
    if (idSuffix === 'undercurrent') {
        // Undercurrent: Muestra Maint Bypass, Oculta botón curva
        if(maintRow) maintRow.style.display = 'flex';
        if(btnCurve) btnCurve.style.display = 'none';
        
    } else if (idSuffix.includes('voltage')) {
        // Voltage (High/Low): Oculta fila 6 "Start Bypass" y botón de curva
        if(startRow) startRow.style.display = 'none'; 
        if(btnCurve) btnCurve.style.display = 'none';
    }

    // 3. Cargar valores actuales del DOM al Modal
    const valEl = document.getElementById('val-' + idSuffix);
    const actEl = document.getElementById('act-' + idSuffix);

    if(valEl) document.getElementById('modal-setpoint').value = valEl.innerText;
    
    // Seleccionar la acción en el combobox
    const select = document.getElementById('modal-action');
    if(actEl) {
        const currentAct = actEl.innerText;
        for(let i=0; i<select.options.length; i++) {
            if(select.options[i].value === currentAct) {
                select.selectedIndex = i; break;
            }
        }
    }
    
    document.getElementById('alarm-modal').style.display = 'flex';
}

function closeAlarmModal() {
    document.getElementById('alarm-modal').style.display = 'none';
    currentEditingId = '';
}

function saveAlarmChanges() {
    if (!currentEditingId) return;

    // 1. Datos UI
    const newSetpoint = document.getElementById('modal-setpoint').value;
    const actionSelect = document.getElementById('modal-action');
    const selectedAction = actionSelect.options[actionSelect.selectedIndex].value;
    
    // 2. Identificar el ID Modbus en el MAPA
    const modbusID = TAG_MAP[currentEditingId]; 

    if (modbusID && isCommActive) {
        // --- MODO REAL: ESCRIBIR AL VSD ---
        fetch('/api/write', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                id: modbusID,
                value: newSetpoint
            })
        })
        .then(response => response.json())
        .then(data => {
            if(data.status === 'success') {
                // Actualizar UI
                const valEl = document.getElementById('val-' + currentEditingId);
                const actEl = document.getElementById('act-' + currentEditingId);
                if(valEl) valEl.innerText = newSetpoint;
                if(actEl) actEl.innerText = selectedAction;
                
                alert("Valor guardado correctamente.");
                closeAlarmModal();
            } else {
                alert("Error al escribir en VSD:\n" + (data.error || "Desconocido"));
            }
        })
        .catch(err => alert("Error de comunicación con el Servidor: " + err));

    } else {
        // --- MODO OFFLINE ---
        const valEl = document.getElementById('val-' + currentEditingId);
        const actEl = document.getElementById('act-' + currentEditingId);
        if(valEl) valEl.innerText = newSetpoint;
        if(actEl) actEl.innerText = selectedAction;
        
        closeAlarmModal();
        if(!isCommActive) alert("Guardado en pantalla (Sin conexión activa).");
    }
}

// =========================================================
// 3. COMUNICACIÓN Y POLLING (Lógica Principal)
// =========================================================

// --- A. CONFIGURACIÓN (MODAL) ---
function openConfigModal() {
    document.getElementById('config-modal').style.display = 'flex';
    
    // Cargar puertos disponibles
    const portSelect = document.getElementById('serial-port');
    portSelect.innerHTML = '<option value="" disabled selected>Buscando puertos...</option>';

    fetch('/api/ports')
        .then(response => response.json())
        .then(data => {
            portSelect.innerHTML = '';
            if (data.length === 0) {
                portSelect.add(new Option("No se detectaron puertos", "", true, true));
                portSelect.disabled = true;
            } else {
                portSelect.disabled = false;
                data.forEach(port => {
                    let opt = new Option(`${port.device} - ${port.description}`, port.device);
                    if (savedConfig.port === port.device) opt.selected = true; // Recordar selección anterior
                    portSelect.add(opt);
                });
                if (!savedConfig.port) portSelect.selectedIndex = 0;
            }
        })
        .catch(() => { portSelect.innerHTML = '<option>Error cargando puertos</option>'; });
}

function closeConfigModal() {
    document.getElementById('config-modal').style.display = 'none';
}

// Lee valores del formulario HTML y actualiza savedConfig
function readConfigFromDOM() {
    const port = document.getElementById('serial-port').value;
    if (!port) {
        alert("Selecciona un puerto válido.");
        return false;
    }
    savedConfig.port = port;
    savedConfig.baudrate = document.getElementById('serial-baud').value;
    savedConfig.bytesize = document.getElementById('serial-databits').value;
    savedConfig.parity = document.getElementById('serial-parity').value;
    savedConfig.stopbits = document.getElementById('serial-stopbits').value;
    savedConfig.timeout = document.getElementById('serial-timeout').value;
    return true;
}

function applyConfigParams() {
    if(readConfigFromDOM()) {
        console.log("Configuración aplicada en memoria (Apply).");
    }
}

function okConfigParams() {
    if(readConfigFromDOM()) {
        closeConfigModal();
    }
}

// --- B. CONECTAR (INICIO COMUNICACIÓN) ---
function startCommunication() {
    if (!savedConfig.port) return alert("Primero configure el puerto usando el botón de Configuración.");

    // UI: Mostrar Panel Central
    const statusModal = document.getElementById('status-modal');
    const progressBar = document.getElementById('progress-fill');
    const statusText = document.getElementById('status-text');
    const errorArea = document.getElementById('status-error-area');
    
    statusModal.style.display = 'flex';
    errorArea.style.display = 'none';
    progressBar.style.width = '0%';
    progressBar.style.backgroundColor = '#008000';
    statusText.innerText = "Iniciando secuencia de conexión...";

    // Animación de carga visual
    let width = 0;
    connectionInterval = setInterval(() => {
        if(width < 90) {
            width += 5;
            progressBar.style.width = width + '%';
            if(width === 30) statusText.innerText = `Abriendo puerto ${savedConfig.port}...`;
            if(width === 60) statusText.innerText = "Verificando dispositivo esclavo...";
        }
    }, 50);

    // LLAMADA AL BACKEND
    fetch('/api/connect', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(savedConfig)
    })
    .then(r => r.json())
    .then(data => {
        clearInterval(connectionInterval);
        progressBar.style.width = '100%';
        
        if(data.status === 'success') {
            // CONEXIÓN EXITOSA
            statusText.innerText = "¡Conexión Establecida!";
            setTopLed(true);
            isCommActive = true;
            pollErrorCount = 0; // Resetear errores al conectar
            
            // INICIAR LECTURA CONSTANTE (POLLING)
            startPolling();
            
            // ACTUALIZAR ESTADO DE BOTONES DEL CHART
            updateChartButtons();

            setTimeout(() => {
                statusModal.style.display = 'none';
            }, 800);

        } else {
            // ERROR CONEXIÓN
            progressBar.style.backgroundColor = '#c62828';
            statusText.innerText = "Fallo en la conexión";
            errorArea.style.display = 'block';
            document.getElementById('error-message').innerText = data.message || "Error desconocido";
            setTopLed(false);
            isCommActive = false;
            updateChartButtons();
        }
    })
    .catch(err => {
        clearInterval(connectionInterval);
        progressBar.style.backgroundColor = '#c62828';
        statusText.innerText = "Error Crítico";
        errorArea.style.display = 'block';
        document.getElementById('error-message').innerText = err;
        setTopLed(false);
        isCommActive = false;
        updateChartButtons();
    });
}

function closeStatusModal() {
    document.getElementById('status-modal').style.display = 'none';
}

// --- C. DESCONECTAR ---
function stopCommunication() {
    stopPolling(); // Detener lecturas primero
    
    // Si la gráfica estaba corriendo, la detenemos
    if(isCharting) stopChart();

    fetch('/api/disconnect', { method: 'POST' })
    .then(r => r.json())
    .then(data => {
        setTopLed(false);
        isCommActive = false;
        
        // ACTUALIZAR BOTONES DEL CHART
        updateChartButtons();
        
        alert("Comunicación detenida y puerto cerrado.");
    })
    .catch(err => alert("Error al desconectar: " + err));
}

// --- NUEVA FUNCIÓN: MANEJO DE PÉRDIDA DE CONEXIÓN AUTOMÁTICA ---
function handleLostConnection() {
    stopPolling();
    if(isCharting) stopChart();
    
    // Forzamos estado desconectado
    isCommActive = false;
    setTopLed(false);
    updateChartButtons();
    
    // Avisar al backend para que limpie el puerto (opcional pero bueno)
    fetch('/api/disconnect', { method: 'POST' }).catch(() => {});

    alert("ERROR: Conexión perdida con el dispositivo.\nVerifique el cable.");
}

// --- D. POLLING (LECTURA CONSTANTE) ---
function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    // Leer cada 2 segundos
    pollingInterval = setInterval(pollActiveView, 2000);
}

function stopPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = null;
}

function pollActiveView() {
    if (!isCommActive) return;

    // 1. Identificar qué IDs Modbus están visibles en la pantalla actual
    let idsToRead = [];
    let mapIdToSuffix = {};

    for (const [suffix, modbusID] of Object.entries(TAG_MAP)) {
        const el = document.getElementById('val-' + suffix);
        // Si el elemento existe en el DOM y es visible (su padre tiene dimensiones)
        if (el && el.offsetParent !== null) {
            idsToRead.push(modbusID);
            mapIdToSuffix[modbusID] = suffix;
        }
    }

    if (idsToRead.length === 0) return; // Nada que leer aquí

    // 2. Pedir lectura masiva al backend
    fetch('/api/read_batch', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ ids: idsToRead })
    })
    .then(r => {
        // Si el backend devuelve 500 o 400, lanzamos error
        if (!r.ok) throw new Error("Device Unresponsive");
        return r.json();
    })
    .then(data => {
        pollErrorCount = 0; // Lectura exitosa, reseteamos contador de errores
        
        // 3. Actualizar valores en pantalla
        for (const [modbusID, value] of Object.entries(data)) {
            if (value !== null) {
                const suffix = mapIdToSuffix[modbusID];
                const el = document.getElementById('val-' + suffix);
                if (el) el.innerText = value;
            }
        }
    })
    .catch(err => {
        console.error("Polling error:", err);
        pollErrorCount++;
        // Si fallan 3 lecturas seguidas, asumimos desconexión física
        if (pollErrorCount >= 3) {
            handleLostConnection();
        }
    });
}

// --- E. AUXILIARES ---
function setTopLed(isConnected) {
    const statusDiv = document.getElementById('top-conn-indicator');
    const statusText = statusDiv.querySelector('.conn-text');
    
    if (isConnected) {
        statusDiv.classList.add('connected');
        statusText.innerText = "Connected";
    } else {
        statusDiv.classList.remove('connected');
        statusText.innerText = "Disconnected";
    }
}

// =========================================================
// 4. SISTEMA DE MENÚ Y NAVEGACIÓN
// =========================================================
function toggleMenuSystem() { isMenuOpen = !isMenuOpen; updateMenuVisibility(); }

function goHome() {
    isMenuOpen = false; currentMainIndex = -1; currentSubIndex = -1;
    Array.from(mainList.children).forEach(el => el.classList.remove('selected'));
    Array.from(subList.children).forEach(el => el.classList.remove('selected'));
    breadcrumb.innerText = "Inicio";
    updateMenuVisibility(); showSection('view-home');
    currentViewRows = [];
}

function downloadConfig() {
    alert("Funcionalidad de descarga de reporte en desarrollo.");
}

// =========================================================
// 5. LOGICA DEL GRAFICADOR (Add / Remove / Select / Chart.js)
// =========================================================

// --- A. GESTIÓN DEL GRÁFICO ---
function initChart() {
    const ctx = document.getElementById('realtimeChart').getContext('2d');
    
    // Si ya existe, lo destruimos para limpiar
    if (myChart) myChart.destroy();

    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [], // Eje X (Tiempo)
            datasets: [] // Variables agregadas
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false, // Desactivar animación para rendimiento real-time
            
            // CONFIGURACIÓN DE TOOLTIPS E INTERACCIÓN
            interaction: {
                mode: 'index', // Muestra tooltip de todos los datasets en ese punto X
                intersect: false // No requiere tocar la línea exacta
            },
            plugins: {
                tooltip: {
                    enabled: true,
                    mode: 'index',
                    position: 'nearest'
                },
                // LEYENDA DINÁMICA CON VALORES
                legend: {
                    display: true,
                    position: 'bottom', // LEYENDA EN LA PARTE INFERIOR
                    labels: {
                        boxWidth: 12, 
                        font: { size: 12 },
                        // Función mágica para mostrar "Valor Actual + Nombre"
                        generateLabels: function(chart) {
                            const datasets = chart.data.datasets;
                            return datasets.map((dataset, i) => {
                                // Obtener último valor disponible
                                const lastValue = dataset.data.length > 0 ? dataset.data[dataset.data.length - 1] : '--';
                                // Obtener unidad del mapa global
                                const unit = dataset.unit || ''; 
                                
                                return {
                                    text: `${lastValue} ${unit} - ${dataset.origLabel}`, // E.g. "480 V - Supply Voltage"
                                    fillStyle: dataset.borderColor,
                                    strokeStyle: dataset.borderColor,
                                    lineWidth: 2,
                                    hidden: !chart.isDatasetVisible(i),
                                    datasetIndex: i
                                };
                            });
                        }
                    }
                }
            },
            scales: {
                x: { display: true, title: { display: true, text: 'Time (s)' } },
                y: { display: true, title: { display: true, text: 'Value' } }
            }
        }
    });
}

function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

function openChartModule() {
    const target = document.getElementById('view-chart-module');
    
    // CORRECCIÓN BUG: Si ya estamos en la pantalla, no hacer nada (evita reset)
    if (target.style.display === 'block') {
        return; 
    }

    // 1. Mostrar vista (Lógica original)
    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
    target.style.display = 'block';
    
    const breadcrumb = document.getElementById('breadcrumb');
    if(breadcrumb) breadcrumb.innerText = "> VSD > Speed"; 

    isMenuOpen = false;
    updateMenuVisibility();
    if(mainList) Array.from(mainList.children).forEach(el => el.classList.remove('selected'));
    if(subList) Array.from(subList.children).forEach(el => el.classList.remove('selected'));
    
    // 2. Inicializar gráfico (MEJORA: Persistencia)
    if (!myChart) {
        setTimeout(initChart, 100);
    } else {
        // Redibujar para ajustar tamaño por si cambió el layout
        myChart.resize();
        myChart.update();
    }

    // 3. Actualizar estado de los botones al entrar
    updateChartButtons();
}

function updateMenuVisibility() {
    if (isMenuOpen) {
        mainMenu.classList.add('show-menu');
        if (currentMainIndex !== -1) subMenu.classList.add('show-menu');
    } else {
        mainMenu.classList.remove('show-menu'); subMenu.classList.remove('show-menu');
    }
}

function showSection(sectionId) {
    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
    const target = document.getElementById(sectionId);
    if(target) {
        target.style.display = 'block';
        initViewNavigation(target);
    }
}

function loadView(viewName) {
    let targetId = 'view-default';
    switch(viewName) {
        case 'Speed': targetId = 'view-speed'; break;
        case 'Configure': targetId = 'view-configure'; break;
        case 'Time': targetId = 'view-time'; break;
        case 'Alarms': targetId = 'view-alarms'; break;
        case 'Expert': targetId = 'view-expert'; break;
        case 'PMM Configure': targetId = 'view-pmm-configure'; break;
        case 'PMM Configure 2': targetId = 'view-pmm-configure-2'; break;
        default: document.getElementById('default-title').innerText = viewName;
    }
    showSection(targetId);
    
    // Si estamos conectados, forzar lectura inmediata al cambiar pantalla
    if(isCommActive) {
        setTimeout(pollActiveView, 100);
    }

    if (window.innerWidth < 1024) { isMenuOpen = false; updateMenuVisibility(); }
}

function handleMainClick(index, element) {
    currentMainIndex = index; currentSubIndex = -1; 
    Array.from(mainList.children).forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
    renderSubMenu(menuData[index]);
}

function renderSubMenu(data) {
    subList.innerHTML = '';
    if (data.subItems && data.subItems.length > 0) {
        subMenu.classList.add('show-menu');
        data.subItems.forEach((name, idx) => {
            let li = document.createElement('li');
            li.innerText = `${idx + 1}. ${name}`;
            if (idx === currentSubIndex) li.classList.add('selected');
            li.onclick = () => handleSubClick(idx, name, li);
            subList.appendChild(li);
        });
    } else { subMenu.classList.remove('show-menu'); }
}

function handleSubClick(index, name, element) {
    currentSubIndex = index;
    Array.from(subList.children).forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
    const mainName = menuData[currentMainIndex].name;
    breadcrumb.innerText = `> ${mainName} > ${name}`;
    loadView(name);
}

function updateClock() {
    const now = new Date();
    const datePart = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const timePart = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    document.getElementById('clock').innerText = `${datePart} ${timePart}`;
}

function init() {
    menuData.forEach((item, index) => {
        let li = document.createElement('li');
        li.innerHTML = `${item.id}. ${item.name}`;
        li.classList.add('has-child');
        li.onclick = () => handleMainClick(index, li);
        mainList.appendChild(li);
    });
    setInterval(updateClock, 1000); updateClock(); goHome();
}

init();

// --- B. GESTIÓN DE VARIABLES ---

function addVariableToChart() {
    const select = document.getElementById('chart-var-select');
    const list = document.getElementById('chart-added-list');
    
    // Obtener texto limpio (sin el número de registro visualmente)
    let selectedText = select.options[select.selectedIndex].text;
    selectedText = selectedText.replace(/^\d+\s+/, ''); 

    const selectedValue = select.value;

    // Evitar duplicados
    const existingItems = Array.from(list.children).map(li => li.dataset.value);
    if (existingItems.includes(selectedValue)) {
        alert("Esta variable ya está agregada a la lista.");
        return;
    }

    // 1. Agregar a la LISTA UI
    const li = document.createElement('li');
    li.dataset.value = selectedValue; 
    li.innerText = `${selectedText} (1 s)`; 
    li.onclick = function() { selectChartItem(this); };
    list.appendChild(li);

    // 2. Agregar al GRÁFICO
    if (!myChart) initChart();

    const newDataset = {
        label: selectedText,     // ID interno
        origLabel: selectedText, // Texto base para leyenda
        unit: UNIT_MAP[selectedValue] || '', // Unidad
        data: [], 
        borderColor: getRandomColor(),
        borderWidth: 2,
        fill: false,
        pointRadius: 0,
        pointHoverRadius: 5 // Mostrar punto al pasar mouse
    };

    myChart.data.datasets.push(newDataset);
    myChart.update();
}

function selectChartItem(element) {
    const list = document.getElementById('chart-added-list');
    const btnRemove = document.getElementById('btn-remove-var');

    // 1. Deseleccionar todos los demás items
    Array.from(list.children).forEach(child => child.classList.remove('selected'));

    // 2. Seleccionar el actual (CYAN)
    element.classList.add('selected');

    // 3. Activar el botón de remover
    btnRemove.disabled = false;
}

function removeVariableFromChart() {
    const list = document.getElementById('chart-added-list');
    const btnRemove = document.getElementById('btn-remove-var');
    const selectedItem = list.querySelector('.selected');
    
    if (selectedItem) {
        const textToRemove = selectedItem.innerText.split(' (')[0]; 

        // 1. Remover de la lista UI
        list.removeChild(selectedItem);
        
        // 2. Remover del Gráfico
        if (myChart) {
            const datasetIndex = myChart.data.datasets.findIndex(ds => ds.origLabel === textToRemove);
            if (datasetIndex !== -1) {
                myChart.data.datasets.splice(datasetIndex, 1);
                myChart.update();
            }
        }
        
        // Volver a desactivar el botón porque ya no hay selección
        btnRemove.disabled = true;
    }
}

// --- C. ESTADO START / STOP ---

// Función para actualizar estado visual de botones
function updateChartButtons() {
    const btnStart = document.getElementById('btn-chart-start');
    const btnStop = document.getElementById('btn-chart-stop');

    if (!btnStart || !btnStop) return; 

    if (!isCommActive) {
        // CASO 1: DESCONECTADO (Todo apagado)
        btnStart.disabled = true;
        btnStop.disabled = true;
    } else {
        // CASO 2: CONECTADO
        if (isCharting) {
            // Graficando: Start deshabilitado, Stop habilitado
            btnStart.disabled = true;
            btnStop.disabled = false;
        } else {
            // En pausa: Start habilitado, Stop deshabilitado
            btnStart.disabled = false;
            btnStop.disabled = true;
        }
    }
}

// INICIAR GRÁFICA (Botón Start)
function startChart() {
    if (!isCommActive) return alert("No hay conexión con el dispositivo.");
    if (document.getElementById('chart-added-list').children.length === 0) {
        return alert("Agregue al menos una variable a la lista antes de iniciar.");
    }

    isCharting = true;
    updateChartButtons();

    // Iniciar loop de lectura exclusivo para el gráfico (cada 1s)
    if (chartInterval) clearInterval(chartInterval);
    chartInterval = setInterval(updateChartData, 1000);
}

// DETENER GRÁFICA (Botón Stop)
function stopChart() {
    isCharting = false;
    updateChartButtons();

    if (chartInterval) clearInterval(chartInterval);
    chartInterval = null;
}

// LOOP DE DATOS DEL GRÁFICO
function updateChartData() {
    if (!isCharting || !isCommActive || !myChart) return;

    // Obtener variables de la lista
    const listItems = Array.from(document.getElementById('chart-added-list').children);
    const idsToRead = listItems.map(li => li.dataset.value);

    if (idsToRead.length === 0) return;

    // Leer valores del backend
    fetch('/api/read_batch', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ ids: idsToRead })
    })
    .then(r => {
        // Si el backend devuelve 500 o 400, lanzamos error
        if (!r.ok) throw new Error("Device Unresponsive");
        return r.json();
    })
    .then(data => {
        pollErrorCount = 0; // Reset error count
        const nowLabel = new Date().toLocaleTimeString(); 

        // Eje X: AUMENTO DE HISTÓRICO (60 puntos = 1 minuto de historia en pantalla)
        if (myChart.data.labels.length > 60) myChart.data.labels.shift();
        myChart.data.labels.push(nowLabel);

        // Datasets
        myChart.data.datasets.forEach(dataset => {
            const matchingLi = listItems.find(li => li.innerText.includes(dataset.origLabel));
            
            if (matchingLi) {
                const modbusID = matchingLi.dataset.value;
                const value = data[modbusID];

                if (value !== null && value !== undefined) {
                    if (dataset.data.length > 60) dataset.data.shift();
                    dataset.data.push(value);
                }
            }
        });

        myChart.update();
    })
    .catch(err => {
        console.error("Chart polling error:", err);
        pollErrorCount++;
        // Si fallan 3 lecturas seguidas, asumimos desconexión física
        if (pollErrorCount >= 3) {
            handleLostConnection();
        }
    });
}