# Tests

Chạy tại `backend/`: `npm test`, `npm run check`; Firebase Emulator/JDK 21: `npm run test:firebase`.

`backend/service.test.js` kiểm thử session/protocol/dedupe/storage failure/restart bằng clock giả lập. `backend/integration.test.js` chạy Node-RED thật, broker MQTT xác thực, simulator, REST/SSE và persistence; test Firebase dùng Admin SDK với project demo/emulator, không dùng database thật. Thư mục tạm và cổng riêng được dọn sau phép thử.

Kiểm thử sensor, đồ gá, motor thật và Internet qua hai mạng vẫn theo [PLAN](../docs/PLAN.md); simulator không thay các bằng chứng đó.
