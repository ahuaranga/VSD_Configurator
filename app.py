import os
import sys
import webbrowser
import sqlite3
import serial.tools.list_ports
import minimalmodbus
from threading import Timer
from flask import Flask, render_template, url_for, jsonify, request

# Importamos el mapa
from modbus_map import REGISTER_MAP

# -------------------------------------------------------------------------
# 1. CONFIGURACIÓN INICIAL
# -------------------------------------------------------------------------
instrument = None

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
# 3. LÓGICA MODBUS (CONECTAR, LEER CONSTANTE, ESCRIBIR)
# -------------------------------------------------------------------------

@app.route('/api/connect', methods=['POST'])
def connect_instrument():
    global instrument
    data = request.json

    if instrument:
        try:
            if instrument.serial and instrument.serial.is_open:
                instrument.serial.close()
        except:
            pass
        instrument = None

    try:
        instrument = minimalmodbus.Instrument(data['port'], 1)
        instrument.serial.baudrate = int(data.get('baudrate', 19200))
        instrument.serial.bytesize = int(data.get('bytesize', 8))
        instrument.serial.parity = data.get('parity', 'E')
        instrument.serial.stopbits = int(data.get('stopbits', 1))
        instrument.serial.timeout = float(data.get('timeout', 1))
        instrument.mode = minimalmodbus.MODE_RTU

        # Prueba de lectura
        instrument.read_register(717, 0)

        return jsonify({"status": "success", "message": "Conexión Exitosa"})
    except Exception as e:
        instrument = None
        print(f"Error Modbus: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/disconnect', methods=['POST'])
def disconnect_instrument():
    global instrument
    try:
        if instrument and instrument.serial:
            instrument.serial.close()
        instrument = None
        return jsonify({"status": "success", "message": "Puerto cerrado"})
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

    try:
        scale = reg_def.get('scale', 1)
        raw_value = int(user_value * scale)
        instrument.write_register(reg_def['address'], raw_value, 0)
        return jsonify({"status": "success", "written": raw_value})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# --- NUEVO: ENDPOINT PARA LECTURA MASIVA (POLLING) ---
@app.route('/api/read_batch', methods=['POST'])
def read_batch():
    """Lee una lista de IDs y devuelve sus valores actuales"""
    global instrument
    if not instrument: return jsonify({"error": "Desconectado"}), 400

    requested_ids = request.json.get('ids', [])  # Lista de IDs: ['vsd_ol_setpoint_0', ...]
    results = {}

    for reg_id in requested_ids:
        reg_def = REGISTER_MAP.get(reg_id)
        if reg_def:
            try:
                # Lectura Modbus
                raw_val = instrument.read_register(reg_def['address'], 0)  # 0 = decimal
                # Aplicar escala inversa (Ej: leemos 100 -> devolvemos 10.0)
                scale = reg_def.get('scale', 1)
                real_val = raw_val / scale
                results[reg_id] = real_val
            except Exception as e:
                # Si falla uno, no rompemos todo, solo marcamos error en ese valor
                print(f"Error leyendo {reg_id}: {e}")
                results[reg_id] = None

    return jsonify(results)


# -------------------------------------------------------------------------
# 4. LANZAMIENTO
# -------------------------------------------------------------------------
def open_browser():
    if not os.environ.get("WERKZEUG_RUN_MAIN"):
        webbrowser.open_new('http://127.0.0.1:5000/')


if __name__ == "__main__":
    init_db()
    Timer(1, open_browser).start()
    app.run(host='0.0.0.0', port=5000, debug=True)