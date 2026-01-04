import os
import sys
import webbrowser
import sqlite3
import serial.tools.list_ports
import minimalmodbus
# Importamos la librería para TCP/IP
from pymodbus.client import ModbusTcpClient
from threading import Timer, Lock
from flask import Flask, render_template, url_for, jsonify, request

# Importamos el mapa
from modbus_map import REGISTER_MAP

# -------------------------------------------------------------------------
# 1. CONFIGURACIÓN INICIAL
# -------------------------------------------------------------------------
instrument = None
modbus_lock = Lock()  # SEMÁFORO: Evita choques en el puerto serial/red

if getattr(sys, 'frozen', False):
    template_folder = os.path.join(sys._MEIPASS, 'templates')
    static_folder = os.path.join(sys._MEIPASS, 'static')
    app = Flask(__name__, template_folder=template_folder, static_folder=static_folder)
else:
    app = Flask(__name__)

DB_NAME = "vsd_config.db"


def init_db():
    try:
        with sqlite3.connect(DB_NAME) as conn:
            cursor = conn.cursor()
            cursor.execute(
                'CREATE TABLE IF NOT EXISTS config_serial (id INTEGER PRIMARY KEY, puerto TEXT, baudrate INTEGER)')
            conn.commit()
    except:
        pass


@app.route('/')
def home():
    return render_template('index.html')


@app.route('/api/ports')
def get_ports():
    ports_data = []
    try:
        ports = serial.tools.list_ports.comports()
        for port in ports:
            ports_data.append({"device": port.device, "description": port.description})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify(ports_data)


# -------------------------------------------------------------------------
# 2. CLASE WRAPPER HÍBRIDA (SERIAL + TCP)
# -------------------------------------------------------------------------
class VSDInstrument:
    """
    Clase unificada que maneja tanto Serial (minimalmodbus) como TCP (pymodbus).
    Actúa como un adaptador para que el resto del código no note la diferencia.
    """
    def __init__(self, config):
        self.mode = config.get('connection_type', 'serial')  # 'serial' o 'tcp'
        self.config = config
        self.serial_inst = None
        self.tcp_client = None
        self.slave_id = 1

    def connect(self):
        if self.mode == 'serial':
            # --- MODO SERIAL (Usando minimalmodbus) ---
            port = self.config.get('port')
            if not port:
                raise Exception("Puerto Serial no definido")
            
            self.serial_inst = minimalmodbus.Instrument(port, self.slave_id)
            self.serial_inst.serial.baudrate = int(self.config.get('baudrate', 19200))
            self.serial_inst.serial.bytesize = int(self.config.get('bytesize', 8))
            self.serial_inst.serial.parity = self.config.get('parity', 'N')
            self.serial_inst.serial.stopbits = int(self.config.get('stopbits', 1))
            self.serial_inst.serial.timeout = float(self.config.get('timeout', 1))
            self.serial_inst.mode = minimalmodbus.MODE_RTU
            
            # Limpiar buffers
            self.serial_inst.serial.reset_input_buffer()
            self.serial_inst.serial.reset_output_buffer()

        elif self.mode == 'tcp':
            # --- MODO TCP/IP (Usando pymodbus) ---
            ip = self.config.get('ip_address')
            port = int(self.config.get('tcp_port', 502))
            if not ip:
                raise Exception("Dirección IP no definida")

            self.tcp_client = ModbusTcpClient(ip, port=port, timeout=float(self.config.get('timeout', 1)))
            if not self.tcp_client.connect():
                 raise Exception(f"No se pudo conectar a {ip}:{port}")
        else:
            raise Exception(f"Modo de conexión desconocido: {self.mode}")

    def close(self):
        if self.serial_inst and self.serial_inst.serial:
            self.serial_inst.serial.close()
        if self.tcp_client:
            self.tcp_client.close()

    def read_register(self, address, decimals=0):
        """
        Lee un registro. Emula el comportamiento de minimalmodbus:
        devuelve un entero (si decimals=0) o float ajustado.
        """
        if self.mode == 'serial':
            return self.serial_inst.read_register(address, decimals, functioncode=3, signed=False)
        
        elif self.mode == 'tcp':
            # pymodbus lee registros 'raw'
            rr = self.tcp_client.read_holding_registers(address, count=1, slave=self.slave_id)
            if rr.isError():
                raise Exception("Error de lectura Modbus TCP")
            
            raw_val = rr.registers[0]
            
            # Ajuste de decimales manual para igualar a minimalmodbus
            if decimals > 0:
                return float(raw_val) / (10 ** decimals)
            return raw_val

    def write_register(self, address, value, decimals=0):
        """
        Escribe un registro.
        """
        if self.mode == 'serial':
            self.serial_inst.write_register(address, value, decimals, functioncode=16, signed=False)
        
        elif self.mode == 'tcp':
            # pymodbus espera el valor raw entero
            raw_val = int(value * (10 ** decimals))
            # Asegurar que cabe en 16 bits (unsigned)
            raw_val = raw_val & 0xFFFF
            
            wr = self.tcp_client.write_register(address, raw_val, slave=self.slave_id)
            if wr.isError():
                raise Exception("Error de escritura Modbus TCP")


