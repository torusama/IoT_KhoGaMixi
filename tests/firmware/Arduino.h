#pragma once
#include <stdint.h>

// Chỉ thay phần Arduino cần thiết cho unit test trên máy tính.
// Không giả lập I2C, MPU6050, Wi-Fi hoặc thời gian thu nhận thật.
constexpr double PI = 3.14159265358979323846;
uint32_t micros();
