
#include <Arduino.h>
#include "data_types.h"
#include "sensor_setup.h"
#include "mpu_reader.h"
#include "angle_calculator.h"
#include "mqtt_handler.h"

QueueHandle_t frameQueue;

void sensorTask(void* parameter) {
    MPUData raw[4] = {};
    ProcessedMPUData processed = {};

    TickType_t lastWake = xTaskGetTickCount();

    while (true) {
        if (isMeasurementRunning()) {
            readAllMPU(raw);
            filterMPUData(raw, &processed);

            xQueueOverwrite(frameQueue, &processed);
        } else {
            resetAngleFilter();
            xQueueReset(frameQueue);
        }

        vTaskDelayUntil(
            &lastWake, pdMS_TO_TICKS(20)
        );
    }
}

void mqttTask(void* parameter) {
    ProcessedMPUData latest = {};
    bool hasFrame = false;
    uint32_t lastPublish = millis();

    while (true) {
        loopMQTT();

        // Obtain latest frame without blocking
        if (xQueueReceive(frameQueue, &latest, 0) == pdTRUE) {
            hasFrame = true;
        }

        uint32_t now = millis();

        if (!isMeasurementRunning()) {
            hasFrame = false;
        }

        if (hasFrame &&
            isMeasurementRunning() &&
            now - lastPublish >= getPublishIntervalMs()) {

            if (publishMPUData(latest)) {
                // Do not resend the same frame
                hasFrame = false;
            }

            lastPublish = now;
        }

        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

void setup() {
    Serial.begin(115200);

    setupSensors();
    resetAngleFilter();

    frameQueue = xQueueCreate(
        1, sizeof(ProcessedMPUData)
    );

    if (frameQueue == nullptr) {
        Serial.println("Queue creation failed");
        return;
    }

    setupMQTT();

    xTaskCreatePinnedToCore(
        sensorTask, "SensorTask",
        4096, nullptr, 2, nullptr, 1
    );

    xTaskCreatePinnedToCore(
        mqttTask, "MQTTTask",
        8192, nullptr, 1, nullptr, 0
    );
}

void loop() {
    vTaskDelay(pdMS_TO_TICKS(1000));
}
