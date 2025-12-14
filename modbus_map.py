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

    # 2. Undercurrent (NUEVO REGISTRO) - Dirección 751
    "vsd_ul_setpoint": {
        "address": 751,  # Dirección según tu Excel
        "type": "uint",
        "scale": 10,  # Escala x10
        "unit": "A",
        "access": "rw"
    }
}