# Backend Smart Posture Tracker

Backend chạy trên **Node-RED 5**, kết nối MQTT và lưu bằng **Firebase Realtime Database** hoặc file cục bộ để phát triển. Kiến trúc đích để ESP32 tính góc, cung và thống kê; firmware hiện chỉ có góc/MQTT legacy, còn simulator đã phát contract v2.

**Backend đã có bộ nhận dữ liệu MQTT; chưa nhận trực tiếp được payload firmware ESP32 hiện tại.** Đọc [đấu mạch](../hardware/README.md) và [đường nhận dữ liệu/những phần còn thiếu](../docs/device-integration.md) trước khi thay simulator bằng mạch thật.

## Cơ chế nhận dữ liệu hiện có

```text
ESP32 v2 hoặc simulator
  → MQTT broker
  → MqttTransport: subscribe state/ack/data/summary/event
  → Node-RED posture-mqtt-in → posture-ingest
  → PostureService.ingest → validateMessage
  → kiểm boot/session/revision/sequence
  → lưu trữ + API REST/SSE
```

Các topic nhận là `posture/+/{state,ack,data,summary,event}`. Backend phát `posture/{device_id}/cmd` và `/receipt`. Không có HTTP POST telemetry, USB Serial receiver hoặc WebSocket receiver cho ESP32 trong runtime này. Browser dùng REST/SSE có Bearer token; Socket.IO của Dashboard 2.0 là kênh giao diện riêng.

`mqtt_connected=true` chỉ xác nhận backend nối được broker. Thiết bị phải gửi state/heartbeat v2 mới xuất hiện hợp lệ và được phép START; telemetry phải thuộc đúng session đang RUNNING. JSON cũ `pitch/relative/status/timestamp_us` bị từ chối `SCHEMA_UNSUPPORTED`, không tự được chuyển đổi sang v2.

Dashboard cổng 1881 chưa tự consume REST/SSE này. `frontend/assets/js/posture-api.js` là client có sẵn nhưng adapter F06.1 của dashboard còn thiếu.

## Chạy nhanh

Tại thư mục này, yêu cầu Node.js >=22.9:

```powershell
npm ci
npm run configure
npm run broker
```

Mở hai terminal khác tại backend: chạy `npm start` và `npm run simulator`. Cấu hình sinh trong `.env` được bỏ qua bởi Git; script configure không ghi đè tệp đã có. API ở `/api/v1`, cần Bearer token từ `.env`; editor tắt mặc định.

Mặc định STORE_DRIVER=file lưu `.runtime/store.json`, **chưa là cloud**. Chọn STORE_DRIVER=firebase với project/database URL và ADC, hoặc dùng emulator. Simulator gắn simulated:true và không điều khiển phần cứng thật.

## Khi nối ESP32 trong LAN

- `npm run broker` chỉ lắng nghe 127.0.0.1:1883; `.env MQTT_URL` chỉ đổi nơi Node kết nối, không đổi địa chỉ broker đang listen.
- Compose mặc định cũng publish broker ở loopback. Cần cấu hình listener/host binding LAN và firewall trước; giữ password/ACL. Xem [hướng dẫn Mosquitto LAN](../docs/device-integration.md#3-chuẩn-bị-broker-lan-cho-esp32).
- `scripts/mosquitto-config.js` chỉ sinh password hash/ACL. Nó không bật broker hay kết nối mạch thay bạn.
- Firmware hiện gọi `mqtt.connect(DEVICE_ID)` chưa có user/password, nên broker có auth sẽ từ chối. Sau khi thêm auth vẫn phải hoàn thiện payload/state/session v2.
- ESP32 dùng MQTT_HOST=IPv4 LAN của broker, MQTT_PORT=1883; username/client ID là device ID, password thiết bị riêng. `.env` không tự được nạp vào ESP32.
- Dừng simulator cùng ID trước khi thử mạch. Không cấp tài khoản backend cho thiết bị, không nhúng API_TOKEN vào widget/firmware.

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

Firmware hiện có còn legacy; backend từ chối dữ liệu thiếu schema/boot/session thay vì tạo danh tính giả. Có dashboard mô phỏng riêng, chưa nối production; gửi email thật, journal firmware hoặc phân quyền nhiều người dùng chưa hoàn chỉnh. Event có yêu cầu thông báo được lưu pending để tích hợp dịch vụ email sau.
