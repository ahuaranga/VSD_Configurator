// =========================================================
// 0. MAPA DE VINCULACIÓN Y VARIABLES GLOBALES
// =========================================================
const TAG_MAP = {
    // --- GRUPO 1: ALARMAS ---
    'overcurrent': 'vsd_ol_setpoint_0',   // Reg 717
    'undercurrent': 'vsd_ul_setpoint',    // Reg 751
    
    // --- GRUPO 2: MONITORIZACIÓN VSD ---
    'vsd_supply_voltage': 'vsd_supply_voltage', // Reg 2103
    'vsd_temperature': 'vsd_temperature',       // Reg 2102

    // --- GRUPO 3: DOWN HOLE TOOL (NUEVO) ---
    'dht_intake_pressure': 'dht_intake_pressure',       // Reg 2136
    'dht_discharge_pressure': 'dht_discharge_pressure', // Reg 2137
    'dht_intake_temp': 'dht_intake_temp',               // Reg 2139
    'dht_motor_temp': 'dht_motor_temp',                 // Reg 2140
    'dht_vibration': 'dht_vibration',                   // Reg 2141
    'dht_active_leakage': 'dht_active_leakage',         // Reg 2142
    'dht_cz': 'dht_cz',                                 // Reg 2144
    'dht_cf': 'dht_cf',                                 // Reg 2145
    'dht_passive_leakage': 'dht_passive_leakage',       // Reg 2147
    'dht_diff_pressure': 'dht_diff_pressure'            // Reg 2161
};

const UNIT_MAP = {
    'vsd_supply_voltage': 'V',
    'vsd_temperature': '°C',
    'overcurrent': 'A',
    'undercurrent': 'A',
    'dht_intake_pressure': 'psi',
    'dht_discharge_pressure': 'psi',
    'dht_intake_temp': '°C',
    'dht_motor_temp': '°C',
    'dht_vibration': 'g',
    'dht_active_leakage': 'mA',
    'dht_cz': 'mA',
    'dht_cf': 'mA',
    'dht_passive_leakage': 'mA',
    'dht_diff_pressure': 'psi'
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

    const maintRow = document.getElementById('row-maint-bypass'); 
    const startRow = document.getElementById('row-start-bypass'); 
    const btnCurve = document.getElementById('btn-edit-curve');   

    if(maintRow) maintRow.style.display = 'none';
    if(startRow) startRow.style.display = 'flex'; 
    if(btnCurve) btnCurve.style.display = 'block'; 

    if (idSuffix === 'undercurrent') {
        if(maintRow) maintRow.style.display = 'flex';
        if(btnCurve) btnCurve.style.display = 'none';
    } else if (idSuffix.includes('voltage')) {
        if(startRow) startRow.style.display = 'none'; 
        if(btnCurve) btnCurve.style.display = 'none';
    }

    const valEl = document.getElementById('val-' + idSuffix);
    const actEl = document.getElementById('act-' + idSuffix);

    if(valEl) document.getElementById('modal-setpoint').value = valEl.innerText;
    
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

    const newSetpoint = document.getElementById('modal-setpoint').value;
    const actionSelect = document.getElementById('modal-action');
    const selectedAction = actionSelect.options[actionSelect.selectedIndex].value;
    const modbusID = TAG_MAP[currentEditingId]; 

    if (modbusID && isCommActive) {
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
        const valEl = document.getElementById('val-' + currentEditingId);
        const actEl = document.getElementById('act-' + currentEditingId);
        if(valEl) valEl.innerText = newSetpoint;
        if(actEl) actEl.innerText = selectedAction;
        closeAlarmModal();
        if(!isCommActive) alert("Guardado en pantalla (Sin conexión activa).");
    }
}

// =========================================================
// 3. COMUNICACIÓN Y POLLING
// =========================================================

