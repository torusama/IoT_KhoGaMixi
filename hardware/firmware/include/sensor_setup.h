#pragma once

#include <Arduino.h>
#include <Wire.h>

// I2C addresses
constexpr uint8_t TCA_ADDR = 0x70;
constexpr uint8_t MPU_ADDR = 0x68;

// ESP32 I2C pins
constexpr uint8_t SDA_PIN = 21;
constexpr uint8_t SCL_PIN = 22;

constexpr uint8_t MPU_COUNT = 4;

// Initialize ESP32 I2C + four MPU6050
bool setupSensors();

// Select a channel on TCA9548A
bool selectTCAChannel(uint8_t channel);
