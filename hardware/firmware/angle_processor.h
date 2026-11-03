// Angle processor interface placeholder.
// angle_processor.h
#pragma once

#include "mpu_reader.h"

void calibrate_sensors();
void process_angles(
    const SensorData raw_data[],
    float angles[]
);