function openConfigModal() {
    document.getElementById('config-modal').style.display = 'flex';
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
                    if (savedConfig.port === port.device) opt.selected = true;
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

function startCommunication() {
    if (!savedConfig.port) return alert("Primero configure el puerto usando el botón de Configuración.");

    const statusModal = document.getElementById('status-modal');
    const progressBar = document.getElementById('progress-fill');
    const statusText = document.getElementById('status-text');
    const errorArea = document.getElementById('status-error-area');
    
    statusModal.style.display = 'flex';
    errorArea.style.display = 'none';
    progressBar.style.width = '0%';
    progressBar.style.backgroundColor = '#008000';
    statusText.innerText = "Iniciando secuencia de conexión...";

    let width = 0;
    connectionInterval = setInterval(() => {
        if(width < 90) {
            width += 5;
            progressBar.style.width = width + '%';
        }
    }, 50);

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
            setTopLed(true);
            isCommActive = true;
            pollErrorCount = 0; 
            startPolling();
            updateChartButtons();
            setTimeout(() => { statusModal.style.display = 'none'; }, 800);
        } else {
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

function stopCommunication() {
    stopPolling();
    if(isCharting) stopChart();

    fetch('/api/disconnect', { method: 'POST' })
    .then(r => r.json())
    .then(data => {
        setTopLed(false);
        isCommActive = false;
        updateChartButtons();
        alert("Comunicación detenida y puerto cerrado.");
    })
    .catch(err => alert("Error al desconectar: " + err));
}

function handleLostConnection() {
    stopPolling();
    if(isCharting) stopChart();
    
    isCommActive = false;
    setTopLed(false);
    updateChartButtons();
    
    fetch('/api/disconnect', { method: 'POST' }).catch(() => {});
    alert("ERROR: Conexión perdida con el dispositivo.\nVerifique el cable.");
}

function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(pollActiveView, 2000);
}

function stopPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = null;
}

function pollActiveView() {
    if (!isCommActive) return;
    let idsToRead = [];
    let mapIdToSuffix = {};

    for (const [suffix, modbusID] of Object.entries(TAG_MAP)) {
        const el = document.getElementById('val-' + suffix);
        if (el && el.offsetParent !== null) {
            idsToRead.push(modbusID);
            mapIdToSuffix[modbusID] = suffix;
        }
    }

    if (idsToRead.length === 0) return;

    fetch('/api/read_batch', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ ids: idsToRead })
    })
    .then(r => {
        if (!r.ok) throw new Error("Device Unresponsive");
        return r.json();
    })
    .then(data => {
        pollErrorCount = 0; 
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
        if (pollErrorCount >= 3) {
            handleLostConnection();
        }
    });
}

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

