// =========================================================
// 0. MAPA DE VINCULACIÓN, UNIDADES Y EJES
// =========================================================
const TAG_MAP = {
    // GRUPO 1: ALARMAS
    'overcurrent': 'vsd_ol_setpoint_0',
    'undercurrent': 'vsd_ul_setpoint',
    
    // GRUPO 2: MONITORIZACIÓN VSD
    'vsd_supply_voltage': 'vsd_supply_voltage',
    'vsd_temperature': 'vsd_temperature',
    'vsd_load': 'vsd_current', 

    // GRUPO 3: VARIABLE SPEED DRIVE (VSD)
    'vsd_motor_rpm': 'vsd_motor_rpm',
    'vsd_target_freq': 'vsd_target_freq', 

    'vsd_min_speed': 'vsd_min_speed',
    'vsd_max_speed': 'vsd_max_speed',

    'vsd_frequency_out': 'vsd_frequency_out',
    'vsd_current': 'vsd_current',
    'vsd_motor_current': 'vsd_motor_current',
    'vsd_volts_in': 'vsd_volts_in',
    'vsd_volts_out': 'vsd_volts_out',

    // GRUPO 4: DOWN HOLE TOOL (DHT)
    'dht_intake_pressure': 'dht_intake_pressure',
    'dht_discharge_pressure': 'dht_discharge_pressure',
    'dht_intake_temp': 'dht_intake_temp',
    'dht_motor_temp': 'dht_motor_temp',
    'dht_vibration': 'dht_vibration',
    'dht_active_leakage': 'dht_active_leakage',
    'dht_cz': 'dht_cz',
    'dht_cf': 'dht_cf',
    'dht_passive_leakage': 'dht_passive_leakage',
    'dht_diff_pressure': 'dht_diff_pressure'
};

