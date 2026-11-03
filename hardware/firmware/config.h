// Firmware configuration placeholder.
#pragma once

// I2C
constexpr int I2C_SDA_PIN = 21;
constexpr int I2C_SCL_PIN = 22;

// TCA9548A
constexpr int TCA9548A_ADDRESS = 0x70;

// Four MPU6050 modules
constexpr uint8_t MPU_COUNT = 4;
constexpr uint8_t MPU_ADDRESS = 0x68;

// Vibrator motor
constexpr int VIBRATOR_PIN = 25;