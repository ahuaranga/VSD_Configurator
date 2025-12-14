# modbus_map.py
# Diccionario maestro de registros Modbus

REGISTER_MAP = {
    # --- ALARMAS: MOTOR CURRENT ---

    # 1. Overcurrent (Ya existía)
    "vsd_ol_setpoint_0": {
        "address": 717,
        "type": "uint",
        "scale": 10,
        "unit": "A",
        "access": "rw"
    },

    # 2. Undercurrent (Registro 751)
    "vsd_ul_setpoint": {
        "address": 751,
        "type": "uint",
        "scale": 10,
        "unit": "A",
        "access": "rw"
    },

    # --- ALARMAS: VOLTAGE INPUT (NUEVOS) ---

    # 3. Voltage Input High
    "vsd_vh_setpoint": {
        "address": 800,  # <--- REEMPLAZAR CON DIRECCIÓN REAL
        "type": "uint",
        "scale": 1,  # <--- VERIFICAR ESCALA (ej: x1 o x10)
        "unit": "V",
        "access": "rw"
    },

    # 4. Voltage Input Low
    "vsd_vl_setpoint": {
        "address": 801,  # <--- REEMPLAZAR CON DIRECCIÓN REAL
        "type": "uint",
        "scale": 1,  # <--- VERIFICAR ESCALA
        "unit": "V",
        "access": "rw"
    }
}