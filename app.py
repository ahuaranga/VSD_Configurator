import os
import sys
import webbrowser
import sqlite3
import serial.tools.list_ports
from threading import Timer, Lock
from flask import Flask, render_template, url_for, jsonify, request
import logging

# -------------------------------------------------------------------------
# MIGRACIÓN: Pymodbus v3.11+
# -------------------------------------------------------------------------
from pymodbus.client import ModbusTcpClient, ModbusSerialClient

# Importamos el mapa de registros
from modbus_map import REGISTER_MAP

# -------------------------------------------------------------------------
# 1. CONFIGURACIÓN INICIAL
# -------------------------------------------------------------------------
instrument = None
modbus_lock = Lock()

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
# 2. CLASE WRAPPER DEFINITIVA (Ajustada a tu entorno)
# -------------------------------------------------------------------------
class VSDInstrument:
    def __init__(self, config):
        self.mode = config.get('connection_type', 'serial')
        self.config = config
        self.client = None
        self.slave_id = 1
        
        # Según tu diagnóstico, tu versión usa 'device_id'.
        self.id_arg_name = 'device_id'

    def connect(self):
        if self.mode == 'serial':
            port = self.config.get('port')
            if not port:
                raise Exception("Puerto Serial no definido")
            
            # Configuración Serial para Pymodbus v3.x (SIN method='rtu')
            self.client = ModbusSerialClient(
                port=port,
                baudrate=int(self.config.get('baudrate', 19200)),
                bytesize=int(self.config.get('bytesize', 8)),
                parity=self.config.get('parity', 'N'),
                stopbits=int(self.config.get('stopbits', 1)),
                timeout=float(self.config.get('timeout', 1))
            )

        elif self.mode == 'tcp':
            ip = self.config.get('ip_address')
            tcp_port = int(self.config.get('tcp_port', 502))
            if not ip:
                raise Exception("Dirección IP no definida")

            self.client = ModbusTcpClient(
                host=ip,
                port=tcp_port,
                timeout=float(self.config.get('timeout', 1))
            )
        else:
            raise Exception(f"Modo desconocido: {self.mode}")

        # Intentamos conectar
        if not self.client.connect():
            raise Exception(f"Fallo al conectar ({self.mode}).")

    def close(self):
        if self.client:
            self.client.close()

    def read_register(self, address, decimals=0):
        if not self.client:
            raise Exception("Cliente no conectado")

        # Usamos el argumento 'device_id' detectado
        kwargs = {self.id_arg_name: self.slave_id}
        
        rr = self.client.read_holding_registers(address=address, count=1, **kwargs)
        
        if rr.isError():
            raise Exception(f"Error Modbus (Lectura): {rr}")

        raw_val = rr.registers[0]

        if decimals > 0:
            return float(raw_val) / (10 ** decimals)
        return raw_val

    def write_register(self, address, value, decimals=0):
        if not self.client:
            raise Exception("Cliente no conectado")

        raw_val = int(value * (10 ** decimals))
        raw_val = raw_val & 0xFFFF 

        # Usamos el argumento 'device_id' detectado
        kwargs = {self.id_arg_name: self.slave_id}

        # Usamos write_registers (plural) para forzar FC16
        wr = self.client.write_registers(address=address, values=[raw_val], **kwargs)

        if wr.isError():
            raise Exception(f"Error Modbus (Escritura): {wr}")


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
            
            # Prueba de lectura (Health Check)
            instrument.read_register(855, 0)
            
            return jsonify({"status": "success", "message": "Conectado"})
        except Exception as e:
            if instrument:
                try: instrument.close()
                except: pass
            instrument = None
            print(f"ERROR: {e}") # Log consola
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
def write_register_endpoint():
    global instrument
    if not instrument: return jsonify({"error": "Desconectado"}), 400
    data = request.json
    reg_id = data.get('id')
    try:
        user_value = float(data.get('value'))
    except:
        return jsonify({"error": "Valor numérico inválido"}), 400
    
    reg_def = REGISTER_MAP.get(reg_id)
    if not reg_def: return jsonify({"error": "Registro no mapeado"}), 404

    with modbus_lock:
        try:
            scale = reg_def.get('scale', 1)
            decimals = 0
            if scale == 10: decimals = 1
            elif scale == 100: decimals = 2
            elif scale == 1000: decimals = 3
            
            instrument.write_register(reg_def['address'], user_value, decimals=decimals)
            return jsonify({"status": "success", "written": user_value})
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
                    scale = reg_def.get('scale', 1)
                    decimals = 0
                    if scale == 10: decimals = 1
                    elif scale == 100: decimals = 2
                    elif scale == 1000: decimals = 3
                    
                    real_val = instrument.read_register(reg_def['address'], decimals=decimals)
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