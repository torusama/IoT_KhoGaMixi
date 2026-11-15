#include "angle_calculator.h"
#include <Arduino.h>
#include <math.h>

// Hằng số thời gian của bộ lọc và khoảng cách thời gian lớn nhất giữa hai mẫu.
static constexpr float FILTER_TIME_CONSTANT_SECONDS = 0.5f;
static constexpr float MAXIMUM_SAMPLE_INTERVAL_SECONDS = 0.2f;
static constexpr float DEGREES_PER_RADIAN = 180.0f / PI;

// Mỗi cảm biến cần nhớ góc và thời điểm của lần đo trước để dự đoán góc mới.
struct FilterState {
    float pitchDegrees = 0.0f;
    uint32_t lastTimestampMicroseconds = 0;
    bool initialized = false;
};

static FilterState filterStates[4];

// Đưa góc về [-180, 180). Ví dụ: 181 độ trở thành -179 độ.
static float normalizeAngleDegrees(float angleDegrees) {
    while (angleDegrees >= 180.0f) angleDegrees -= 360.0f;
    while (angleDegrees < -180.0f) angleDegrees += 360.0f;
    return angleDegrees;
}

// Tính góc từ hướng trọng lực khi cảm biến tương đối đứng yên.
// atan2 trả radian, nên nhân DEGREES_PER_RADIAN để lấy đơn vị độ.
// Dấu âm trước accelX là quy ước trục hiện có của F01, cần kiểm chứng khi lắp thật.
static float calculatePitchFromAccelerometer(const MPUData &reading) {
    const float accelerationOnYZPlane = sqrtf(
        reading.accelY * reading.accelY + reading.accelZ * reading.accelZ
    );
    return atan2f(-reading.accelX, accelerationOnYZPlane) * DEGREES_PER_RADIAN;
}

static bool calculatePitchWithComplementaryFilter(
    uint8_t sensorIndex,
    const MPUData &reading,
    float &outputPitchDegrees
) {
    FilterState &filterState = filterStates[sensorIndex];

    // Bước 1: từ chối mẫu lỗi, không biến lỗi đọc thành góc 0 độ.
    if (!reading.valid) {
        filterState.initialized = false;
        return false;
    }
    if (!isfinite(reading.accelX) || !isfinite(reading.accelY) ||
        !isfinite(reading.accelZ) || !isfinite(reading.gyroY)) {
        filterState.initialized = false;
        return false;
    }

    const float accelerationMagnitude = sqrtf(
        reading.accelX * reading.accelX +
        reading.accelY * reading.accelY +
        reading.accelZ * reading.accelZ
    );
    // Đơn vị gia tốc là g. Đây là bộ lọc thô hiện có, chưa xác nhận độ chính xác tư thế.
    if (accelerationMagnitude < 0.5f || accelerationMagnitude > 1.5f) {
        filterState.initialized = false;
        return false;
    }

    // Bước 2: lấy góc từ gia tốc kế. Lần đầu chưa có góc cũ thì dùng trực tiếp góc này.
    const float accelerometerPitchDegrees = calculatePitchFromAccelerometer(reading);
    if (!filterState.initialized) {
        filterState.pitchDegrees = accelerometerPitchDegrees;
        filterState.lastTimestampMicroseconds = reading.timestamp;
        filterState.initialized = true;
        outputPitchDegrees = filterState.pitchDegrees;
        return true;
    }

    // Bước 3: đổi chênh thời gian từ microsecond sang second.
    // Phép trừ unsigned vẫn đúng khi bộ đếm micros() 32 bit quay vòng.
    const float elapsedSeconds =
        (uint32_t)(reading.timestamp - filterState.lastTimestampMicroseconds) * 1e-6f;
    if (elapsedSeconds <= 0.0f || elapsedSeconds > MAXIMUM_SAMPLE_INTERVAL_SECONDS) {
        filterState.pitchDegrees = accelerometerPitchDegrees;
        filterState.lastTimestampMicroseconds = reading.timestamp;
        outputPitchDegrees = filterState.pitchDegrees;
        return true;
    }

    // Bước 4: gyroY là vận tốc góc (độ/giây).
    // Góc dự đoán = góc lần trước + vận tốc góc * số giây đã trôi qua.
    const float predictedPitchDegrees = normalizeAngleDegrees(
        filterState.pitchDegrees + reading.gyroY * elapsedSeconds
    );

    // Bước 5: chỉnh dần góc dự đoán về phía góc đo từ trọng lực.
    // Trọng số gyro lớn giúp tín hiệu mượt; gia tốc kế giúp hạn chế trôi góc.
    const float gyroscopeWeight =
        FILTER_TIME_CONSTANT_SECONDS / (FILTER_TIME_CONSTANT_SECONDS + elapsedSeconds);
    const float correctionDegrees = normalizeAngleDegrees(
        accelerometerPitchDegrees - predictedPitchDegrees
    );
    filterState.pitchDegrees = normalizeAngleDegrees(
        predictedPitchDegrees + (1.0f - gyroscopeWeight) * correctionDegrees
    );

    filterState.lastTimestampMicroseconds = reading.timestamp;
    outputPitchDegrees = filterState.pitchDegrees;
    return true;
}

void resetAngleFilter() {
    for (uint8_t sensorIndex = 0; sensorIndex < 4; sensorIndex++) {
        filterStates[sensorIndex] = FilterState{};
    }
}

void filterMPUData(const MPUData rawReadings[4], ProcessedMPUData *processedData) {
    if (rawReadings == nullptr || processedData == nullptr) {
        return;
    }

    processedData->timestamp = micros();
    for (uint8_t sensorIndex = 0; sensorIndex < 4; sensorIndex++) {
        float pitchDegrees = NAN;
        const bool sensorIsValid = calculatePitchWithComplementaryFilter(
            sensorIndex, rawReadings[sensorIndex], pitchDegrees
        );
        processedData->pitch[sensorIndex] = sensorIsValid ? pitchDegrees : NAN;
        processedData->status[sensorIndex] = sensorIsValid ? 1 : 0;
    }

    // QUAN TRỌNG: giữ quy ước legacy hiện có của F01: góc dưới trừ góc trên.
    // Contract SPT v2/F02.1 dùng chiều ngược lại: góc trên trừ góc dưới.
    // Adapter F02.1 tính lại từ pitch[], không lấy relative[] legacy này.
    for (uint8_t upperSensorIndex = 0; upperSensorIndex < 3; upperSensorIndex++) {
        const uint8_t lowerSensorIndex = upperSensorIndex + 1;
        if (processedData->status[upperSensorIndex] && processedData->status[lowerSensorIndex]) {
            const float upperPitchDegrees = processedData->pitch[upperSensorIndex];
            const float lowerPitchDegrees = processedData->pitch[lowerSensorIndex];
            processedData->relative[upperSensorIndex] = normalizeAngleDegrees(
                lowerPitchDegrees - upperPitchDegrees
            );
        } else {
            processedData->relative[upperSensorIndex] = NAN;
        }
    }
}
