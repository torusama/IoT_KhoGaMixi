# Smart Posture Tracker

Smart Posture Tracker dùng ESP32 và bốn MPU6050 để theo dõi góc, mô phỏng đường cong bề mặt lưng 2D ước lượng và tổng hợp phiên học. Đây không phải thiết bị chẩn đoán.

## Directory map

- `hardware/`: firmware ESP32 dùng PlatformIO/Arduino; MQTT hiện còn phiên bản cũ.
- `backend/`: Node-RED runtime, MQTT broker/config, giao thức v2, Firebase/file persistence và simulator.
- `frontend/`: ES module client cho REST/SSE; dashboard hoàn chỉnh còn cần xây dựng.
- `docs/`: kế hoạch, kiến trúc, giao thức, API và setup.
- `review/`: proposal và các hướng giải quyết làm căn cứ.
- `tests/`: kiểm thử logic, Node-RED/MQTT/REST/SSE và Firebase Emulator.

Chạy backend tại `backend/`: `npm ci`, `npm run configure`; dùng ba terminal cho `npm run broker`, `npm start`, `npm run simulator`. Xem [setup](docs/setup.md) để chọn Firebase thật/emulator thay file local, [API](docs/api.md) để tích hợp frontend và [checklist firmware v2](docs/device-integration.md) để nối ESP32 thật.

[PLAN](docs/PLAN.md) xác định phạm vi và tiêu chí nghiệm thu. Backend không giả ID phiên cho firmware cũ; simulator không thay kiểm thử cảm biến/motor thật.
