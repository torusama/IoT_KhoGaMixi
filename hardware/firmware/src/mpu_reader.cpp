
#include "mpu_reader.h"
#include "sensor_setup.h"
#include <Wire.h>

constexpr uint8_t ACCEL_XOUT_H = 0x3B;

constexpr float ACCEL_SCALE = 16384.0f;
constexpr float GYRO_SCALE  = 131.0f;

// Read one signed 16-bit value from I2C buffer
static int16_t readInt16() {
    uint16_t high = (uint8_t)Wire.read();
    uint16_t low  = (uint8_t)Wire.read();

    return (int16_t)((high << 8) | low);
}

// Read one MPU6050
bool readPerMPU(uint8_t channel, MPUData *data) {
    if (data == nullptr || channel >= MPU_COUNT) {
        return false;
    }

    data->valid = false;

    // Step 1: Select MPU via TCA9548A
    if (!selectTCAChannel(channel)) {
        return false;
    }

    // Step 2: Set register address
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(ACCEL_XOUT_H);

    if (Wire.endTransmission(false) != 0) {
        return false;
    }

    // Step 3: Read 14 consecutive bytes
    if (Wire.requestFrom(MPU_ADDR, (uint8_t)14) != 14) {
        return false;
    }

    // Step 4: Decode raw values
    int16_t rawAX = readInt16();
    int16_t rawAY = readInt16();
    int16_t rawAZ = readInt16();

    readInt16(); // Skip temperature

    int16_t rawGX = readInt16();
    int16_t rawGY = readInt16();
    int16_t rawGZ = readInt16();

    // Step 5: Convert to physical units
    data->accelX = rawAX / ACCEL_SCALE;
    data->accelY = rawAY / ACCEL_SCALE;
    data->accelZ = rawAZ / ACCEL_SCALE;

    data->gyroX = rawGX / GYRO_SCALE;
    data->gyroY = rawGY / GYRO_SCALE;
    data->gyroZ = rawGZ / GYRO_SCALE;

    // Step 6: Timestamp and validation
    data->timestamp = micros();
    data->valid = true;

    return true;
}

// Read all four sensors
void readAllMPU(MPUData data[4]) {
    for (uint8_t i = 0; i < MPU_COUNT; i++) {
        readPerMPU(i, &data[i]);
    }
}
