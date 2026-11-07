#pragma once
#include <stdint.h>

// Raw data from one MPU6050
struct MPUData {
    float accelX, accelY, accelZ;
    float gyroX, gyroY, gyroZ;
    uint32_t timestamp;
    bool valid;
};

// Processed data from four MPU6050
struct ProcessedMPUData {
    uint32_t timestamp;
    float pitch[4];
    float relative[3];
    uint8_t status[4];
};