# -------------------------------------------------------------------------
# 3. LÓGICA DE API (CONECTAR, LEER, ESCRIBIR)
# -------------------------------------------------------------------------

@app.route('/api/connect', methods=['POST'])
def connect_instrument():
    global instrument
    data = request.json

    # Usamos Lock para asegurar que no se interrumpa la conexión
    with modbus_lock:
        # Si ya existe conexión, cerrar la anterior
        if instrument:
            try:
                instrument.close()
            except:
                pass
            instrument = None

        try:
            # Instanciamos nuestra clase híbrida
            instrument = VSDInstrument(data)
            instrument.connect()

            # Prueba de lectura para confirmar conexión (Overcurrent 717)
            # Usamos address directo como prueba
            instrument.read_register(717, 0)

            return jsonify({"status": "success", "message": "Conexión Exitosa"})
        except Exception as e:
            if instrument:
                try: instrument.close()
                except: pass
            instrument = None
            print(f"Error Conexión: {e}")
            return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/disconnect', methods=['POST'])
def disconnect_instrument():
    global instrument
    with modbus_lock:
        try:
            if instrument:
                instrument.close()
            instrument = None
            return jsonify({"status": "success", "message": "Desconectado"})
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/write', methods=['POST'])
def write_register():
    global instrument
    if not instrument: return jsonify({"error": "Desconectado"}), 400

    data = request.json
    reg_id = data.get('id')
    user_value = float(data.get('value'))

    reg_def = REGISTER_MAP.get(reg_id)
    if not reg_def: return jsonify({"error": "Registro no mapeado"}), 404

    # BLOQUEO: Evita que el polling de la gráfica interrumpa la escritura
    with modbus_lock:
        try:
            # Calculamos el valor raw según la escala definida en el mapa
            scale = reg_def.get('scale', 1)
            
            # Para escritura, nuestra clase VSDInstrument espera el valor "humano" 
            # y el número de decimales si usáramos minimalmodbus, pero aquí
            # es más fácil pasarle el valor raw si decimals=0.
            # Sin embargo, para mantener compatibilidad con la lógica anterior:
            # Anteriormente: raw_value = int(user_value * scale) -> write(addr, raw, 0)
            
            raw_value = int(user_value * scale)
            instrument.write_register(reg_def['address'], raw_value, decimals=0)
            
            return jsonify({"status": "success", "written": raw_value})
        except Exception as e:
            return jsonify({"error": str(e)}), 500


@app.route('/api/read_batch', methods=['POST'])
def read_batch():
    """Lee una lista de IDs y devuelve sus valores actuales"""
    global instrument
    if not instrument: return jsonify({"error": "Desconectado"}), 400

    requested_ids = request.json.get('ids', [])
    results = {}
    success_count = 0  # Para detectar si el dispositivo está vivo

    # BLOQUEO: Protegemos la ráfaga de lecturas
    with modbus_lock:
        for reg_id in requested_ids:
            reg_def = REGISTER_MAP.get(reg_id)
            if reg_def:
                try:
                    # Lectura usando el wrapper
                    # Leemos con 0 decimales (valor raw entero)
                    raw_val = instrument.read_register(reg_def['address'], decimals=0)
                    
                    # Aplicamos escala (definida en modbus_map)
                    scale = reg_def.get('scale', 1)
                    real_val = raw_val / scale
                    
                    results[reg_id] = real_val
                    success_count += 1
                except Exception as e:
                    # print(f"Error leyendo {reg_id}: {e}")
                    results[reg_id] = None

    # WATCHDOG: Si intentamos leer algo y NADA respondió, asumimos desconexión física
    if len(requested_ids) > 0 and success_count == 0:
        return jsonify({"error": "Device unresponsive"}), 500

    return jsonify(results)


# -------------------------------------------------------------------------
# 4. LANZAMIENTO
# -------------------------------------------------------------------------
def open_browser():
    if not os.environ.get("WERKZEUG_RUN_MAIN"):
        webbrowser.open_new('http://127.0.0.1:5001/')


if __name__ == "__main__":
    init_db()
    Timer(1, open_browser).start()
    app.run(host='0.0.0.0', port=5001, debug=True)