function initChart() {
    const ctx = document.getElementById('realtimeChart').getContext('2d');
    
    if (myChart) myChart.destroy();

    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [], 
            datasets: [] 
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false, 
            interaction: { mode: 'index', intersect: false },
            plugins: {
                tooltip: { enabled: true, mode: 'index', position: 'nearest' },
                legend: {
                    display: true,
                    position: 'bottom', 
                    labels: {
                        boxWidth: 12, 
                        font: { size: 12 },
                        generateLabels: function(chart) {
                            const datasets = chart.data.datasets;
                            return datasets.map((dataset, i) => {
                                const lastValue = dataset.data.length > 0 ? dataset.data[dataset.data.length - 1] : '--';
                                const unit = dataset.unit || ''; 
                                return {
                                    text: `${lastValue} ${unit} - ${dataset.origLabel}`,
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
    if (target.style.display === 'block') {
        return; 
    }

    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
    target.style.display = 'block';
    
    document.getElementById('breadcrumb').innerText = "> VSD > Speed"; 
    isMenuOpen = false;
    updateMenuVisibility();
    Array.from(mainList.children).forEach(el => el.classList.remove('selected'));
    Array.from(subList.children).forEach(el => el.classList.remove('selected'));
    
    if (!myChart) {
        setTimeout(initChart, 100);
    } else {
        myChart.resize();
        myChart.update();
    }
    
    // Verificar estado botón Clear
    const list = document.getElementById('chart-added-list');
    const btnClear = document.getElementById('btn-clear-vars');
    if (list && btnClear) {
        btnClear.disabled = (list.children.length === 0);
    }

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
    if(isCommActive) setTimeout(pollActiveView, 100);
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
    document.getElementById('breadcrumb').innerText = `> ${mainName} > ${name}`;
    loadView(name);
}

function updateClock() {
    const now = new Date();
    document.getElementById('clock').innerText = now.toLocaleString('en-GB');
}

// =========================================================
// 6. FUNCIONALIDAD DROPDOWN (Ocultar números al seleccionar)
// =========================================================
function initDropdownLogic() {
    const selects = document.querySelectorAll('select.dynamic-select'); 
    
    selects.forEach(sel => {
        Array.from(sel.options).forEach(opt => {
            if (!opt.dataset.orig) {
                opt.dataset.orig = opt.text;
            }
        });

        const showNumbers = () => {
            Array.from(sel.options).forEach(opt => {
                opt.text = opt.dataset.orig;
            });
        };

        const hideNumbers = () => {
            Array.from(sel.options).forEach(opt => opt.text = opt.dataset.orig);
            if (sel.selectedIndex !== -1) {
                const selected = sel.options[sel.selectedIndex];
                selected.text = selected.text.replace(/^\d+:\s*/, '');
            }
        };

        sel.addEventListener('mousedown', showNumbers); 
        sel.addEventListener('change', hideNumbers);    
        sel.addEventListener('blur', hideNumbers);      

        hideNumbers();
    });
}

// =========================================================
// 7. FUNCIONALIDAD CAMPO DINÁMICO (Extended Speed Mode)
// =========================================================
function toggleExtendedFreq() {
    const select = document.getElementById('pmm-ext-speed-mode');
    const row = document.getElementById('row-ext-base-freq');
    
    if (select && row) {
        if (select.value === "1") {
            row.style.display = 'flex';
        } else {
            row.style.display = 'none';
        }
    }
    // IMPORTANTE: Al cambiar esto también validamos si hay que bloquear Configuration
    updateConfigLocks();
}

// =========================================================
// 8. FUNCIONALIDAD BLOQUEO (Motor Setup Mode)
// =========================================================
function togglePMMFields() {
    const modeSelect = document.getElementById('pmm-setup-mode');
    if (!modeSelect) return;

    const isManual = (modeSelect.value === '2'); 
    
    const container = document.getElementById('view-pmm-configure-2');
    const fieldset = container.querySelector('fieldset.group-box'); 

    const inputs = fieldset.querySelectorAll('input, select');

    inputs.forEach(input => {
        if (input.id === 'pmm-setup-mode') return;
        input.disabled = !isManual;
    });

    // IMPORTANTE: Validar bloqueos cruzados
    updateConfigLocks();
}

// =========================================================
// 9. FUNCIONALIDAD BLOQUEO CRUZADO (Config View)
// =========================================================
function updateConfigLocks() {
    const setupMode = document.getElementById('pmm-setup-mode').value; // 2 = Manual
    const extMode = document.getElementById('pmm-ext-speed-mode').value; // 1 = Enable

    const transRatio = document.getElementById('cfg-transformer-ratio');
    const vsdSpeed = document.getElementById('cfg-vsd-speed');
    const volts = document.getElementById('cfg-base-volts');

    if(!transRatio || !vsdSpeed || !volts) return;

    // Condición: Manual Setup (2) AND Extended Mode Enabled (1)
    if (setupMode === '2' && extMode === '1') {
        // Desactivar
        transRatio.disabled = true;
        vsdSpeed.disabled = true;
        volts.disabled = true;
        // Estilo visual
        transRatio.classList.add('input-disabled');
        vsdSpeed.classList.add('input-disabled');
        volts.classList.add('input-disabled');
    } else {
        // Activar (Por defecto)
        transRatio.disabled = false;
        vsdSpeed.disabled = false;
        volts.disabled = false;
        
        transRatio.classList.remove('input-disabled');
        vsdSpeed.classList.remove('input-disabled');
        volts.classList.remove('input-disabled');
    }
}

function init() {
    menuData.forEach((item, index) => {
        let li = document.createElement('li');
        li.innerHTML = `${item.id}. ${item.name}`;
        li.classList.add('has-child');
        li.onclick = () => handleMainClick(index, li);
        mainList.appendChild(li);
    });
    setInterval(updateClock, 1000); 
    updateClock(); 
    goHome();
    
    // INICIALIZAR LÓGICAS DE UI
    setTimeout(initDropdownLogic, 100); 
    setTimeout(toggleExtendedFreq, 100); 
    setTimeout(togglePMMFields, 100); 
    setTimeout(updateConfigLocks, 100); // Estado inicial de bloqueos cruzados
}

init();

// --- B. GESTIÓN DE VARIABLES ---

function addVariableToChart() {
    const select = document.getElementById('chart-var-select');
    const list = document.getElementById('chart-added-list');
    const btnClear = document.getElementById('btn-clear-vars');
    
    if (select.selectedIndex === -1 || !select.value) return;

    let selectedOption = select.options[select.selectedIndex];
    let selectedText = selectedOption.text.replace(/^\d+\s+/, ''); 
    const selectedValue = select.value;

    const existingItems = Array.from(list.children).map(li => li.dataset.value);
    if (existingItems.includes(selectedValue)) {
        return alert("Esta variable ya está agregada.");
    }

    const li = document.createElement('li');
    li.dataset.value = selectedValue; 
    li.innerText = `${selectedText} (1 s)`; 
    li.onclick = function() { selectChartItem(this); };
    list.appendChild(li);

    selectedOption.disabled = true;
    selectedOption.hidden = true;
    selectedOption.style.display = 'none';
    select.selectedIndex = -1; 

    if(btnClear) btnClear.disabled = false;

    if (!myChart) initChart();

    const newDataset = {
        label: selectedText,
        origLabel: selectedText,
        unit: UNIT_MAP[selectedValue] || '',
        data: [], 
        borderColor: getRandomColor(),
        borderWidth: 2,
        fill: false,
        pointRadius: 0,
        pointHoverRadius: 5
    };

    myChart.data.datasets.push(newDataset);
    myChart.update();
}

function selectChartItem(element) {
    const list = document.getElementById('chart-added-list');
    const btnRemove = document.getElementById('btn-remove-var');
    Array.from(list.children).forEach(child => child.classList.remove('selected'));
    element.classList.add('selected');
    btnRemove.disabled = false;
}

function removeVariableFromChart() {
    const list = document.getElementById('chart-added-list');
    const btnRemove = document.getElementById('btn-remove-var');
    const btnClear = document.getElementById('btn-clear-vars');
    const selectedItem = list.querySelector('.selected');
    
    if (selectedItem) {
        const valToRemove = selectedItem.dataset.value; 
        
        const select = document.getElementById('chart-var-select');
        for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value === valToRemove) {
                select.options[i].disabled = false;
                select.options[i].hidden = false;
                select.options[i].style.display = '';
                break;
            }
        }

        if (myChart) {
            const textInLi = selectedItem.innerText;
            const textClean = textInLi.replace(' (1 s)', '');
            const datasetIndex = myChart.data.datasets.findIndex(ds => ds.origLabel === textClean);
            
            if (datasetIndex !== -1) {
                myChart.data.datasets.splice(datasetIndex, 1);
                myChart.update();
            }
        }
        
        list.removeChild(selectedItem);
        btnRemove.disabled = true;

        if (list.children.length === 0 && btnClear) {
            btnClear.disabled = true;
        }
    }
}

function clearAllVariables() {
    const list = document.getElementById('chart-added-list');
    const select = document.getElementById('chart-var-select');
    const btnRemove = document.getElementById('btn-remove-var');
    const btnClear = document.getElementById('btn-clear-vars');

    for (let i = 0; i < select.options.length; i++) {
        select.options[i].disabled = false;
        select.options[i].hidden = false;
        select.options[i].style.display = '';
    }
    select.selectedIndex = -1;

    list.innerHTML = '';

    if (myChart) {
        myChart.data.datasets = [];
        myChart.update();
    }

    btnRemove.disabled = true;
    btnClear.disabled = true;
}

// --- C. ESTADO START / STOP ---

function updateChartButtons() {
    const btnStart = document.getElementById('btn-chart-start');
    const btnStop = document.getElementById('btn-chart-stop');

    if (!btnStart || !btnStop) return; 

    if (!isCommActive) {
        btnStart.disabled = true;
        btnStop.disabled = true;
    } else {
        if (isCharting) {
            btnStart.disabled = true;
            btnStop.disabled = false;
        } else {
            btnStart.disabled = false;
            btnStop.disabled = true;
        }
    }
}

function startChart() {
    if (!isCommActive) return alert("No hay conexión.");
    if (document.getElementById('chart-added-list').children.length === 0) {
        return alert("Agregue al menos una variable.");
    }
    isCharting = true;
    updateChartButtons();
    if (chartInterval) clearInterval(chartInterval);
    chartInterval = setInterval(updateChartData, 1000);
}

function stopChart() {
    isCharting = false;
    updateChartButtons();
    if (chartInterval) clearInterval(chartInterval);
    chartInterval = null;
}

function updateChartData() {
    if (!isCharting || !isCommActive || !myChart) return;

    const listItems = Array.from(document.getElementById('chart-added-list').children);
    const idsToRead = listItems.map(li => li.dataset.value);

    if (idsToRead.length === 0) return;

    fetch('/api/read_batch', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ ids: idsToRead })
    })
    .then(r => {
        if (!r.ok) throw new Error("Device Unresponsive");
        return r.json();
    })
    .then(data => {
        pollErrorCount = 0; 
        const nowLabel = new Date().toLocaleTimeString(); 

        if (myChart.data.labels.length > 60) myChart.data.labels.shift();
        myChart.data.labels.push(nowLabel);

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
        if (pollErrorCount >= 3) {
            handleLostConnection();
        }
    });
}