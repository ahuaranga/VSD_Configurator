# modbus_map.py

"""
MAPA DE REGISTROS MODBUS COMPLETO
Estructura: Clave de variable -> {dirección, tipo, escala, unidad, acceso}
"""

REGISTER_MAP = {
    # ==========================================
    # GRUPO 0: CONTROL REMOTO (Comandos)
    # ==========================================
    "vsd_remote_stop": {
        "address": 0,    # Offset 0
        "type": "uint",
        "scale": 1,
        "unit": "",
        "access": "rw"
    },
    "vsd_remote_start": {
        "address": 2,    # Offset 2
        "type": "uint",
        "scale": 1,
        "unit": "",
        "access": "rw"
    },

    # ==========================================
    # GRUPO 1: FIRMWARE CONTROLLER
    # ==========================================
    "fw_ver_code": {
        "address": 1,
        "type": "uint",
        "scale": 1,
        "unit": "",
        "access": "ro"
    },
    "fw_rel_code": {
        "address": 2,
        "type": "uint",
        "scale": 1,
        "unit": "",
        "access": "ro"
    },

    # ==========================================
    # GRUPO 2: ALARMAS (Setpoints)
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
    # GRUPO 3: MONITORIZACIÓN VSD (General y Live)
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
    "vsd_frequency_out": {
        "address": 2165,
        "type": "uint",
        "scale": 100,
        "unit": "Hz",
        "access": "ro"
    },
    "vsd_volts_in": {
        "address": 2169, 
        "type": "uint", 
        "scale": 10,
        "unit": "V", 
        "access": "ro"
    },
    "vsd_volts_out": {
        "address": 2170, 
        "type": "uint", 
        "scale": 10,
        "unit": "V", 
        "access": "ro"
    },
    "vsd_current": {
        "address": 2174,
        "type": "uint",
        "scale": 10,
        "unit": "A",
        "access": "ro"
    },
    "vsd_motor_current": {
        "address": 2175,
        "type": "uint",
        "scale": 10,
        "unit": "A",
        "access": "ro"
    },

    # ==========================================
    # GRUPO 4: CONFIGURACIÓN VSD (Speed Parameters)
    # ==========================================
    "vsd_target_freq": {
        "address": 855, 
        "type": "uint", 
        "scale": 100, 
        "unit": "Hz", 
        "access": "rw"
    },
    "vsd_min_speed": {
        "address": 856, 
        "type": "uint", 
        "scale": 100, 
        "unit": "Hz", 
        "access": "rw"
    },
    "vsd_max_speed": {
        "address": 857, 
        "type": "uint", 
        "scale": 100, 
        "unit": "Hz", 
        "access": "rw"
    },
    "vsd_motor_rpm": {
        "address": 375,
        "type": "uint",
        "scale": 1,
        "unit": "RPM",
        "access": "rw"
    },
    "vsd_carrier_freq": {
        "address": 862, "type": "uint", "scale": 10, "unit": "kHz", "access": "rw"
    },
    "vsd_base_freq": {
        "address": 863, "type": "uint", "scale": 100, "unit": "Hz", "access": "rw"
    },
    "vsd_base_volts": {
        "address": 864, "type": "uint", "scale": 1, "unit": "V", "access": "rw"
    },
    "vsd_startup_freq": {
        "address": 865, "type": "uint", "scale": 100, "unit": "Hz", "access": "rw"
    },
    "vsd_voltage_boost": {
        "address": 869, "type": "uint", "scale": 10, "unit": "%", "access": "rw"
    },

    # ==========================================
    # GRUPO 5: DOWN HOLE TOOL (DHT)
    # ==========================================
    "dht_intake_pressure": {"address": 2136, "type": "uint", "scale": 10, "unit": "psi", "access": "ro"},
    "dht_discharge_pressure": {"address": 2137, "type": "uint", "scale": 10, "unit": "psi", "access": "ro"},
    "dht_intake_temp": {"address": 2139, "type": "uint", "scale": 10, "unit": "°C", "access": "ro"},
    "dht_motor_temp": {"address": 2140, "type": "uint", "scale": 10, "unit": "°C", "access": "ro"},
    "dht_vibration": {"address": 2141, "type": "uint", "scale": 1000, "unit": "g", "access": "ro"},
    "dht_active_leakage": {"address": 2142, "type": "uint", "scale": 1000, "unit": "mA", "access": "ro"},
    "dht_cz": {"address": 2144, "type": "uint", "scale": 1000, "unit": "mA", "access": "ro"},
    "dht_cf": {"address": 2145, "type": "uint", "scale": 1000, "unit": "mA", "access": "ro"},
    "dht_passive_leakage": {"address": 2147, "type": "uint", "scale": 1000, "unit": "mA", "access": "ro"},
    "dht_diff_pressure": {"address": 2161, "type": "int", "scale": 1, "unit": "psi", "access": "ro"}
}