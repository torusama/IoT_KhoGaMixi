#include <cassert>
#include <cmath>
#include <cstdio>
#include <limits>
#include "angle_calculator.h"

static uint32_t testClockMicroseconds = 1000000;
uint32_t micros() { return testClockMicroseconds; }

static MPUData readingAtAngle(float pitchDegrees, uint32_t timestamp) {
    const float pitchRadians = pitchDegrees * 3.14159265358979323846f / 180.0f;
    MPUData reading = {};
    reading.accelX = -std::sin(pitchRadians);
    reading.accelZ = std::cos(pitchRadians);
    reading.timestamp = timestamp;
    reading.valid = true;
    return reading;
}

static void expectNear(float actual, float expected) {
    assert(std::abs(actual - expected) < 0.0001f);
}

int main() {
    MPUData readings[4];
    ProcessedMPUData result = {};
    const float pitches[4] = {30, 20, 10, 0};
    resetAngleFilter();
    for (int sensorIndex = 0; sensorIndex < 4; sensorIndex++) {
        readings[sensorIndex] = readingAtAngle(pitches[sensorIndex], 1000000);
    }
    filterMPUData(readings, &result);
    for (int sensorIndex = 0; sensorIndex < 4; sensorIndex++) {
        assert(result.status[sensorIndex] == 1);
        expectNear(result.pitch[sensorIndex], pitches[sensorIndex]);
    }
    // Giữ đúng dữ liệu legacy hiện tại: góc dưới trừ góc trên.
    // Adapter F02.1 tự tính lại theo quy ước SPT, không dùng mảng relative này.
    for (float relativeAngle : result.relative) expectNear(relativeAngle, -10);
    assert(result.timestamp == testClockMicroseconds);
    std::puts("PASS: four sensors, accelerometer initialization, legacy relative convention");

    resetAngleFilter();
    for (auto &reading : readings) reading = readingAtAngle(-30, 1000000);
    filterMPUData(readings, &result);
    for (float pitch : result.pitch) expectNear(pitch, -30);
    std::puts("PASS: negative pitch direction");

    resetAngleFilter();
    for (auto &reading : readings) reading = readingAtAngle(10, 1000000);
    filterMPUData(readings, &result);
    for (auto &reading : readings) reading = readingAtAngle(20, 1020000);
    filterMPUData(readings, &result);
    const float expectedFilteredPitch = 10 + (1 - 0.5f / 0.52f) * 10;
    for (float pitch : result.pitch) expectNear(pitch, expectedFilteredPitch);
    std::puts("PASS: complementary filter with 20 ms sample interval");

    resetAngleFilter();
    for (auto &reading : readings) reading = readingAtAngle(10, 1000000);
    filterMPUData(readings, &result);
    for (auto &reading : readings) {
        reading = readingAtAngle(10, 1020000);
        reading.gyroY = 20; // Độ/giây: 20 * 0.02 = 0.4 độ tăng trước khi hiệu chỉnh.
    }
    filterMPUData(readings, &result);
    const float expectedGyroscopePitch = 10.4f + (1 - 0.5f / 0.52f) * (10 - 10.4f);
    for (float pitch : result.pitch) expectNear(pitch, expectedGyroscopePitch);
    std::puts("PASS: gyroscope angular velocity integrates in degrees per second");

    readings[1].valid = false;
    filterMPUData(readings, &result);
    assert(result.status[1] == 0);
    assert(std::isnan(result.pitch[1]));
    assert(std::isnan(result.relative[0]) && std::isnan(result.relative[1]));
    readings[1] = readingAtAngle(25, 1040000);
    filterMPUData(readings, &result);
    expectNear(result.pitch[1], 25);
    std::puts("PASS: missing sensor invalidates adjacent angles and resets its filter");

    readings[0].accelX = std::numeric_limits<float>::infinity();
    readings[2].accelZ = std::numeric_limits<float>::quiet_NaN();
    filterMPUData(readings, &result);
    assert(result.status[0] == 0 && result.status[2] == 0);
    std::puts("PASS: nonfinite raw readings rejected");

    resetAngleFilter();
    for (auto &reading : readings) reading = readingAtAngle(0, 1000000);
    readings[0].accelZ = 0.1f;
    readings[1].accelZ = 1.6f;
    filterMPUData(readings, &result);
    assert(result.status[0] == 0 && result.status[1] == 0);
    std::puts("PASS: acceleration magnitude gate");

    resetAngleFilter();
    for (auto &reading : readings) reading = readingAtAngle(10, UINT32_MAX - 9999);
    filterMPUData(readings, &result);
    for (auto &reading : readings) reading = readingAtAngle(20, 10000);
    filterMPUData(readings, &result);
    for (float pitch : result.pitch) expectNear(pitch, expectedFilteredPitch);
    std::puts("PASS: unsigned timestamp rollover preserves 20 ms interval");

    for (auto &reading : readings) reading = readingAtAngle(40, 1000000);
    filterMPUData(readings, &result);
    for (float pitch : result.pitch) expectNear(pitch, 40);
    filterMPUData(nullptr, &result);
    filterMPUData(readings, nullptr);
    std::puts("PASS: long gap resets prediction, null pointers are ignored");
}
