
#include "mqtt_handler.h"

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <atomic>
#include <math.h>

// ---------- Network configuration ----------

static const char* WIFI_SSID = "YOUR_WIFI";
static const char* WIFI_PASS = "YOUR_PASSWORD";

static const char* MQTT_HOST = "192.168.1.100";
static constexpr uint16_t MQTT_PORT = 1883;

static const char* DEVICE_ID = "esp32_01";

static const char* TOPIC_DATA = "posture/esp32_01/data";
static const char* TOPIC_CMD  = "posture/esp32_01/cmd";
static const char* TOPIC_ACK  = "posture/esp32_01/ack";

// ---------- MQTT objects ----------

static WiFiClient wifiClient;
static PubSubClient mqtt(wifiClient);

// Shared configuration for sensor/MQTT tasks
static std::atomic<bool> measurementRunning{false};
static std::atomic<uint32_t> publishIntervalMs{100};

// Connection retry scheduling
static uint32_t lastWiFiAttempt = 0;
static uint32_t lastMQTTAttempt = 0;
static bool firstWiFiAttempt = true;
static bool firstMQTTAttempt = true;

static constexpr uint32_t RETRY_MS = 5000;

// ---------- ACK ----------

static void sendACK(
    const char* commandId,
    const char* status,
    const char* reason
) {
    if (!mqtt.connected()) return;

    JsonDocument doc;

    doc["device_id"] = DEVICE_ID;
    doc["command_id"] = commandId;
    doc["status"] = status;
    doc["reason"] = reason;

    char buffer[256];

    size_t size = serializeJson(
        doc, buffer, sizeof(buffer)
    );

    if (size == 0 || size >= sizeof(buffer)) {
        return;
    }

    mqtt.publish(TOPIC_ACK, buffer);
}

// ---------- MQTT command callback ----------

static void onMQTTMessage(
    char* topic,
    byte* payload,
    unsigned int length
) {
    if (strcmp(topic, TOPIC_CMD) != 0) {
        return;
    }

    JsonDocument doc;

    DeserializationError error =
        deserializeJson(doc, payload, length);

    if (error) {
        sendACK("", "error", "invalid_json");
        return;
    }

    const char* commandId = doc["command_id"] | "";
    const char* command   = doc["command"] | "";

    if (strcmp(command, "START") == 0) {
        measurementRunning.store(true);
        sendACK(commandId, "ok", "started");
    }
    else if (strcmp(command, "STOP") == 0) {
        measurementRunning.store(false);
        sendACK(commandId, "ok", "stopped");
    }
    else if (strcmp(command, "CONFIG") == 0) {
        // Reject missing/incorrect data types
        if (!doc["publish_interval_ms"].is<uint32_t>()) {
            sendACK(commandId, "error", "invalid_config");
            return;
        }

        uint32_t interval =
            doc["publish_interval_ms"].as<uint32_t>();

        if (interval < 50 || interval > 5000) {
            sendACK(commandId, "error", "out_of_range");
            return;
        }

        publishIntervalMs.store(interval);
        sendACK(commandId, "ok", "config_updated");
    }
    else {
        sendACK(commandId, "error", "unknown_command");
    }
}

// ---------- Initialization ----------

void setupMQTT() {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);

    mqtt.setServer(MQTT_HOST, MQTT_PORT);
    mqtt.setCallback(onMQTTMessage);

    mqtt.setBufferSize(512);
    mqtt.setKeepAlive(15);
    mqtt.setSocketTimeout(2);

    // Start association without waiting in a loop
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    lastWiFiAttempt = millis();
    firstWiFiAttempt = false;
}

// ---------- Connection management ----------

void loopMQTT() {
    uint32_t now = millis();

    // Wi-Fi reconnect
    if (WiFi.status() != WL_CONNECTED) {
        if (firstWiFiAttempt ||
            (uint32_t)(now - lastWiFiAttempt) >= RETRY_MS) {

            firstWiFiAttempt = false;
            lastWiFiAttempt = now;

            WiFi.reconnect();
        }

        return;
    }

    // MQTT reconnect
    if (!mqtt.connected()) {
        if (firstMQTTAttempt ||
            (uint32_t)(now - lastMQTTAttempt) >= RETRY_MS) {

            firstMQTTAttempt = false;
            lastMQTTAttempt = now;

            if (mqtt.connect(DEVICE_ID)) {
                mqtt.subscribe(TOPIC_CMD);
                Serial.println("MQTT connected");
            } else {
                Serial.printf(
                    "MQTT failed: %d\n", mqtt.state()
                );
            }
        }

        return;
    }

    // Handle incoming messages and keep-alive
    mqtt.loop();
}

// ---------- Publish processed data ----------

bool publishMPUData(const ProcessedMPUData &data) {
    if (!mqtt.connected()) {
        return false;
    }

    JsonDocument doc;

    doc["device_id"] = DEVICE_ID;
    doc["timestamp_us"] = data.timestamp;

    JsonArray pitch = doc["pitch"].to<JsonArray>();
    JsonArray relative = doc["relative"].to<JsonArray>();
    JsonArray status = doc["status"].to<JsonArray>();

    for (int i = 0; i < 4; i++) {
        if (data.status[i] && isfinite(data.pitch[i])) {
            pitch.add(data.pitch[i]);
        } else {
            pitch.add(nullptr);
        }

        status.add(data.status[i]);
    }

    for (int i = 0; i < 3; i++) {
        if (isfinite(data.relative[i])) {
            relative.add(data.relative[i]);
        } else {
            relative.add(nullptr);
        }
    }

    char buffer[512];

    size_t size = serializeJson(
        doc, buffer, sizeof(buffer)
    );

    if (size == 0 || size >= sizeof(buffer)) {
        return false;
    }

    return mqtt.publish(TOPIC_DATA, buffer);
}

// ---------- State getters ----------

bool isMeasurementRunning() {
    return measurementRunning.load();
}

uint32_t getPublishIntervalMs() {
    return publishIntervalMs.load();
}
