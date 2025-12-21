import os
import sys
import webbrowser
import sqlite3
import serial.tools.list_ports
import minimalmodbus
from threading import Timer, Lock
from flask import Flask, render_template, url_for, jsonify, request

# Importamos el mapa
from modbus_map import REGISTER_MAP

# -------------------------------------------------------------------------
# 1. CONFIGURACIÓN INICIAL
# -------------------------------------------------------------------------
instrument = None
modbus_lock = Lock()  # SEMÁFORO: Evita choques en el puerto serial

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
                'CREATE TABLE IF NOT EXISTS config_serial (id INTEGER PRIMARY KEY, puerto TEXT, baudrate INTEGER)'
            )
            conn.commit()
    except:
        pass


# IMPORTANTE:
# En Render (Gunicorn) NO se ejecuta el bloque __main__,
# así que la DB debe inicializarse también cuando el módulo se carga.
init_db()


@app.route('/')
def home():
    return render_template('index.html')


# -------------------------------------------------------------------------
# 2. ENDPOINTS API
# -------------------------------------------------------------------------
@app.route('/api/ports')
def get_ports():
    """Lista puertos serial disponibles"""
    ports = serial.tools.list_ports.comports()
    return jsonify([p.device for p in ports])


@app.route('/api/connect', methods=['POST'])
def connect_modbus():
    """Conecta a Modbus RTU según puerto y baudrate enviados"""
    global instrument
    data = request.json

    # Usamos Lock para asegurar que no se interrumpa la conexión
    with modbus_lock:
        if instrument:
            try:
                if instrument.serial and instrument.serial.is_open:
                    instrument.serial.close()
            except:
                pass
            instrument = None

        try:
            port = data.get('port')
            baud = int(data.get('baudrate', 9600))
            slave = int(data.get('slave', 1))

            instrument = minimalmodbus.Instrument(port, slave)
            instrument.serial.baudrate = baud
            instrument.serial.timeout = 0.2
            instrument.mode = minimalmodbus.MODE_RTU

            # Guardar configuración
            try:
                with sqlite3.connect(DB_NAME) as conn:
                    cursor = conn.cursor()
                    cursor.execute('DELETE FROM config_serial')
                    cursor.execute('INSERT INTO config_serial (puerto, baudrate) VALUES (?, ?)', (port, baud))
                    conn.commit()
            except:
                pass

            return jsonify({"status": "connected", "port": port, "baudrate": baud, "slave": slave})

        except Exception as e:
            instrument = None
            return jsonify({"status": "error", "error": str(e)}), 500


@app.route('/api/disconnect', methods=['POST'])
def disconnect_modbus():
    """Desconecta el instrumento actual"""
    global instrument
    with modbus_lock:
        if instrument:
            try:
                if instrument.serial and instrument.serial.is_open:
                    instrument.serial.close()
            except:
                pass
            instrument = None
    return jsonify({"status": "disconnected"})


@app.route('/api/read_register', methods=['GET'])
def read_register():
    """Lee un registro Modbus según ID del mapa"""
    global instrument
    if not instrument:
        return jsonify({"error": "Desconectado"}), 400

    reg_id = request.args.get('id')
    reg_def = REGISTER_MAP.get(reg_id)
    if not reg_def:
        return jsonify({"error": "Registro no mapeado"}), 404

    with modbus_lock:
        try:
            addr = reg_def['address']
            fc = reg_def.get('fc', 3)  # por defecto holding register
            scale = reg_def.get('scale', 1)
            signed = reg_def.get('signed', False)
            decimals = reg_def.get('decimals', 0)

            if fc == 3:
                raw = instrument.read_register(addr, decimals, signed=signed)
            elif fc == 4:
                raw = instrument.read_register(addr, decimals, signed=signed, functioncode=4)
            else:
                raw = instrument.read_register(addr, decimals, signed=signed)

            value = raw / scale if scale else raw
            return jsonify({"id": reg_id, "value": value, "raw": raw})
        except Exception as e:
            return jsonify({"error": str(e)}), 500


@app.route('/api/write_register', methods=['POST'])
def write_register():
    global instrument
    if not instrument:
        return jsonify({"error": "Desconectado"}), 400

    data = request.json
    reg_id = data.get('id')
    user_value = float(data.get('value'))

    reg_def = REGISTER_MAP.get(reg_id)
    if not reg_def:
        return jsonify({"error": "Registro no mapeado"}), 404

    # BLOQUEO: Evita que el polling de la gráfica interrumpa la escritura
    with modbus_lock:
        try:
            scale = reg_def.get('scale', 1)
            raw_value = int(user_value * scale)
            instrument.write_register(reg_def['address'], raw_value, 0)
            return jsonify({"status": "success", "written": raw_value})
        except Exception as e:
            return jsonify({"error": str(e)}), 500


@app.route('/api/read_batch', methods=['POST'])
def read_batch():
    """Lee una lista de IDs y devuelve sus valores actuales"""
    global instrument
    if not instrument:
        return jsonify({"error": "Desconectado"}), 400

    requested_ids = request.json.get('ids', [])
    results = {}
    success_count = 0  # Para detectar si algo está respondiendo

    with modbus_lock:
        for reg_id in requested_ids:
            reg_def = REGISTER_MAP.get(reg_id)
            if not reg_def:
                results[reg_id] = {"error": "Registro no mapeado"}
                continue

            try:
                addr = reg_def['address']
                fc = reg_def.get('fc', 3)
                scale = reg_def.get('scale', 1)
                signed = reg_def.get('signed', False)
                decimals = reg_def.get('decimals', 0)

                if fc == 3:
                    raw = instrument.read_register(addr, decimals, signed=signed)
                elif fc == 4:
                    raw = instrument.read_register(addr, decimals, signed=signed, functioncode=4)
                else:
                    raw = instrument.read_register(addr, decimals, signed=signed)

                value = raw / scale if scale else raw
                results[reg_id] = {"value": value, "raw": raw}
                success_count += 1

            except Exception as e:
                results[reg_id] = {"error": str(e)}

    return jsonify({"results": results, "success_count": success_count})


# -------------------------------------------------------------------------
# 4. LANZAMIENTO
# -------------------------------------------------------------------------
def open_browser():
    # En servidores (p. ej. Render) no tiene sentido abrir un navegador.
    if os.environ.get("RENDER") or os.environ.get("RENDER_SERVICE_ID") or os.environ.get("RENDER_EXTERNAL_URL"):
        return

    # Evita abrir 2 veces cuando Flask recarga en modo debug
    if not os.environ.get("WERKZEUG_RUN_MAIN"):
        port = int(os.environ.get("PORT", "5001"))
        webbrowser.open_new(f'http://127.0.0.1:{port}/')


if __name__ == "__main__":
    Timer(1, open_browser).start()
    # threaded=True para manejar peticiones concurrentes, pero modbus_lock controla el puerto
    port = int(os.environ.get("PORT", "5001"))
    app.run(host='0.0.0.0', port=port, debug=True)