const UNIT_MAP = {
    'vsd_supply_voltage': 'V',
    'vsd_temperature': '°C',
    'overcurrent': 'A',
    'undercurrent': 'A',
    'vsd_load': '%',
    
    // UNIDADES VSD
    'vsd_motor_rpm': 'RPM',
    'vsd_target_freq': 'Hz',
    'vsd_frequency_out': 'Hz',
    'vsd_current': 'A',
    'vsd_motor_current': 'A',
    'vsd_volts_in': 'V',
    'vsd_volts_out': 'V',

    // UNIDADES DHT
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

// --- MAPA DE EJES POR DEFECTO ---
const DEFAULT_AXIS_MAP = {
    'dht_vibration': 'y1',
    'dht_active_leakage': 'y1',
    'dht_cz': 'y1',
    'dht_cf': 'y1',
    'dht_passive_leakage': 'y1'
};

// =========================================================
// 1. CONFIGURACIÓN Y ESTADO GLOBAL
// =========================================================
let savedConfig = {
    connection_type: 'serial',
    port: null,
    baudrate: 19200,
    bytesize: 8,
    parity: 'N',
    stopbits: 1,
    ip_address: '',
    tcp_port: 502,
    timeout: 1
};

let connectionInterval = null; 
let pollingInterval = null;    
let isCommActive = false;      
let pollErrorCount = 0;        

let myChart = null;          
let isCharting = false;      
let chartInterval = null;    
let chartPollingRate = 1000; 

// --- ESTRUCTURA DEL MENU ---
const menuData = [
    { id: 1, name: "VSD", subItems: ["Operator", "Summary", "Alarms", "Speed", "Time", "Configure", "Expert", "Gas Lock", "PMM Configure", "PMM Configure 2", "Diagnostics"] },
    { id: 2, name: "DHT", subItems: ["Status", "Settings"] },
    { id: 3, name: "Power Analyzer", subItems: ["Voltage", "Current", "Power"] },
    { id: 4, name: "IO", subItems: ["Inputs", "Outputs"] },
    { id: 5, name: "Data Acquisition", subItems: [] },
    { id: 6, name: "Logs/Trends", subItems: [] },
    { id: 7, name: "Utilities", subItems: [] },
    { id: 8, name: "Controller", subItems: [] }
];

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
// 2. GESTIÓN DE INTERFAZ Y NAVEGACIÓN (Teclado/Mouse)
// =========================================================

document.addEventListener('keydown', (e) => {
    const alarmOpen = document.getElementById('alarm-modal').style.display === 'flex';
    const configOpen = document.getElementById('config-modal').style.display === 'flex';
    const statusOpen = document.getElementById('status-modal').style.display === 'flex';
    
    if (isMenuOpen || currentViewRows.length === 0 || alarmOpen || configOpen || statusOpen) return;
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
// 3. MODALES Y CONFIGURACIÓN
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
            body: JSON.stringify({ id: modbusID, value: newSetpoint })
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

// --- LOGICA DEL MODAL DE CONFIGURACIÓN ---

function openConfigModal() {
    document.getElementById('config-modal').style.display = 'flex';
    
    // Restaurar valores guardados
    const radios = document.getElementsByName('connType');
    radios.forEach(r => {
        if(r.value === savedConfig.connection_type) r.checked = true;
    });
    toggleConfigFields();

    document.getElementById('tcp-ip').value = savedConfig.ip_address;
    document.getElementById('tcp-port').value = savedConfig.tcp_port;
    document.getElementById('serial-timeout').value = savedConfig.timeout;

    const portSelect = document.getElementById('serial-port');
    if (!isCommActive) {
        portSelect.innerHTML = '<option value="" disabled selected>Searching...</option>';
        fetch('/api/ports')
            .then(response => response.json())
            .then(data => {
                portSelect.innerHTML = '';
                if (data.length === 0) {
                    portSelect.add(new Option("No ports detected", "", true, true));
                    if(savedConfig.connection_type === 'serial') portSelect.disabled = true;
                } else {
                    portSelect.disabled = false;
                    data.forEach(port => {
                        let opt = new Option(`${port.device} - ${port.description}`, port.device);
                        if (savedConfig.port === port.device) opt.selected = true;
                        portSelect.add(opt);
                    });
                    if (!savedConfig.port && data.length > 0) portSelect.selectedIndex = 0;
                }
            })
            .catch(() => { portSelect.innerHTML = '<option>Error loading ports</option>'; });
    }

    const allInputs = document.querySelectorAll('#config-modal input, #config-modal select');
    const applyBtn = document.querySelector('#config-modal .modal-btn:first-child'); 
    
    if (isCommActive) {
        allInputs.forEach(el => el.disabled = true);
        if(applyBtn) {
            applyBtn.disabled = true;
            applyBtn.style.opacity = "0.5";
            applyBtn.title = "Disconnect first to change settings";
        }
    } else {
        allInputs.forEach(el => el.disabled = false);
        if(applyBtn) {
            applyBtn.disabled = false;
            applyBtn.style.opacity = "1";
            applyBtn.title = "";
        }
    }
}

function toggleConfigFields() {
    const radios = document.getElementsByName('connType');
    let selected = 'serial';
    radios.forEach(r => { if(r.checked) selected = r.value; });

    const groupSerial = document.getElementById('group-serial');
    const groupTcp = document.getElementById('group-tcp');
    
    if (selected === 'serial') {
        groupSerial.style.display = 'block';
        groupTcp.style.display = 'none';
    } else {
        groupSerial.style.display = 'none';
        groupTcp.style.display = 'block';
    }
}

function closeConfigModal() { document.getElementById('config-modal').style.display = 'none'; }

function readConfigFromDOM() {
    if (isCommActive) return false;

    const radios = document.getElementsByName('connType');
    let connType = 'serial';
    radios.forEach(r => { if(r.checked) connType = r.value; });
    savedConfig.connection_type = connType;
    savedConfig.timeout = document.getElementById('serial-timeout').value;

    if (connType === 'serial') {
        const port = document.getElementById('serial-port').value;
        if (!port) { alert("Please select a valid COM port."); return false; }
        savedConfig.port = port;
        savedConfig.baudrate = document.getElementById('serial-baud').value;
        savedConfig.bytesize = document.getElementById('serial-databits').value;
        savedConfig.parity = document.getElementById('serial-parity').value;
        savedConfig.stopbits = document.getElementById('serial-stopbits').value;
    } else {
        const ip = document.getElementById('tcp-ip').value;
        const port = document.getElementById('tcp-port').value;
        if (!ip) { alert("Please enter a valid IP Address."); return false; }
        savedConfig.ip_address = ip;
        savedConfig.tcp_port = port;
    }
    return true;
}

function applyConfigParams() { if(readConfigFromDOM()) console.log("Config applied."); }
function okConfigParams() { if(readConfigFromDOM()) closeConfigModal(); }

// =========================================================
// 4. COMUNICACIÓN MODBUS (Conectar/Desconectar/Leer)
// =========================================================

function toggleMasterCommunication() {
    if (isCommActive) {
        stopCommunication();
    } else {
        startCommunication();
    }
}

function updateMasterCommButton() {
    const btn = document.getElementById('btn-master-comm');
    if (!btn) return;
    if (isCommActive) {
        btn.classList.remove('comm-btn-off');
        btn.classList.add('comm-btn-on');
        btn.classList.add('btn-active'); 
        btn.title = "Disconnect";
    } else {
        btn.classList.remove('comm-btn-on');
        btn.classList.add('comm-btn-off');
        btn.classList.remove('btn-active'); 
        btn.title = "Connect";
    }
}

function startCommunication() {
    if (savedConfig.connection_type === 'serial' && !savedConfig.port) {
        return alert("Please configure the Serial Port first.");
    }
    if (savedConfig.connection_type === 'tcp' && !savedConfig.ip_address) {
        return alert("Please configure the IP Address first.");
    }

    const statusModal = document.getElementById('status-modal');
    const progressBar = document.getElementById('progress-fill');
    const statusText = document.getElementById('status-text');
    const errorArea = document.getElementById('status-error-area');
    
    statusModal.style.display = 'flex';
    errorArea.style.display = 'none';
    progressBar.style.width = '0%';
    progressBar.style.backgroundColor = '#008000';
    statusText.innerText = `Connecting via ${savedConfig.connection_type.toUpperCase()}...`;

    let width = 0;
    connectionInterval = setInterval(() => {
        if(width < 90) { width += 5; progressBar.style.width = width + '%'; }
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
            updateMasterCommButton(); 
            startPolling();
            updateChartButtons();
            readFirmwareVersion();
            setTimeout(() => { statusModal.style.display = 'none'; }, 800);
        } else {
            progressBar.style.backgroundColor = '#c62828';
            statusText.innerText = "Connection Failed";
            errorArea.style.display = 'block';
            document.getElementById('error-message').innerText = data.message || "Unknown Error";
            setTopLed(false);
            isCommActive = false;
            updateMasterCommButton(); 
            updateChartButtons();
        }
    })
    .catch(err => {
        clearInterval(connectionInterval);
        progressBar.style.backgroundColor = '#c62828';
        statusText.innerText = "Critical Error";
        errorArea.style.display = 'block';
        document.getElementById('error-message').innerText = err;
        setTopLed(false);
        isCommActive = false;
        updateMasterCommButton(); 
        updateChartButtons();
    });
}

function closeStatusModal() { document.getElementById('status-modal').style.display = 'none'; }

function stopCommunication() {
    stopPolling();
    if(isCharting) stopChart();
    fetch('/api/disconnect', { method: 'POST' })
    .then(r => r.json())
    .then(data => {
        setTopLed(false);
        isCommActive = false;
        
        const fwEl = document.getElementById('fw-display');
        if(fwEl) fwEl.innerText = "Fw: --.---";

        updateMasterCommButton(); 
        updateChartButtons();
        alert("Communication stopped.");
    })
    .catch(err => alert("Error disconnecting: " + err));
}

function handleLostConnection() {
    stopPolling();
    if(isCharting) stopChart();
    isCommActive = false;
    setTopLed(false);
    
    const fwEl = document.getElementById('fw-display');
    if(fwEl) fwEl.innerText = "Fw: --.---";

    updateMasterCommButton(); 
    updateChartButtons();
    fetch('/api/disconnect', { method: 'POST' }).catch(() => {});
    alert("ERROR: Lost connection with device.\nCheck cable or network.");
}

function readFirmwareVersion() {
    fetch('/api/read_batch', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ ids: ['fw_ver_code', 'fw_rel_code'] })
    })
    .then(r => r.json())
    .then(data => {
        let ver = data['fw_ver_code'];
        const rel = data['fw_rel_code'];
        
        const el = document.getElementById('fw-display');
        if (el) {
            if (ver !== null && rel !== null && ver !== undefined && rel !== undefined) {
                let hexVer = ver.toString(16);
                if (hexVer.length > 1) {
                    hexVer = hexVer.charAt(0) + '.' + hexVer.slice(1);
                }
                el.innerText = `Fw: ${hexVer}r${rel}`;
            } else {
                el.innerText = "Fw: Error";
            }
        }
    })
    .catch(err => console.error("Error reading firmware:", err));
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
    
    // Recolectamos IDs visibles
    for (const [suffix, modbusID] of Object.entries(TAG_MAP)) {
        const el = document.getElementById('val-' + suffix);
        // Leemos solo si el elemento existe y es visible (offsetParent no es null)
        if (el && el.offsetParent !== null) {
            idsToRead.push(modbusID);
            mapIdToSuffix[modbusID] = suffix;
        }
    }

    // Lógica especial para Operador:
    // Leemos Target Speed y Max Speed para configurar el Gauge.
    // Omitimos Min Speed para que la etiqueta visual se mantenga en 0.
    if (document.getElementById('view-operator').style.display === 'block') {
        const extraVars = ['vsd_target_freq', 'vsd_max_speed'];
        
        extraVars.forEach(suffix => {
            const mId = TAG_MAP[suffix];
            if (mId && !idsToRead.includes(mId)) {
                idsToRead.push(mId);
                mapIdToSuffix[mId] = suffix;
            }
        });
    }

    if (idsToRead.length === 0) return;

    fetch('/api/read_batch', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ ids: idsToRead })
    })
    .then(r => { if (!r.ok) throw new Error("Device Unresponsive"); return r.json(); })
    .then(data => {
        pollErrorCount = 0; 
        for (const [modbusID, value] of Object.entries(data)) {
            if (value !== null) {
                const suffix = mapIdToSuffix[modbusID];
                const el = document.getElementById('val-' + suffix);
                
                if (el) {
                    // Manejo inteligente de Inputs vs Texto
                    if (el.tagName === 'INPUT') {
                        // Solo actualizamos si el usuario NO está escribiendo en ese momento
                        if (document.activeElement !== el) {
                            el.value = value;
                        }
                    } else {
                        el.innerText = value;
                    }
                }

                // --- ACTUALIZACIONES ESPECIALES ---
                
                // Actualizar Gauge de Operador
                if (suffix === 'vsd_frequency_out' && document.getElementById('view-operator').style.display === 'block') {
                    updateOperatorGauge(value);
                }
                
                // Actualizar Input Operador Target Speed
                if (suffix === 'vsd_target_freq' && document.getElementById('view-operator').style.display === 'block') {
                    const inputEl = document.getElementById('op-target-speed-input');
                    if (document.activeElement !== inputEl) inputEl.value = value;
                }

                // Actualizar etiquetas MAX en el Gauge
                if (suffix === 'vsd_max_speed') {
                    const elMax = document.getElementById('op-limit-max');
                    if(elMax) elMax.innerText = value;
                }
                // (Omitimos vsd_min_speed para mantener el "0" estático)
            }
        }
    })
    .catch(err => {
        console.error("Polling error:", err);
        pollErrorCount++;
        if (pollErrorCount >= 3) { handleLostConnection(); }
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
// 5. LÓGICA DE MENÚS Y PANELES
// =========================================================

function updateSidebarHighlight(activeType) {
    const homeBtn = document.querySelector('.home-btn');
    const menuBtn = document.querySelector('.menu-btn');
    const chartBtn = document.querySelector('.chart-btn');

    if (homeBtn) homeBtn.classList.remove('btn-active');
    if (menuBtn) menuBtn.classList.remove('btn-active');
    if (chartBtn) chartBtn.classList.remove('btn-active');

    if (activeType === 'home' && homeBtn) homeBtn.classList.add('btn-active');
    if (activeType === 'menu' && menuBtn) menuBtn.classList.add('btn-active');
    if (activeType === 'chart' && chartBtn) chartBtn.classList.add('btn-active');
}

function toggleMenuSystem() { 
    const chartModule = document.getElementById('view-chart-module');
    const isChartActive = (chartModule.style.display === 'block');

    if (isChartActive) {
        chartModule.style.display = 'none';
        if (currentMainIndex !== -1) {
            const mainData = menuData[currentMainIndex];
            if (mainList.children[currentMainIndex]) {
                mainList.children[currentMainIndex].classList.add('selected');
            }
            renderSubMenu(mainData);
            isMenuOpen = true;
            if (currentSubIndex !== -1) {
                const subName = mainData.subItems[currentSubIndex];
                breadcrumb.innerText = `Menu > ${mainData.name} > ${subName}`;
                loadView(subName); 
                if (subList.children[currentSubIndex]) {
                    subList.children[currentSubIndex].classList.add('selected');
                }
            } else {
                breadcrumb.innerText = `Menu > ${mainData.name}`;
                showSection('view-home'); 
            }
        } else {
            goHome(); 
            isMenuOpen = true;
            breadcrumb.innerText = "Menu";
        }
        updateSidebarHighlight('menu'); 
    } else {
        isMenuOpen = !isMenuOpen;
        if (isMenuOpen) {
            if (currentMainIndex === -1) breadcrumb.innerText = "Menu";
            updateSidebarHighlight('menu'); 
        } else {
            const homeView = document.getElementById('view-home');
            if (homeView.style.display === 'block') {
                updateSidebarHighlight('home');
            } else {
                updateSidebarHighlight('menu');
            }
        }
    }
    updateMenuVisibility(); 
}

function goHome(isStartup = false) {
    isMenuOpen = false; 
    currentMainIndex = -1; 
    currentSubIndex = -1;
    Array.from(mainList.children).forEach(el => el.classList.remove('selected'));
    Array.from(subList.children).forEach(el => el.classList.remove('selected'));
    breadcrumb.innerText = "Home";
    updateMenuVisibility(); 
    showSection('view-home');
    currentViewRows = [];
    if (!isStartup) {
        updateSidebarHighlight('home');
    }
}

function downloadConfig() { alert("Report download functionality in development."); }

function updateCustomLegend() {
    if (!myChart) return;

    const leftContainer = document.getElementById('legend-left');
    const rightContainer = document.getElementById('legend-right');
    
    leftContainer.innerHTML = '';
    rightContainer.innerHTML = '';

    myChart.data.datasets.forEach((dataset, index) => {
        const lastValue = dataset.data.length > 0 ? dataset.data[dataset.data.length - 1] : '--';
        
        const item = document.createElement('div');
        item.className = 'legend-item';
        if (!myChart.isDatasetVisible(index)) item.classList.add('hidden'); 

        item.onclick = () => {
            myChart.setDatasetVisibility(index, !myChart.isDatasetVisible(index));
            myChart.update();
            updateCustomLegend(); 
        };

        const colorBox = document.createElement('span');
        colorBox.className = 'legend-color-box';
        colorBox.style.backgroundColor = dataset.borderColor;
        colorBox.style.border = `1px solid ${dataset.borderColor}`;

        const text = document.createElement('span');
        text.innerText = `${dataset.origLabel}: ${lastValue} ${dataset.unit}`;

        item.appendChild(colorBox);
        item.appendChild(text);

        if (dataset.yAxisID === 'y') {
            leftContainer.appendChild(item); 
        } else {
            rightContainer.appendChild(item); 
        }
    });
}

// =========================================================
// 6. LÓGICA DE GRÁFICOS (CHART.JS)
// =========================================================

function initChart() {
    const ctx = document.getElementById('realtimeChart').getContext('2d');
    if (myChart) myChart.destroy();
    myChart = new Chart(ctx, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false, 
            interaction: { mode: 'index', intersect: false },
            plugins: {
                tooltip: { enabled: true, mode: 'index', position: 'nearest' },
                legend: { display: false } 
            },
            scales: {
                x: { display: true, title: { display: true, text: 'Time' } },
                y: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'Left Axis' } },
                y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Right Axis' } }
            }
        }
    });
}

