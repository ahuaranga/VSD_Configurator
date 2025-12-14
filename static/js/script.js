// =========================================================
// 0. MAPA DE VINCULACIÓN Y VARIABLES GLOBALES
// =========================================================
const TAG_MAP = {
    // Clave (Sufijo HTML id="val-xxx") : Valor (ID en modbus_map.py)
    
    'overcurrent': 'vsd_ol_setpoint_0',   // Registro 717
    'undercurrent': 'vsd_ul_setpoint',    // Registro 751
    
    // --- NUEVOS REGISTROS DE VOLTAJE ---
    'voltage-high': 'vsd_vh_setpoint',    // Reg 800 (Placeholder)
    'voltage-low': 'vsd_vl_setpoint'      // Reg 801 (Placeholder)
};

// Configuración por defecto: 19200, 8, N, 1, 1
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
            
            // INICIAR LECTURA CONSTANTE (POLLING)
            startPolling();
            
            // Cerrar panel central automáticamente
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
    });
}

function closeStatusModal() {
    document.getElementById('status-modal').style.display = 'none';
}

// --- C. DESCONECTAR ---
function stopCommunication() {
    stopPolling(); // Detener lecturas primero
    
    fetch('/api/disconnect', { method: 'POST' })
    .then(r => r.json())
    .then(data => {
        setTopLed(false);
        isCommActive = false;
        alert("Comunicación detenida y puerto cerrado.");
    })
    .catch(err => alert("Error al desconectar: " + err));
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
    .then(r => r.json())
    .then(data => {
        // 3. Actualizar valores en pantalla
        for (const [modbusID, value] of Object.entries(data)) {
            if (value !== null) {
                const suffix = mapIdToSuffix[modbusID];
                const el = document.getElementById('val-' + suffix);
                if (el) el.innerText = value;
            }
        }
    })
    .catch(console.error); // Errores de polling silenciosos
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
// 4. SISTEMA DE MENÚ
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

// --- NUEVA FUNCIÓN PARA EL BOTÓN DE CHARTS ---
function openChartModule() {
    // Aquí implementaremos la lógica para abrir el panel de gráficas
    alert("Módulo de Gráficas (Trends) en construcción.");
    console.log("Abriendo módulo de gráficas...");
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
    breadcrumb.innerText = `> ${menuData[index].name}`;
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