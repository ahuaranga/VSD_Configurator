# modbus_map.py
# Diccionario maestro de registros Modbus

REGISTER_MAP = {
    # ==========================================
    # GRUPO 1: ALARMAS Y PROTECCIONES
    # ==========================================

    # 1. Overcurrent (A)
    # Nombre Datasheet: VSD OL Setpoint (717)
    "vsd_ol_setpoint_0": {
        "address": 717,
        "type": "uint",
        "scale": 10,
        "unit": "A",
        "access": "rw"
    },

    # 2. Undercurrent (A)
    # Nombre Datasheet: VSD UL Setpoint (751)
    # UI Label: "2 Undercurrent (A)"
    "vsd_ul_setpoint": {
        "address": 751,  # Dirección Modicon 400752 -> Offset 751
        "type": "uint",
        "scale": 10,  # Datasheet dice x10 (Raw 200 = 20.0 A)
        "unit": "A",
        "access": "rw"
    },


    # ==========================================
    # GRUPO 2: MONITORIZACIÓN (LECTURA)
    # ==========================================

    # 5. Supply Voltage
    # Nombre Datasheet: SupplyVolts (2103)
    # UI Label: "2103 Supply Voltage"
    "vsd_supply_voltage": {
        "address": 2103,  # Modicon 302104 -> Offset 2103
        "type": "uint",
        "scale": 1,  # x1
        "unit": "V",
        "access": "ro"  # Read Only
    },
    # 6. Temperature (NUEVO)
        # Nombre Datasheet: Temperature (2102)
        "vsd_temperature": {
            "address": 2102,  # Offset 2102
            "type": "int",    # Datasheet dice 'int' (puede ser con signo)
            "scale": 1,       # x1
            "unit": "°C",     # Grados Celsius
            "access": "ro"
        }



}