# modbus_map.py

"""
MAPA DE REGISTROS MODBUS
Este archivo contiene la definición de todos los registros que se leerán o escribirán.
Estructura: Clave de variable -> {dirección, tipo, escala, unidad, acceso}
"""

REGISTER_MAP = {
    # ==========================================
    # GRUPO 0: FIRMWARE CONTROLLER (Solo lectura al inicio)
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
    # GRUPO 1: ALARMAS (Escritura/Lectura)
    # ==========================================
    # Setpoints de sobrecarga y subcarga
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
    # GRUPO 2: MONITORIZACIÓN VSD (GENERAL)
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
    # GRUPO 3: VARIABLE SPEED DRIVE (VSD)
    # Parametros específicos del variador
    # ==========================================
    "vsd_motor_rpm": {
        "address": 375,
        "type": "uint",
        "scale": 1,
        "unit": "RPM",
        "access": "rw"
    },
    
    # --- NUEVOS REGISTROS (Offset 855+) ---
    "vsd_target_freq": {
        "address": 855, 
        "type": "uint", 
        "scale": 100,  # x100 (Ej: 6000 -> 60.00 Hz)
        "unit": "Hz", 
        "access": "rw"
    },
    "vsd_min_speed": {
        "address": 856, "type": "uint", "scale": 100, "unit": "Hz", "access": "rw"
    },
    "vsd_max_speed": {
        "address": 857, "type": "uint", "scale": 100, "unit": "Hz", "access": "rw"
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
    # ---------------------------------------------------

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
    # GRUPO 4: DOWN HOLE TOOL (DHT)
    # Sensores de fondo
    # ==========================================

    # Presión (x10 -> raw 100 = 10.0 psi)
    "dht_intake_pressure": {"address": 2136, "type": "uint", "scale": 10, "unit": "psi", "access": "ro"},
    "dht_discharge_pressure": {"address": 2137, "type": "uint", "scale": 10, "unit": "psi", "access": "ro"},

    # Temperatura (x10)
    "dht_intake_temp": {"address": 2139, "type": "uint", "scale": 10, "unit": "°C", "access": "ro"},
    "dht_motor_temp": {"address": 2140, "type": "uint", "scale": 10, "unit": "°C", "access": "ro"},

    # Vibración (x1000)
    "dht_vibration": {"address": 2141, "type": "uint", "scale": 1000, "unit": "g", "access": "ro"},

    # Corrientes de fuga / Leakage (x1000)
    "dht_active_leakage": {"address": 2142, "type": "uint", "scale": 1000, "unit": "mA", "access": "ro"},
    "dht_cz": {"address": 2144, "type": "uint", "scale": 1000, "unit": "mA", "access": "ro"},
    "dht_cf": {"address": 2145, "type": "uint", "scale": 1000, "unit": "mA", "access": "ro"},
    "dht_passive_leakage": {"address": 2147, "type": "uint", "scale": 1000, "unit": "mA", "access": "ro"},

    # Presión Diferencial (x1)
    "dht_diff_pressure": {"address": 2161, "type": "int", "scale": 1, "unit": "psi", "access": "ro"}
}