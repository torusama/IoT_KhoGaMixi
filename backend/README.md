# Backend Smart Posture Tracker

Backend chạy trên **Node-RED 5**, kết nối MQTT và lưu bằng **Firebase Realtime Database** hoặc file cục bộ để phát triển. ESP32 vẫn là nguồn tính góc, đường cong và thống kê.

## Chạy nhanh

Tại thư mục này, yêu cầu Node.js >=22.9:

```powershell
npm ci
npm run configure
npm run broker
```

Mở hai terminal khác tại backend: chạy `npm start` và `npm run simulator`. Cấu hình sinh trong `.env` được bỏ qua bởi Git; script configure không ghi đè tệp đã có. API ở `/api/v1`, cần Bearer token từ `.env`; editor tắt mặc định.

Mặc định STORE_DRIVER=file lưu `.runtime/store.json`, **chưa là cloud**. Chọn STORE_DRIVER=firebase với project/database URL và ADC, hoặc dùng emulator. Simulator gắn simulated:true và không điều khiển phần cứng thật.

## Các thành phần

| Đường dẫn | Trách nhiệm |
|---|---|
| `node-red/flows.json`, `nodes/` | Luồng nhận/validate/lưu, maintenance, REST/SSE |
| `node-red/settings.js`, `api.js` | Cấu hình runtime, auth/CORS và route API |
| `logic/service.js` | Command/session, ACK/state, dedupe, storage receipt, history và báo cáo |
| `integrations/mqtt/` | MQTT.js transport, validator v2, ví dụ message |
| `integrations/firebase/` | Adapter Admin SDK/file, rules và cấu hình emulator |
| `config/runtime.js`, `.env.example` | Cấu hình đang được nạp; JSON example cũ không được runtime đọc |
| `scripts/` | Configure, dev broker, simulator, Mosquitto config, kiểm tra và runner emulator |
| `infrastructure/mosquitto/`, `compose.yaml` | Mosquitto có password/ACL, template TLS và stack Docker phát triển |

Một instance backend cho cùng bộ thiết bị. Command được lưu trước publish; accepted khác applied; timeout là unknown, không tạo lại phiên. State retained không xác nhận online. Summary/event/final chỉ nhận receipt sau ghi bền; dữ liệu cũ không gán sang session mới. Phiên STOP và final đã lưu là hai trạng thái riêng.

## Kiểm thử

```powershell
npm run check
npm test
npm run test:firebase
```

Lệnh cuối cần JDK 21 và tải Firebase Emulator lần đầu. Bộ test gồm logic giao thức/phiên, runtime Node-RED thật với MQTT/REST/SSE và Firebase Admin SDK/emulator. Không dùng credential cloud hoặc ESP32 thật. Docker Compose/Mosquitto chưa chạy trong môi trường hiện tại.

## Tài liệu

- [Setup và cấu hình Firebase/Internet](../docs/setup.md)
- [API frontend](../docs/api.md)
- [MQTT contract v2](../docs/mqtt-contract.md)
- [Checklist firmware v2](../docs/device-integration.md)
- [Kiến trúc](../docs/architecture.md), [kế hoạch](../docs/PLAN.md)

Firmware hiện có còn v1; backend từ chối dữ liệu thiếu schema/boot/session thay vì tạo danh tính giả. Chưa xây dashboard hoàn chỉnh, gửi email thật, journal firmware hoặc phân quyền nhiều người dùng trong phần backend này. Event có yêu cầu thông báo được lưu pending để tích hợp dịch vụ email sau.
