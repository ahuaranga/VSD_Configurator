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
    def __init__(self, config):
        self.mode = config.get('connection_type', 'serial')  # 'serial' o 'tcp'
        self.config = config
        self.serial_inst = None
        self.tcp_client = None
        self.slave_id = 1

    def connect(self):
        if self.mode == 'serial':
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
            
            self.serial_inst.serial.reset_input_buffer()
            self.serial_inst.serial.reset_output_buffer()

        elif self.mode == 'tcp':
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
        if self.mode == 'serial':
            return self.serial_inst.read_register(address, decimals, functioncode=3, signed=False)
        
        elif self.mode == 'tcp':
            # CORRECCIÓN: Usamos 'device_id' en lugar de 'slave' para PyModbus 3.x
            rr = self.tcp_client.read_holding_registers(address=address, count=1, device_id=self.slave_id)
            if rr.isError():
                raise Exception(f"Error de lectura Modbus TCP: {rr}")
            
            raw_val = rr.registers[0]
            if decimals > 0:
                return float(raw_val) / (10 ** decimals)
            return raw_val

    def write_register(self, address, value, decimals=0):
        if self.mode == 'serial':
            self.serial_inst.write_register(address, value, decimals, functioncode=16, signed=False)
        
        elif self.mode == 'tcp':
            raw_val = int(value * (10 ** decimals))
            raw_val = raw_val & 0xFFFF
            
            # CORRECCIÓN: Usamos 'device_id' en lugar de 'slave' para PyModbus 3.x
            wr = self.tcp_client.write_register(address=address, value=raw_val, device_id=self.slave_id)
            if wr.isError():
                raise Exception(f"Error de escritura Modbus TCP: {wr}")


# -------------------------------------------------------------------------
# 3. LÓGICA DE API
# -------------------------------------------------------------------------

@app.route('/api/connect', methods=['POST'])
def connect_instrument():
    global instrument
    data = request.json
    with modbus_lock:
        if instrument:
            try: instrument.close()
            except: pass
            instrument = None

        try:
            instrument = VSDInstrument(data)
            instrument.connect()
            # Prueba de lectura con el registro 855 (validado en diagnóstico)
            instrument.read_register(855, 0)
            return jsonify({"status": "success", "message": "Conexión Exitosa"})
        except Exception as e:
            if instrument:
                try: instrument.close()
                except: pass
            instrument = None
            return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/disconnect', methods=['POST'])
def disconnect_instrument():
    global instrument
    with modbus_lock:
        try:
            if instrument: instrument.close()
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

    with modbus_lock:
        try:
            scale = reg_def.get('scale', 1)
            raw_value = int(user_value * scale)
            instrument.write_register(reg_def['address'], raw_value, decimals=0)
            return jsonify({"status": "success", "written": raw_value})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

@app.route('/api/read_batch', methods=['POST'])
def read_batch():
    global instrument
    if not instrument: return jsonify({"error": "Desconectado"}), 400
    requested_ids = request.json.get('ids', [])
    results = {}
    success_count = 0 
    with modbus_lock:
        for reg_id in requested_ids:
            reg_def = REGISTER_MAP.get(reg_id)
            if reg_def:
                try:
                    raw_val = instrument.read_register(reg_def['address'], decimals=0)
                    scale = reg_def.get('scale', 1)
                    real_val = raw_val / scale
                    results[reg_id] = real_val
                    success_count += 1
                except Exception as e:
                    results[reg_id] = None
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