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
# 2. CLASE WRAPPER DEFINITIVA (Soporte Coil vs Register + Site Name)
# -------------------------------------------------------------------------
class VSDInstrument:
    def __init__(self, config):
        self.mode = config.get('connection_type', 'serial')
        self.config = config
        self.client = None
        self.slave_id = 1
        self.id_arg_name = 'device_id' # Según diagnóstico previo (Pymodbus v3.11.4)

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

        if not self.client.connect():
            raise Exception(f"Fallo al conectar ({self.mode}).")

    def close(self):
        if self.client:
            self.client.close()

    def read_register(self, address, decimals=0, reg_type='uint'):
        """
        Lee datos según el tipo (coil o registro numérico).
        """
        if not self.client:
            raise Exception("Cliente no conectado")

        kwargs = {self.id_arg_name: self.slave_id}
        
        if reg_type == 'coil':
            # Leer Bobina (Coil - FC01)
            rr = self.client.read_coils(address=address, count=1, **kwargs)
            if rr.isError():
                raise Exception(f"Error Modbus (Lectura Coil): {rr}")
            return 1 if rr.bits[0] else 0
        else:
            # Leer Registro (Holding Register - FC03)
            rr = self.client.read_holding_registers(address=address, count=1, **kwargs)
            if rr.isError():
                raise Exception(f"Error Modbus (Lectura Reg): {rr}")
            raw_val = rr.registers[0]
            if decimals > 0:
                return float(raw_val) / (10 ** decimals)
            return raw_val

    def write_register(self, address, value, decimals=0, reg_type='uint'):
        """
        Escribe datos según el tipo.
        Si es 'coil', usa write_coil (FC05).
        Si es 'uint', usa write_registers (FC16).
        """
        if not self.client:
            raise Exception("Cliente no conectado")

        kwargs = {self.id_arg_name: self.slave_id}

        if reg_type == 'coil':
            # Escribir Bobina (FC05)
            # Convertimos valor a Booleano (1 -> True, 0 -> False)
            bool_val = True if value > 0 else False
            wr = self.client.write_coil(address=address, value=bool_val, **kwargs)
            if wr.isError():
                raise Exception(f"Error Modbus (Escritura Coil): {wr}")
        else:
            # Escribir Registro (FC16)
            raw_val = int(value * (10 ** decimals))
            raw_val = raw_val & 0xFFFF 
            wr = self.client.write_registers(address=address, values=[raw_val], **kwargs)
            if wr.isError():
                raise Exception(f"Error Modbus (Escritura Reg): {wr}")

    # --- NUEVA FUNCIONALIDAD: SITE NAME (ASCII) ---
    def read_site_name(self):
        """Lee registros 1024-1028 y decodifica a ASCII (String)."""
        if not self.client:
            raise Exception("Cliente no conectado")
        
        kwargs = {self.id_arg_name: self.slave_id}
        
        # Leemos 5 registros (10 caracteres)
        rr = self.client.read_holding_registers(address=1024, count=5, **kwargs)
        if rr.isError():
            raise Exception(f"Error leyendo Site Name: {rr}")
        
        decoded_name = ""
        for reg in rr.registers:
            # Extraer byte alto y bajo
            char_hi = chr((reg >> 8) & 0xFF)
            char_lo = chr(reg & 0xFF)
            decoded_name += char_hi + char_lo
            
        # Limpiar caracteres nulos
        return decoded_name.rstrip('\0')

    def write_site_name(self, name_str):
        """Codifica String a ASCII y escribe en registros 1024-1028."""
        if not self.client:
            raise Exception("Cliente no conectado")
            
        # Asegurar longitud exacta de 10 caracteres, rellenar con nulos
        name = name_str[:10].ljust(10, '\0')
        regs = []
        
        # Codificar en pares de bytes (High/Low)
        for i in range(0, 10, 2):
            val = (ord(name[i]) << 8) | ord(name[i+1])
            regs.append(val)
            
        kwargs = {self.id_arg_name: self.slave_id}
        
        # Usar Write Registers (FC16)
        wr = self.client.write_registers(address=1024, values=regs, **kwargs)
        if wr.isError():
            raise Exception(f"Error escribiendo Site Name: {wr}")


# -------------------------------------------------------------------------
# 3. LÓGICA DE API (Rutas Flask)
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
            # Determinamos tipo (coil o uint)
            rtype = reg_def.get('type', 'uint')
            
            decimals = 0
            if scale == 10: decimals = 1
            elif scale == 100: decimals = 2
            elif scale == 1000: decimals = 3
            
            # Pasamos rtype a la función de escritura
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
                    
                    # Pasamos rtype a la función de lectura
                    real_val = instrument.read_register(reg_def['address'], decimals=decimals, reg_type=rtype)
                    results[reg_id] = real_val
                    success_count += 1
                except Exception as e:
                    results[reg_id] = None
                    
    if len(requested_ids) > 0 and success_count == 0:
        return jsonify({"error": "Device unresponsive"}), 500
    return jsonify(results)

# --- NUEVA RUTA PARA SITE NAME ---
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