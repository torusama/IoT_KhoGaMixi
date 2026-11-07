
#pragma once

#include "data_types.h"
#include <stdint.h>

// Initialize Wi-Fi and MQTT configuration
void setupMQTT();

// Call regularly from MQTT task
void loopMQTT();

// Publish one processed sensor frame
bool publishMPUData(const ProcessedMPUData &data);

// State controlled by MQTT commands
bool isMeasurementRunning();

// Configurable MQTT publishing interval
uint32_t getPublishIntervalMs();
