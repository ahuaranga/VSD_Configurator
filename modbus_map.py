# modbus_map.py

REGISTER_MAP = {
    # ==========================================
    # GRUPO 1: ALARMAS (Escritura/Lectura)
    # ==========================================
    "vsd_ol_setpoint_0": {
        "address": 717,
        "type": "uint",
        "scale": 10,
        "unit": "A",
        "access": "rw"
    },
    "vsd_ul_setpoint": {
        "address": 751,
        "type": "uint",
        "scale": 10,
        "unit": "A",
        "access": "rw"
    },

    # ==========================================
    # GRUPO 2: MONITORIZACIÓN VSD
    # ==========================================
    "vsd_supply_voltage": {
        "address": 2103,
        "type": "uint",
        "scale": 1,
        "unit": "V",
        "access": "ro"
    },
    "vsd_temperature": {
        "address": 2102,
        "type": "int",
        "scale": 1,
        "unit": "°C",
        "access": "ro"
    },

    # ==========================================
    # GRUPO 3: DOWN HOLE TOOL (NUEVO)
    # ==========================================

    # Pressure (x10 -> raw 100 = 10.0)
    "dht_intake_pressure": {"address": 2136, "type": "uint", "scale": 10, "unit": "psi", "access": "ro"},
    "dht_discharge_pressure": {"address": 2137, "type": "uint", "scale": 10, "unit": "psi", "access": "ro"},

    # Temperature (x10)
    "dht_intake_temp": {"address": 2139, "type": "uint", "scale": 10, "unit": "°C", "access": "ro"},
    "dht_motor_temp": {"address": 2140, "type": "uint", "scale": 10, "unit": "°C", "access": "ro"},

    # Vibration (x1000)
    "dht_vibration": {"address": 2141, "type": "uint", "scale": 1000, "unit": "g", "access": "ro"},

    # Leakage / Current (x1000)
    "dht_active_leakage": {"address": 2142, "type": "uint", "scale": 1000, "unit": "mA", "access": "ro"},
    "dht_cz": {"address": 2144, "type": "uint", "scale": 1000, "unit": "mA", "access": "ro"},
    "dht_cf": {"address": 2145, "type": "uint", "scale": 1000, "unit": "mA", "access": "ro"},
    "dht_passive_leakage": {"address": 2147, "type": "uint", "scale": 1000, "unit": "mA", "access": "ro"},

    # Differential Pressure (x1)
    "dht_diff_pressure": {"address": 2161, "type": "int", "scale": 1, "unit": "psi", "access": "ro"}
}