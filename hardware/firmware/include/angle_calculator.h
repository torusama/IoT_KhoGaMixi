#pragma once
#include "data_types.h"

// Initialize/reset filter states
void resetAngleFilter();

// Process four MPU6050 readings
void filterMPUData(
    const MPUData raw[4],
    ProcessedMPUData *processedData
);