function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) { color += letters[Math.floor(Math.random() * 16)]; }
    return color;
}

function openChartModule() {
    const target = document.getElementById('view-chart-module');
    if (target.style.display === 'block') return; 
    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
    target.style.display = 'block';
    document.getElementById('breadcrumb').innerText = "Chart"; 
    isMenuOpen = false;
    updateMenuVisibility();
    Array.from(mainList.children).forEach(el => el.classList.remove('selected'));
    Array.from(subList.children).forEach(el => el.classList.remove('selected'));
    if (!myChart) { setTimeout(initChart, 100); } else { myChart.resize(); myChart.update(); }
    const list = document.getElementById('chart-added-list');
    const btnClear = document.getElementById('btn-clear-vars');
    if (list && btnClear) { btnClear.disabled = (list.children.length === 0); }
    updateChartButtons();
    updateSidebarHighlight('chart');
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
    if(target) { target.style.display = 'block'; initViewNavigation(target); }
}

function loadView(viewName) {
    let targetId = 'view-default';
    switch(viewName) {
        case 'Operator': targetId = 'view-operator'; setTimeout(initOperatorGauge, 50); break;
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
    document.getElementById('breadcrumb').innerText = `Menu > ${menuData[index].name}`;
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
    document.getElementById('breadcrumb').innerText = `Menu > ${mainName} > ${name}`;
    loadView(name);
}

function updateClock() {
    const now = new Date();
    document.getElementById('clock').innerText = now.toLocaleString('en-GB');
}

function initDropdownLogic() {
    const selects = document.querySelectorAll('select.dynamic-select'); 
    selects.forEach(sel => {
        Array.from(sel.options).forEach(opt => { if (!opt.dataset.orig) opt.dataset.orig = opt.text; });
        const showNumbers = () => { Array.from(sel.options).forEach(opt => { opt.text = opt.dataset.orig; }); };
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

function toggleExtendedFreq() {
    const select = document.getElementById('pmm-ext-speed-mode');
    const row = document.getElementById('row-ext-base-freq');
    if (select && row) { row.style.display = (select.value === "1") ? 'flex' : 'none'; }
    updateConfigLocks();
}

function togglePMMFields() {
    const modeSelect = document.getElementById('pmm-setup-mode');
    if (!modeSelect) return;
    const isManual = (modeSelect.value === '2'); 
    const container = document.getElementById('view-pmm-configure-2');
    const fieldset = container.querySelector('fieldset.group-box'); 
    const inputs = fieldset.querySelectorAll('input, select');
    inputs.forEach(input => { if (input.id === 'pmm-setup-mode') return; input.disabled = !isManual; });
    updateConfigLocks();
}

function updateConfigLocks() {
    const setupMode = document.getElementById('pmm-setup-mode').value; 
    const extMode = document.getElementById('pmm-ext-speed-mode').value; 
    const transRatio = document.getElementById('cfg-transformer-ratio');
    const vsdSpeed = document.getElementById('cfg-vsd-speed');
    const volts = document.getElementById('cfg-base-volts');
    if(!transRatio || !vsdSpeed || !volts) return;
    if (setupMode === '2' && extMode === '1') {
        transRatio.disabled = true; vsdSpeed.disabled = true; volts.disabled = true;
        transRatio.classList.add('input-disabled'); vsdSpeed.classList.add('input-disabled'); volts.classList.add('input-disabled');
    } else {
        transRatio.disabled = false; vsdSpeed.disabled = false; volts.disabled = false;
        transRatio.classList.remove('input-disabled'); vsdSpeed.classList.remove('input-disabled'); volts.classList.remove('input-disabled');
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
    
    goHome(true); 
    
    document.getElementById('breadcrumb').innerText = "";
    setTimeout(initDropdownLogic, 100); 
    setTimeout(toggleExtendedFreq, 100); 
    setTimeout(togglePMMFields, 100); 
    setTimeout(updateConfigLocks, 100); 
}

init();

function updateSamplingRate() {
    const select = document.getElementById('chart-sampling-select');
    chartPollingRate = parseInt(select.value);
    if (isCharting && chartInterval) {
        clearInterval(chartInterval);
        chartInterval = setInterval(updateChartData, chartPollingRate);
    }
}

function coreAddVariable(value, text, optionElement) {
    const list = document.getElementById('chart-added-list');
    const btnClear = document.getElementById('btn-clear-vars');
    const samplingSelect = document.getElementById('chart-sampling-select'); 

    const existingItems = Array.from(list.children).map(li => li.dataset.value);
    if (existingItems.includes(value)) return;

    const targetAxis = DEFAULT_AXIS_MAP[value] || 'y';
    const axisLabel = (targetAxis === 'y1') ? '[R]' : '[L]';

    const timeSec = chartPollingRate / 1000;
    const li = document.createElement('li');
    li.dataset.value = value;
    li.dataset.axis = targetAxis; 
    li.innerText = `${axisLabel} ${text} (${timeSec} s)`; 
    li.onclick = function() { selectChartItem(this); };
    list.appendChild(li);

    if (samplingSelect) { samplingSelect.disabled = true; samplingSelect.classList.add('input-disabled'); }

    if (optionElement) {
        optionElement.disabled = true;
        optionElement.hidden = true;
        optionElement.style.display = 'none';
    }
    
    if(btnClear) btnClear.disabled = false;
    if (!myChart) initChart();

    const newDataset = {
        label: text, 
        origLabel: text, 
        unit: UNIT_MAP[value] || '',
        data: [], 
        borderColor: getRandomColor(), 
        borderWidth: 2, 
        fill: false, 
        pointRadius: 0, 
        pointHoverRadius: 5, 
        yAxisID: targetAxis 
    };
    
    myChart.data.datasets.push(newDataset);
    myChart.update();
    updateCustomLegend();
}

function addVariableToChart() {
    const select = document.getElementById('chart-var-select');
    
    if (select.selectedIndex === -1 || !select.value) return;

    let selectedOption = select.options[select.selectedIndex];
    let selectedText = selectedOption.text.replace(/^\d+\s+/, ''); 
    const selectedValue = select.value;

    coreAddVariable(selectedValue, selectedText, selectedOption);
    
    select.value = ""; 
}

function addGroupByLabel(groupLabel) {
    const select = document.getElementById('chart-var-select');
    const optgroups = select.getElementsByTagName('optgroup');
    
    let targetGroup = null;
    for (let i = 0; i < optgroups.length; i++) {
        if (optgroups[i].label === groupLabel) {
            targetGroup = optgroups[i];
            break;
        }
    }

    if (targetGroup) {
        const options = targetGroup.getElementsByTagName('option');
        for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            if (!opt.disabled) {
                coreAddVariable(opt.value, opt.text, opt);
            }
        }
        select.value = ""; 
    }
}

function addDHTGroup() {
    addGroupByLabel("Down Hole Tool");
}

function addVSDGroup() {
    addGroupByLabel("Variable Speed Drive");
}

function selectChartItem(element) {
    const list = document.getElementById('chart-added-list');
    const btnRemove = document.getElementById('btn-remove-var');
    const btnSwap = document.getElementById('btn-swap-axis');
    Array.from(list.children).forEach(child => child.classList.remove('selected'));
    element.classList.add('selected');
    btnRemove.disabled = false;
    btnSwap.disabled = false; 
}

function swapVariableAxis() {
    const list = document.getElementById('chart-added-list');
    const selectedItem = list.querySelector('.selected');
    if (!selectedItem || !myChart) return;
    const textInLi = selectedItem.innerText;
    const textClean = textInLi.replace(/^\[[LR]\]\s+/, '').replace(/\s\(\d+(\.\d+)?\s?s\)$/, '');
    const dataset = myChart.data.datasets.find(ds => ds.origLabel === textClean);
    const timeSec = chartPollingRate / 1000;
    
    if (dataset) {
        if (dataset.yAxisID === 'y') {
            dataset.yAxisID = 'y1'; 
            selectedItem.dataset.axis = 'y1'; 
            selectedItem.innerText = `[R] ${textClean} (${timeSec} s)`;
        } else {
            dataset.yAxisID = 'y'; 
            selectedItem.dataset.axis = 'y'; 
            selectedItem.innerText = `[L] ${textClean} (${timeSec} s)`;
        }
        myChart.update();
        updateCustomLegend();
    }
}

function removeVariableFromChart() {
    const list = document.getElementById('chart-added-list');
    const btnRemove = document.getElementById('btn-remove-var');
    const btnSwap = document.getElementById('btn-swap-axis');
    const btnClear = document.getElementById('btn-clear-vars');
    const samplingSelect = document.getElementById('chart-sampling-select'); 
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
            const textClean = textInLi.replace(/^\[[LR]\]\s+/, '').replace(/\s\(\d+(\.\d+)?\s?s\)$/, '');
            const datasetIndex = myChart.data.datasets.findIndex(ds => ds.origLabel === textClean);
            if (datasetIndex !== -1) { myChart.data.datasets.splice(datasetIndex, 1); myChart.update(); updateCustomLegend(); }
        }
        list.removeChild(selectedItem);
        btnRemove.disabled = true; btnSwap.disabled = true;
        if (list.children.length === 0) {
            if (btnClear) btnClear.disabled = true;
            if (samplingSelect) { samplingSelect.disabled = false; samplingSelect.classList.remove('input-disabled'); }
        }
    }
}

function clearAllVariables() {
    const list = document.getElementById('chart-added-list');
    const select = document.getElementById('chart-var-select');
    const btnRemove = document.getElementById('btn-remove-var');
    const btnSwap = document.getElementById('btn-swap-axis');
    const btnClear = document.getElementById('btn-clear-vars');
    const samplingSelect = document.getElementById('chart-sampling-select'); 

    for (let i = 1; i < select.options.length; i++) {
        select.options[i].disabled = false;
        select.options[i].hidden = false;
        select.options[i].style.display = '';
    }
    select.value = ""; 

    list.innerHTML = '';
    if (samplingSelect) { samplingSelect.disabled = false; samplingSelect.classList.remove('input-disabled'); }
    if (myChart) { myChart.data.datasets = []; myChart.data.labels = []; myChart.update(); updateCustomLegend(); }
    btnRemove.disabled = true; btnSwap.disabled = true; btnClear.disabled = true;
    
    updateChartButtons();
}

function updateChartButtons() {
    const btnStart = document.getElementById('btn-chart-start');
    const btnStop = document.getElementById('btn-chart-stop');
    const btnExport = document.getElementById('btn-export-csv');

    if (!btnStart || !btnStop || !btnExport) return; 

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

    const hasData = (myChart && myChart.data.labels.length > 0);
    
    if (hasData && !isCharting) {
        btnExport.disabled = false;
    } else {
        btnExport.disabled = true;
    }
}

function startChart() {
    if (!isCommActive) return alert("No connection.");
    if (document.getElementById('chart-added-list').children.length === 0) return alert("Add at least one variable.");
    isCharting = true;
    updateChartButtons();
    if (chartInterval) clearInterval(chartInterval);
    chartInterval = setInterval(updateChartData, chartPollingRate);
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
    .then(r => { if (!r.ok) throw new Error("Device Unresponsive"); return r.json(); })
    .then(data => {
        pollErrorCount = 0; 
        const nowLabel = new Date().toLocaleTimeString(); 
        myChart.data.labels.push(nowLabel);
        myChart.data.datasets.forEach(dataset => {
            const matchingLi = listItems.find(li => li.innerText.includes(dataset.origLabel));
            if (matchingLi) {
                const modbusID = matchingLi.dataset.value;
                const value = data[modbusID];
                if (value !== null && value !== undefined) { dataset.data.push(value); }
            }
        });
        myChart.update();
        updateCustomLegend();
    })
    .catch(err => {
        console.error("Chart polling error:", err);
        pollErrorCount++;
        if (pollErrorCount >= 3) { handleLostConnection(); }
    });
}

function exportChartToCSV() {
    if (!myChart || myChart.data.labels.length === 0) {
        alert("No data to export.");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    let header = ["Time"];
    
    myChart.data.datasets.forEach(ds => {
        let cleanLabel = ds.origLabel.replace(/,/g, ''); 
        header.push(`${cleanLabel} [${ds.unit}]`);
    });
    csvContent += header.join(",") + "\r\n";

    myChart.data.labels.forEach((label, i) => {
        let row = [label];
        myChart.data.datasets.forEach(ds => {
            let val = ds.data[i];
            row.push((val !== null && val !== undefined) ? val : "");
        });
        csvContent += row.join(",") + "\r\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const dateStr = new Date().toISOString().slice(0,19).replace(/:/g,"-");
    link.setAttribute("download", `VSD_Log_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// =========================================================
// 7. LÓGICA VISTA OPERATOR (Gauge Estilizado & Controles)
// =========================================================

let operatorChart = null;

function initOperatorGauge() {
    const ctx = document.getElementById('operatorGauge');
    if (!ctx) return;

    if (operatorChart) operatorChart.destroy();

    // ESTILO "HERRADURA" / ROUNDED DOUGHNUT (Cian/Gris)
    operatorChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Frequency', 'Remaining'],
            datasets: [{
                data: [0, 60], // Inicio en 0
                backgroundColor: [
                    '#00bcd4', // COLOR ACTIVO (Cyan)
                    '#eceff1'  // COLOR FONDO (Gris claro)
                ],
                borderWidth: 0,
                borderRadius: 20, // Bordes redondeados
                cutout: '85%',    // Grosor del anillo
                circumference: 260, // Ángulo total del gauge
                rotation: 230       // Rotación inicial
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                tooltip: { enabled: false }, // Sin tooltips
                legend: { display: false }   // Sin leyenda
            },
            // ACTIVAMOS ANIMACIÓN
            animation: {
                duration: 800, // 0.8s
                easing: 'easeOutQuart'
            }
        }
    });

    // Forzar etiqueta MIN a "0" estático al iniciar
    const elMin = document.getElementById('op-limit-min');
    if(elMin) elMin.innerText = "0"; 
}

function updateOperatorGauge(value) {
    if (!operatorChart) return;
    
    // 1. Leer Máximo dinámico
    const maxEl = document.getElementById('op-limit-max');
    let maxFreq = 60; 
    
    if (maxEl) {
        const parsedMax = parseFloat(maxEl.innerText);
        if (!isNaN(parsedMax) && parsedMax > 0) {
            maxFreq = parsedMax;
        }
    }

    let val = parseFloat(value);
    if (isNaN(val)) val = 0;
    
    // 2. Clampear valor
    if (val < 0) val = 0;
    if (val > maxFreq) val = maxFreq;

    // 3. Actualizar datos: [Valor Actual, Resto]
    operatorChart.data.datasets[0].data = [val, maxFreq - val];
    
    // 4. Actualizar CON animación
    operatorChart.update(); 
}

// NUEVO: Función para escribir la velocidad target desde el panel de operador
function writeTargetSpeed() {
    if (!isCommActive) {
        alert("Please connect first.");
        return;
    }
    
    const inputEl = document.getElementById('op-target-speed-input');
    const newVal = parseFloat(inputEl.value);
    
    if (isNaN(newVal) || newVal < 0) {
        alert("Invalid speed value");
        return;
    }

    // USAMOS EL NUEVO REGISTRO 'vsd_target_freq' (Dirección 855)
    fetch('/api/write', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ id: 'vsd_target_freq', value: newVal })
    })
    .then(r => r.json())
    .then(data => {
        if(data.status === 'success') {
            console.log("Target speed updated:", newVal);
            // Feedback visual breve
            inputEl.style.backgroundColor = "#dcedc8"; // Verde claro momentáneo
            setTimeout(() => inputEl.style.backgroundColor = "", 500);
        } else {
            alert("Error writing speed: " + data.error);
        }
    })
    .catch(err => alert("Comm Error: " + err));
}



// Función START actualizada: Envía 2 pulsos (ON-OFF-ON-OFF)
async function startVSD() {
    if (!isCommActive) return alert("System disconnected. Please connect first.");
    
    if (!confirm("Are you sure you want to START the VSD? (Sending 2 Pulses)")) return;

    // Helper para esperar (delay)
    const delay = ms => new Promise(res => setTimeout(res, ms));
    
    // Helper para escribir a la bobina de arranque
    const sendStartSignal = async (val) => {
        const response = await fetch('/api/write', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ id: 'vsd_remote_start', value: val })
        });
        return response.json();
    };

    // Referencia al botón para feedback visual
    const btn = document.querySelector('.btn-start');
    const originalText = btn.innerHTML;

    try {
        console.log("--- INICIANDO SECUENCIA DE ARRANQUE (2 PULSOS) ---");
        
        // --- PULSO 1 ---
        btn.innerHTML = '<span class="btn-icon">⏳</span> PULSE 1...';
        console.log("Pulse 1: HIGH (1)");
        await sendStartSignal(1);
        
        await delay(500); // 500ms encendido
        
        console.log("Pulse 1: LOW (0)");
        await sendStartSignal(0);
        
        await delay(500); // 500ms espera entre pulsos

        // --- PULSO 2 ---
        btn.innerHTML = '<span class="btn-icon">⏳</span> PULSE 2...';
        console.log("Pulse 2: HIGH (1)");
        await sendStartSignal(1);
        
        await delay(500); // 500ms encendido
        
        console.log("Pulse 2: LOW (0)");
        await sendStartSignal(0);

        // --- FINALIZADO ---
        console.log("--- SECUENCIA COMPLETADA ---");
        btn.innerHTML = originalText;
        alert("Start command (2 pulses) sent successfully.");

    } catch (err) {
        console.error(err);
        btn.innerHTML = originalText;
        alert("Error during start sequence: " + err);
    }
}





function stopVSD() {
    if (!isCommActive) return alert("System disconnected.");
    
    console.log("Sending STOP command...");
    
    // Enviamos un 1 al registro vsd_remote_stop (Offset 0)
    fetch('/api/write', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ id: 'vsd_remote_stop', value: 1 })
    })
    .then(r => r.json())
    .then(data => {
        if(data.status === 'success') {
            alert("Stop command sent successfully.");
        } else {
            alert("Error sending stop command: " + data.error);
        }
    })
    .catch(err => alert("Communication Error: " + err));
}


// Función genérica para escribir valores desde Inputs
function writeGeneric(suffix, value) {
    if (!isCommActive) {
        alert("Please connect first.");
        return;
    }
    
    const modbusID = TAG_MAP[suffix];
    if (!modbusID) return;

    fetch('/api/write', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ id: modbusID, value: value })
    })
    .then(r => r.json())
    .then(data => {
        if(data.status === 'success') {
            console.log(`Wrote ${value} to ${suffix}`);
            // Feedback visual: Parpadeo verde
            const el = document.getElementById('val-' + suffix);
            if(el) {
                const originalBg = el.style.backgroundColor;
                el.style.backgroundColor = "#dcedc8"; // Verde claro
                setTimeout(() => el.style.backgroundColor = originalBg, 500);
            }
        } else {
            alert("Error writing: " + (data.error || "Unknown"));
        }
    })
    .catch(err => alert("Comm Error: " + err));
}