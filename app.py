import os
import sys
import webbrowser
import sqlite3
import serial.tools.list_ports
import inspect  # <--- NUEVO: Para auto-detectar el argumento correcto
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
# 2. CLASE WRAPPER DEFINITIVA (Con Auto-Detección de Argumentos)
# -------------------------------------------------------------------------
class VSDInstrument:
    def __init__(self, config):
        self.mode = config.get('connection_type', 'serial')
        self.config = config
        self.client = None
        self.slave_id = 1
        # Valor inicial seguro (se ajustará dinámicamente al conectar)
        self.id_arg_name = 'slave' 

    def connect(self):
        if self.mode == 'serial':
            port = self.config.get('port')
            if not port:
                raise Exception("Puerto Serial no definido")
            
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

        # Intentar conectar
        if not self.client.connect():
            raise Exception(f"Fallo al conectar ({self.mode}).")

        # --- DETECCIÓN INTELIGENTE DE ARGUMENTO ---
        # Esto soluciona el conflicto TCP vs Serial en Pymodbus 3.11.4
        try:
            # Inspeccionamos qué argumentos acepta la función de lectura del cliente actual
            sig = inspect.signature(self.client.read_holding_registers)
            params = list(sig.parameters.keys())
            
            if 'device_id' in params:
                self.id_arg_name = 'device_id' # Típico en Serial v3.11.4
            elif 'slave' in params:
                self.id_arg_name = 'slave'     # Típico en TCP v3.x
            elif 'unit' in params:
                self.id_arg_name = 'unit'      # Típico en v2.x
            else:
                self.id_arg_name = 'slave'     # Default
                
            print(f"DEBUG: Cliente {self.mode} configurado con argumento ID: '{self.id_arg_name}'")
            
        except Exception as e:
            print(f"WARNING: Fallo inspección dinámica ({e}). Usando 'slave' por defecto.")
            self.id_arg_name = 'slave'

    def close(self):
        if self.client:
            self.client.close()

    def read_register(self, address, decimals=0, reg_type='uint'):
        if not self.client:
            raise Exception("Cliente no conectado")

        # Usamos el argumento detectado dinámicamente
        kwargs = {self.id_arg_name: self.slave_id}
        
        if reg_type == 'coil':
            rr = self.client.read_coils(address=address, count=1, **kwargs)
            if rr.isError():
                raise Exception(f"Error Modbus (Lectura Coil): {rr}")
            return 1 if rr.bits[0] else 0
        else:
            rr = self.client.read_holding_registers(address=address, count=1, **kwargs)
            if rr.isError():
                raise Exception(f"Error Modbus (Lectura Reg): {rr}")
            raw_val = rr.registers[0]
            if decimals > 0:
                return float(raw_val) / (10 ** decimals)
            return raw_val

    def write_register(self, address, value, decimals=0, reg_type='uint'):
        if not self.client:
            raise Exception("Cliente no conectado")

        kwargs = {self.id_arg_name: self.slave_id}

        if reg_type == 'coil':
            bool_val = True if value > 0 else False
            wr = self.client.write_coil(address=address, value=bool_val, **kwargs)
            if wr.isError():
                raise Exception(f"Error Modbus (Escritura Coil): {wr}")
        else:
            raw_val = int(value * (10 ** decimals))
            raw_val = raw_val & 0xFFFF 
            wr = self.client.write_registers(address=address, values=[raw_val], **kwargs)
            if wr.isError():
                raise Exception(f"Error Modbus (Escritura Reg): {wr}")

    # --- SITE NAME (ASCII) ---
    def read_site_name(self):
        """Lee registros 1024-1028 y decodifica a ASCII."""
        if not self.client:
            raise Exception("Cliente no conectado")
        
        kwargs = {self.id_arg_name: self.slave_id}
        
        rr = self.client.read_holding_registers(address=1024, count=5, **kwargs)
        if rr.isError():
            raise Exception(f"Error leyendo Site Name: {rr}")
        
        decoded_name = ""
        for reg in rr.registers:
            char_hi = chr((reg >> 8) & 0xFF)
            char_lo = chr(reg & 0xFF)
            decoded_name += char_hi + char_lo
            
        return decoded_name.rstrip('\0')

    def write_site_name(self, name_str):
        """Codifica String a ASCII y escribe."""
        if not self.client:
            raise Exception("Cliente no conectado")
            
        name = name_str[:10].ljust(10, '\0')
        regs = []
        for i in range(0, 10, 2):
            val = (ord(name[i]) << 8) | ord(name[i+1])
            regs.append(val)
            
        kwargs = {self.id_arg_name: self.slave_id}
        
        wr = self.client.write_registers(address=1024, values=regs, **kwargs)
        if wr.isError():
            raise Exception(f"Error escribiendo Site Name: {wr}")


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
            # Health Check (Lectura de prueba para confirmar conexión)
            instrument.read_register(855, 0)
            return jsonify({"status": "success", "message": "Conectado"})
        except Exception as e:
            if instrument:
                try: instrument.close()
                except: pass
            instrument = None
            print(f"ERROR: {e}") 
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
            rtype = reg_def.get('type', 'uint')
            
            decimals = 0
            if scale == 10: decimals = 1
            elif scale == 100: decimals = 2
            elif scale == 1000: decimals = 3
            
            instrument.write_register(reg_def['address'], user_value, decimals=decimals, reg_type=rtype)
            
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
                    rtype = reg_def.get('type', 'uint')
                    
                    decimals = 0
                    if scale == 10: decimals = 1
                    elif scale == 100: decimals = 2
                    elif scale == 1000: decimals = 3
                    
                    real_val = instrument.read_register(reg_def['address'], decimals=decimals, reg_type=rtype)
                    results[reg_id] = real_val
                    success_count += 1
                except Exception as e:
                    results[reg_id] = None
                    
    if len(requested_ids) > 0 and success_count == 0:
        return jsonify({"error": "Device unresponsive"}), 500
    return jsonify(results)

@app.route('/api/site_name', methods=['GET', 'POST'])
def handle_site_name():
    global instrument
    if not instrument: 
        return jsonify({"error": "Desconectado"}), 400
    
    with modbus_lock:
        try:
            if request.method == 'GET':
                name = instrument.read_site_name()
                return jsonify({"status": "success", "name": name})
            else: # POST
                data = request.json
                new_name = data.get('name', '')
                instrument.write_site_name(new_name)
                return jsonify({"status": "success"})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

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