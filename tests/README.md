# Tests

Chạy tại `backend/`: `npm test`, `npm run check`; Firebase Emulator/JDK 21: `npm run test:firebase`.

`geometry/` kiểm thử F02.1 T04 A–K, input/status/sync/skew, đơn vị, overflow, adapter F01/v2 và artifact dashboard. Tại root: `node --test tests/geometry/*.test.js` (không cần npm install); tại `backend/`: `npm run test:geometry`. `npm test` backend cũng bao gồm suite này. Sau khi sửa core/widget, chạy `npm run build` tại `frontend/dashboard` trước để cập nhật artifact được kiểm tra. Fixture/JSON mẫu ghi rõ Simulation; sinh lại bằng `node tests/geometry/write-example.js`. Xem [F02.1](../docs/F02.1.md) và [báo cáo kiểm thử](../docs/F02.1-report.md).

`backend/service.test.js` kiểm thử session/protocol/dedupe/storage failure/restart bằng clock giả lập. `backend/integration.test.js` chạy Node-RED thật, broker MQTT xác thực, simulator, REST/SSE và persistence; test Firebase dùng Admin SDK với project demo/emulator, không dùng database thật. Thư mục tạm và cổng riêng được dọn sau phép thử.

Kiểm thử sensor, đồ gá, motor thật và Internet qua hai mạng vẫn theo [PLAN](../docs/PLAN.md); simulator không thay các bằng chứng đó.

`firmware/` có unit test C++ cho phần tính góc hiện có, dùng shim Arduino tối thiểu. Chạy tại root: `node tests/firmware/run-tests.js`; cần `g++` trong PATH hoặc `CXX`. Kiểm tra khởi tạo bốn góc, dấu góc âm, bộ lọc bổ sung, tích phân gyro, mất sensor, số không hữu hạn, độ lớn gia tốc, micros() quay vòng và gap. Đây không phải build firmware ESP32 hay kiểm thử MPU6050 thật.

`frontend/dashboard-browser.js` kiểm tra tương tác và bố cục Dashboard 2.0 bằng Chrome đang cài trên máy. Chạy demo ở cổng 1881 trước, rồi `node tests/frontend/dashboard-browser.js` tại root hoặc `npm run test:browser` tại `frontend/dashboard`. Có thể đặt `CHROME_PATH` và `SPT_DASHBOARD_ORIGIN`; ảnh lưu vào `.runtime/dashboard-review/` và được Git ignore.
