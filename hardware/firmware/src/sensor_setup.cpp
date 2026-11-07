
#include "sensor_setup.h"

// MPU6050 registers
constexpr uint8_t PWR_MGMT_1  = 0x6B;
constexpr uint8_t WHO_AM_I    = 0x75;
constexpr uint8_t GYRO_CONFIG = 0x1B;
constexpr uint8_t ACCEL_CONFIG = 0x1C;
constexpr uint8_t CONFIG_REG  = 0x1A;

// Write one byte to an MPU register
static bool writeMPURegister(uint8_t reg, uint8_t value) {
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(reg);
    Wire.write(value);

    return Wire.endTransmission() == 0;
}

// Read one MPU register
static bool readMPURegister(uint8_t reg, uint8_t &value) {
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(reg);

    if (Wire.endTransmission(false) != 0) {
        return false;
    }

    if (Wire.requestFrom(MPU_ADDR, (uint8_t)1) != 1) {
        return false;
    }

    value = Wire.read();
    return true;
}

// Select one TCA9548A channel
bool selectTCAChannel(uint8_t channel) {
    if (channel >= 8) {
        return false;
    }

    Wire.beginTransmission(TCA_ADDR);
    Wire.write(1u << channel);

    return Wire.endTransmission() == 0;
}

// Initialize one MPU6050
static bool setupPerMPU(uint8_t channel) {
    if (!selectTCAChannel(channel)) {
        return false;
    }

    uint8_t id;

    // Check sensor identity
    if (!readMPURegister(WHO_AM_I, id)) {
        return false;
    }

    if (id != 0x68) {
        return false;
    }

    // Wake up MPU6050, select PLL clock
    if (!writeMPURegister(PWR_MGMT_1, 0x01)) {
        return false;
    }

    delay(100); // Startup only

    // Gyroscope: +/- 250 degrees/second
    if (!writeMPURegister(GYRO_CONFIG, 0x00)) {
        return false;
    }

    // Accelerometer: +/- 2g
    if (!writeMPURegister(ACCEL_CONFIG, 0x00)) {
        return false;
    }

    // Digital low-pass filter configuration
    if (!writeMPURegister(CONFIG_REG, 0x03)) {
        return false;
    }

    return true;
}

// Initialize I2C and four sensors
bool setupSensors() {
    Wire.begin(SDA_PIN, SCL_PIN);
    Wire.setClock(100000);
    Wire.setTimeOut(20);

    bool allReady = true;

    for (uint8_t i = 0; i < MPU_COUNT; i++) {
        bool ready = setupPerMPU(i);

        Serial.printf(
            "MPU %u: %s\n",
            i,
            ready ? "READY" : "FAILED"
        );

        if (!ready) {
            allReady = false;
        }
    }

    return allReady;
}
