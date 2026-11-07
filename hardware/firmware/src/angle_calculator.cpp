
#include "angle_calculator.h"

#include <Arduino.h>
#include <math.h>

// Complementary filter time constant (seconds)
static constexpr float FILTER_TAU = 0.5f;

// Maximum acceptable time gap (seconds)
static constexpr float MAX_DT = 0.2f;

static constexpr float RAD_TO_DEGREE = 180.0f / PI;

// Internal state for each MPU
struct FilterState {
    float pitch = 0.0f;
    uint32_t lastTimestamp = 0;
    bool initialized = false;
};

static FilterState filterStates[4];

// Normalize angle to [-180, 180)
static float normalizeAngle(float angle) {
    while (angle >= 180.0f) angle -= 360.0f;
    while (angle < -180.0f) angle += 360.0f;
    return angle;
}

// Calculate pitch from accelerometer
static float calculateAccelPitch(const MPUData &data) {
    return atan2f(
        -data.accelX,
        sqrtf(
            data.accelY * data.accelY +
            data.accelZ * data.accelZ
        )
    ) * RAD_TO_DEGREE;
}

// Estimate pitch for one MPU using complementary filter
static bool calculateFilteredPitch(
    uint8_t index,
    const MPUData &data,
    float &pitchOut
) {
    if (!data.valid) {
        filterStates[index].initialized = false;
        return false;
    }

    // Check input values
    if (!isfinite(data.accelX) ||
        !isfinite(data.accelY) ||
        !isfinite(data.accelZ) ||
        !isfinite(data.gyroY)) {
        filterStates[index].initialized = false;
        return false;
    }

    const float accelMagnitude = sqrtf(
        data.accelX * data.accelX +
        data.accelY * data.accelY +
        data.accelZ * data.accelZ
    );

    // Reject invalid or severely disturbed acceleration
    if (accelMagnitude < 0.5f ||
        accelMagnitude > 1.5f) {
        filterStates[index].initialized = false;
        return false;
    }

    const float accelPitch = calculateAccelPitch(data);
    FilterState &state = filterStates[index];

    // First valid sample initializes the filter
    if (!state.initialized) {
        state.pitch = accelPitch;
        state.lastTimestamp = data.timestamp;
        state.initialized = true;

        pitchOut = state.pitch;
        return true;
    }

    // Timestamp from micros(), convert microseconds to seconds
    const float dt =
        (uint32_t)(data.timestamp - state.lastTimestamp)
        * 1e-6f;

    if (dt <= 0.0f || dt > MAX_DT) {
        state.pitch = accelPitch;
        state.lastTimestamp = data.timestamp;

        pitchOut = state.pitch;
        return true;
    }

    // Gyroscope prediction
    const float gyroPitch = normalizeAngle(
        state.pitch + data.gyroY * dt
    );

    // Complementary filter coefficient
    const float alpha = FILTER_TAU / (FILTER_TAU + dt);

    // Shortest angular difference between measurements
    const float error = normalizeAngle(
        accelPitch - gyroPitch
    );

    // Complementary filter
    state.pitch = normalizeAngle(
        gyroPitch + (1.0f - alpha) * error
    );

    state.lastTimestamp = data.timestamp;

    pitchOut = state.pitch;
    return true;
}

void resetAngleFilter() {
    for (uint8_t i = 0; i < 4; i++) {
        filterStates[i] = FilterState{};
    }
}

void filterMPUData(
    const MPUData raw[4],
    ProcessedMPUData *out
) {
    if (raw == nullptr || out == nullptr) {
        return;
    }

    // Timestamp of completed acquisition frame
    out->timestamp = micros();

    // Process each MPU independently
    for (uint8_t i = 0; i < 4; i++) {
        float pitch = NAN;

        bool valid = calculateFilteredPitch(
            i, raw[i], pitch
        );

        out->pitch[i] = valid ? pitch : NAN;
        out->status[i] = valid ? 1 : 0;
    }

    // Relative angles between adjacent sensors
    for (uint8_t i = 0; i < 3; i++) {
        if (out->status[i] && out->status[i + 1]) {
            out->relative[i] = normalizeAngle(
                out->pitch[i + 1] - out->pitch[i]
            );
        } else {
            out->relative[i] = NAN;
        }
    }
}
