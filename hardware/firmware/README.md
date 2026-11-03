# Smart Posture Tracker Firmware

This directory contains the Arduino-framework firmware intended to run on the
SPT ESP32 device. The device is planned to use four MPU6050 motion sensors
through a TCA9548A I2C multiplexer and a vibration motor for posture alerts.

The current firmware is an initialization scaffold. It configures the I2C bus,
writes basic MPU6050 wake-up commands, and configures the motor pin. Sensor
reading, angle processing, posture decisions, and motor control are not yet
implemented.

## Files and responsibilities

| File | Purpose and key functions | Inputs and outputs | Dependencies |
| --- | --- | --- | --- |
| `firmware.ino` | Application entry point. `setup()` initializes I2C, selects TCA9548A channel 0, sends an MPU6050 wake-up command for each configured sensor address, and sets the motor pin as an output. `loop()` is currently empty. | Uses the constants in `config.h`; changes the I2C bus and ESP32 pin modes. No sensor data is currently returned. | `config.h`, `mpu_reader.h`, `angle_processor.h`, `motor_controller.h`, Arduino `Wire` API. |
| `config.h` | Holds hardware configuration constants: I2C pins, TCA9548A address, sensor count and base address, and motor pin. | Provides compile-time constants to the firmware. | Arduino/C++ types such as `uint8_t`; no sensor library is used here. |
| `mpu_reader.h` | Declares `read_mpu_data(SensorData* data)`, the planned sensor-reading interface. | Intended to fill a `SensorData` value, but `SensorData` is not defined in the current firmware. | Depends on the `SensorData` type being defined elsewhere; no current implementation dependency is present. |
| `mpu_reader.cpp` | Reserved for MPU6050 and TCA9548A reading logic. It currently contains no implementation. | No current inputs, outputs, or state changes. | None currently; the implementation will need an I2C interface and sensor data type. |
| `angle_processor.h` | Declares `calibrate_sensors()` and `process_angles(const SensorData raw_data[], float angles[])`. | Intended to receive raw sensor data and write calculated angles. | Includes `mpu_reader.h` for `SensorData`. |
| `angle_processor.cpp` | Reserved for calibration and posture-angle calculations. It currently contains no implementation. | No current inputs, outputs, or state changes. | None currently; it will depend on the sensor data representation. |
| `motor_controller.h` | Declares `init_motor()` and `set_motor(bool enabled)`. | Intended to initialize and switch the vibration motor on or off. | No current implementation dependency. |
| `motor_controller.cpp` | Reserved for vibration-motor control logic. It currently contains no implementation. | No current inputs, outputs, or state changes. | None currently; the implementation will use the configured motor pin. |

## Current execution flow

1. The ESP32 starts and calls `setup()`.
2. `Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN)` initializes I2C.
3. The firmware sends a command to the TCA9548A at `TCA9548A_ADDRESS` to
   select channel 0.
4. For `MPU_COUNT` iterations, it writes `0x00` to MPU6050 power-management
   register `0x6B` at `MPU_ADDRESS + i`.
5. `VIBRATOR_PIN` is configured as an output.
6. The ESP32 calls `loop()` repeatedly, but the current `loop()` does nothing.

No sensor readings currently flow through the reader or angle processor, and
there is no implemented posture or alert decision. The motor is not activated
by the current code. The intended, but not yet implemented, interaction is:

`firmware.ino -> mpu_reader -> angle_processor -> posture/alert decision -> motor_controller`

## Hardware configuration

| Setting | Current value | Source |
| --- | --- | --- |
| ESP32 SDA pin | `21` (`I2C_SDA_PIN`) | `config.h` |
| ESP32 SCL pin | `22` (`I2C_SCL_PIN`) | `config.h` |
| TCA9548A I2C address | `0x70` (`TCA9548A_ADDRESS`) | `config.h` |
| TCA9548A channels | `0`, selected during `setup()`; channels for the four sensors are not assigned yet | `firmware.ino` |
| MPU6050 sensor count | `4` (`MPU_COUNT`) | `config.h` |
| MPU6050 I2C address | Base value `0x68` (`MPU_ADDRESS`); `setup()` attempts `0x68`, `0x69`, `0x6A`, and `0x6B` | `config.h`, `firmware.ino` |
| Vibration motor control pin | `25` (`VIBRATOR_PIN`) | `config.h` |

The source does not currently implement per-sensor multiplexer channel
selection. It also does not configure or use an MPU6050 library.

## Build and upload

The repository identifies the Arduino IDE as the intended workflow, but it does
not currently specify an ESP32 board package version, external Arduino library,
or a complete board/upload configuration.

Basic intended workflow:

1. Install the Arduino IDE and an ESP32 board package.
2. Open `firmware.ino` from this directory.
3. Select the appropriate ESP32 board and serial port.
4. Compile, then upload to the ESP32.
5. Confirm the selected board and port match the connected hardware.

The current source may not compile as a complete application because
`SensorData` is referenced by `mpu_reader.h` but is not defined in the firmware,
and the module implementations are empty. Required board packages and library
versions are **TBD** in the repository setup documentation.

## Known limitations and TODOs

- Implement `mpu_reader.cpp`, including TCA9548A channel selection and reading
  all four MPU6050 sensors.
- Define the missing `SensorData` type and complete the sensor reader interface.
- Implement sensor calibration in `angle_processor.cpp`.
- Implement angle calculation and posture detection.
- Add the repeated sensor-reading and angle-processing workflow to `loop()`.
- Add the posture/alert decision that calls the motor controller.
- Implement `motor_controller.cpp`, including `init_motor()` and
  `set_motor(bool enabled)`.
- Assign and use one TCA9548A channel for each sensor.
- Add filtering, if required by the final posture-detection design.
- Add communication with the backend; no backend transport is present in the
  current firmware.