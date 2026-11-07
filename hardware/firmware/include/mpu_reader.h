#pragma once
#include "data_types.h"

// Read one MPU via TCA channel
bool readPerMPU(uint8_t channel, MPUData *data);

// Read all four MPU sensors
void readAllMPU(MPUData data[4]);