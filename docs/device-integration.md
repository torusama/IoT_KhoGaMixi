# ESP32 thật → MQTT → backend → dashboard

Đấu dây và nạp firmware xem [hardware/README.md](../hardware/README.md). Tài liệu này giải thích **đường nhận dữ liệu hiện có**, các điểm chưa nối và quy trình tích hợp cho người tiếp theo. Đối chiếu source làm việc ngày 15/11/2026; không có mạch ESP32/MPU6050 kết nối để nghiệm thu phần cứng.

## 1. Kết luận kiểm tra: đã có bộ nhận dữ liệu chưa?

**Có bộ nhận MQTT ở backend. Chưa có đường end-to-end từ firmware ESP32 hiện tại đến dashboard.** Không có bộ nhận USB Serial hoặc WebSocket trực tiếp từ ESP32 trong repo này.

| Thành phần | Source kiểm tra | Hành vi hiện tại |
|---|---|---|
| Đọc cảm biến | `hardware/firmware/src/mpu_reader.cpp`, `angle_calculator.cpp` | Đọc bốn MPU qua TCA, lọc Pitch, status 1/0; chỉ chạy khi measurementRunning |
| Gửi dữ liệu mạch | `hardware/firmware/src/mqtt_handler.cpp` | WiFiClient/PubSubClient, JSON legacy; MQTT connect chỉ có client ID, chưa auth |
| Broker local | `backend/scripts/dev-broker.js` | Auth/ACL, mặc định chỉ 127.0.0.1:1883; thiết bị phải có username=client ID=device ID |
| Cấu hình Mosquitto | `backend/scripts/mosquitto-config.js`, `compose.yaml` | Sinh password hash/ACL; Docker mặc định publish loopback, không tự mở LAN |
| MQTT subscriber backend | `backend/integrations/mqtt/transport.js` | Subscribe `posture/+/{state,ack,data,summary,event}` sau khi connect |
| Node-RED ingress | `backend/node-red/nodes/posture.js` | Chuyển message vào PostureService.ingest; log `Rejected device message: CODE` khi lỗi |
| Schema và session | `backend/integrations/mqtt/protocol.js`, `backend/logic/service.js` | Bắt buộc v2; kiểm boot/session/config/sequence trước nhận live telemetry |
| API và realtime | `backend/node-red/api.js` | GET device/history, POST command và SSE `/api/v1/stream`, có Bearer token |
| Client frontend | `frontend/assets/js/posture-api.js` | Có fetch REST/SSE; chưa tự được dùng trong Dashboard 2.0 |
| Dashboard | `frontend/dashboard/build-flow.js`, `model.js`, `widget.vue` | Link adapter IN/OUT chưa được nối; mode demo sinh góc/ACK tại chỗ; geometry production đang chặn |
| Adapter F02.1 | `shared/geometry/f01-adapter.js` | Chỉ là hàm chuyển dữ liệu/tính toán sau khi đã có frame; không tự nghe MQTT/USB/SSE |

Luồng đã có ở backend:

```text
MQTT broker
  → MqttTransport nhận topic/payload
  → node posture-mqtt-in
  → node posture-ingest
  → PostureService.ingest()
  → validateMessage() kiểm schema v2
  → onState / onAck / onData / onSummary / onEvent
  → lưu file hoặc Firebase + phát REST/SSE
```

`onData()` chỉ đưa frame lên live view khi khớp phiên RUNNING, boot, revision và sequence; gói muộn không được gán vào phiên mới. Một gói MQTT đến broker chưa đồng nghĩa đã được backend chấp nhận. Một HTTP health 200 cũng chưa chứng minh có telemetry thiết bị.

### Những điểm đang chặn phần cứng thật

1. Broker mặc định không có listener truy cập từ ESP32 ngoài máy tính.
2. Firmware gọi `mqtt.connect(DEVICE_ID)` nhưng broker yêu cầu user/password.
3. Firmware phát `pitch/relative/status/timestamp_us`, thiếu `schema_version:2`, boot/state/heartbeat/session/sequence/revision và curve v2.
4. ACK firmware dùng `ok/error`, backend dùng `accepted/applied/rejected` với correlation và trạng thái phiên.
5. Dashboard chưa có adapter lấy REST/SSE và chuyển lệnh UI sang API; geometry trong widget hiện chỉ bật cho demo.
6. F01 chưa xuất đủ bằng chứng đồng bộ/mounting/calibration để cấp context hình học production có căn cứ.

Không thể sửa bằng cách chỉ đổi Wi-Fi/IP, thêm `schema_version:2`, hoặc đổi `SPT_MODE=production`. Không tự gán session/boot hay coi sensor thiếu là góc 0 để vượt validator.

## 2. Firmware hiện gửi gì và backend cần gì?

Ví dụ payload legacy của firmware, chỉ minh họa cấu trúc:

```json
{"device_id":"esp32_01","timestamp_us":1000000,"pitch":[30,20,10,0],"relative":[-10,-10,-10],"status":[1,1,1,1]}
```

Validator hiện trả **SCHEMA_UNSUPPORTED** với payload này. Đã kiểm tra trực tiếp bằng `validateMessage()` và có test regression tương ứng.

| Firmware legacy | Contract v2 cần có |
|---|---|
| `pitch[4]` | `pitch_deg[4]`, vị trí P1→P4, null nếu sensor lỗi |
| `status[4]` 1/0 | `sensor_quality[4]`, ví dụ OK/MISSING/READ_ERROR/STALE |
| `relative[3]` dưới−trên | `relative_deg[3]` trên−dưới, wrap [-180,180) |
| `timestamp_us` micros 32 bit | `t_mono_us` đơn điệu theo boot, `ts_unix_ms` nullable; xử lý rollover |
| Không có state/heartbeat | `state`, `state_seq`, `online`, boot, config snapshot |
| Không có session/revisions | Session backend cấp và các revision khớp snapshot bất biến |
| Không có curve | `curve_valid`, `curve` đúng order/nodes_mm/kappa_per_mm; invalid thì null |
| ACK `ok/error` | ACK v2 có command ID, boot/session/state và status đúng contract |
| Không có thống kê/final/receipt | Summary cộng dồn, event/final retry và receipt sau ghi bền theo thiết kế |

Payload đầy đủ xem [state.json](../backend/integrations/mqtt/examples/state.json), [data.json](../backend/integrations/mqtt/examples/data.json), [command.json](../backend/integrations/mqtt/examples/command.json), [ack.json](../backend/integrations/mqtt/examples/ack.json) và [MQTT contract](mqtt-contract.md). Các file example là mẫu contract, không được dùng làm số đo thật.

Ngoài ra, JSON trên đường MQTT dùng `timestamp_us`, còn adapter cho snapshot `ProcessedMPUData` của F01 dùng `timestamp`. Nếu dùng adapter để chẩn đoán snapshot legacy, caller phải ánh xạ tên field này một cách rõ ràng. Đổi tên field không tạo ra bằng chứng synchronized hay xác nhận hướng Pitch; không truyền các cờ true tùy ý.

## 3. Chuẩn bị broker LAN cho ESP32

### 3.1. Chọn đúng IP và đúng mạng

Máy chạy broker và ESP32 phải truy cập được nhau trong LAN. Trên Windows:

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object InterfaceAlias, IPAddress
```

Chọn IP của Wi-Fi/Ethernet thật đang nối cùng mạng ESP32, không lấy IP Docker/WSL/VPN. `192.168.1.100` trong source là ví dụ; thay bằng IP máy bạn, nên giữ ổn định bằng DHCP reservation nếu nhóm dùng lâu dài. ESP32 classic dùng Wi-Fi 2.4 GHz. Router guest/client isolation có thể chặn hai máy dù cùng SSID.

`127.0.0.1` là chính thiết bị đang chạy chương trình; trên ESP32 nó không trỏ về laptop. `0.0.0.0` là địa chỉ bind listener, không phải địa chỉ broker để điền trên ESP32.

### 3.2. Broker nào đang chạy?

| Cách chạy | Truy cập mặc định | Việc còn cần cho LAN |
|---|---|---|
| `npm run broker` | Aedes trên 127.0.0.1:1883 | CLI hiện không có biến host; đổi `.env MQTT_URL` không đổi listener |
| `docker compose up` | Mosquitto trong container, host publish 127.0.0.1:1883 | Tạo profile/copy local với host binding là IPv4 LAN |
| Mosquitto native | Theo file config bạn cấp | Listener, password_file, acl_file và firewall phải khớp môi trường |

`npm run broker:config` **chỉ sinh** `.runtime/mosquitto/passwords` và `acl`; nó không khởi động broker, không bật listener LAN và không sửa firewall.

### 3.3. Ví dụ chuẩn bị Mosquitto LAN bằng Docker Compose

Đây là hướng dẫn cấu hình cho người tích hợp, **chưa chạy kiểm chứng Docker/LAN trên máy bàn giao**. Dừng broker/backend local đang dùng cùng bộ cổng/dữ liệu trước; chỉ chạy một backend điều phối mỗi bộ thiết bị.

Tại `backend/`:

```powershell
npm ci
npm run configure
npm run broker:config
Copy-Item compose.yaml compose.lan.local
```

Nếu `compose.lan.local` đã có, giữ cấu hình riêng và sửa tệp đó, không chép đè tùy tiện. `.local` đã được Git ignore. Trong **bản copy**, chỉ thay dòng publish port của service `mqtt` từ:

```yaml
- "127.0.0.1:1883:1883"
```

sang IP LAN thật của máy, ví dụ:

```yaml
- "192.168.1.100:1883:1883"
```

Đây chỉ là đoạn `ports`, không phải toàn bộ compose file. Giữ auth `allow_anonymous false`, password/ACL mounts và các service còn lại. Giữ backend HTTP bind host loopback nếu chỉ dùng trên laptop; ESP32 không cần gọi HTTP 1880 để phát MQTT.

```powershell
docker compose -f compose.lan.local up --build
```

Cho phép TCP 1883 qua firewall của máy trên mạng Private/LAN cần dùng; không tắt firewall toàn bộ. Trên một máy khác trong LAN có thể thử `Test-NetConnection 192.168.1.100 -Port 1883`; TCP thành công mới chỉ xác nhận mở cổng, chưa xác nhận MQTT auth/schema.

Backend **trong container** đã dùng `MQTT_URL=mqtt://mqtt:1883`. Client Node chạy trên host, nếu dùng profile bind chỉ LAN IP này, cần `MQTT_URL=mqtt://192.168.1.100:1883` trong môi trường của nó; giữ 127.0.0.1 sẽ không trỏ tới port chỉ bind LAN IP. Firmware điền cùng IP LAN vào MQTT_HOST. Không dùng hostname service `mqtt` của Docker trong ESP32.

Không chạy hai broker khác nhau cho backend và ESP32 rồi tưởng chúng đang trao đổi vì topic giống nhau. Khi dùng mạng ngoài LAN phát triển, cấu hình TLS/CA và triển khai theo [setup §5](setup.md#5-triển-khai-internet); firmware hiện dùng WiFiClient thường, chưa phải client TLS. Tham khảo [cấu hình listener/auth chính thức của Mosquitto](https://mosquitto.org/man/mosquitto-conf-5.html).

### 3.4. Credential cần đồng bộ

| Bên | Cấu hình cần dùng |
|---|---|
| Backend | MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD trong backend/.env |
| Thiết bị | client ID và username = DEVICE_ID; password = DEVICE_MQTT_PASSWORD của đúng thiết bị |
| ESP32 legacy hiện tại | Chưa có tham số username/password trong mqtt.connect; phải bổ sung ở firmware |
| Mosquitto config | Chạy lại broker:config và restart broker khi chủ động thay credential |

MQTT_HOST chỉ là IP/DNS, không có `mqtt://` trong lời gọi `mqtt.setServer()` của firmware. MQTT_URL của Node lại cần scheme `mqtt://` hoặc `mqtts://`. Không đưa API_TOKEN, tài khoản backend hoặc service account Firebase vào firmware/widget. Không commit credential thật.

## 4. Quy trình xác nhận đường dữ liệu thật

Các bước sau áp dụng **sau khi firmware v2 đã được hoàn thiện**. Không dùng API START dưới đây với firmware legacy rồi coi là đã tạo phiên hợp lệ.

1. Đấu mạch, nạp, xem đủ bốn READY; xác nhận hướng lắp và khoảng cách thực.
2. Dừng simulator cùng device ID/client ID. Một client ID dùng đồng thời có thể làm broker ngắt kết nối bên còn lại.
3. ESP32 kết nối broker LAN có auth, gửi state/heartbeat v2. GET `/devices` phải thấy đúng device ID, boot và `connection:'online'` từ heartbeat mới; state retained đơn lẻ chưa đủ.
4. START qua API, đợi `status:'applied'` và state RUNNING của đúng session/boot.
5. Đọc `/devices/:id`: telemetry có pitch_deg/sensor_quality, session/revision đúng, telemetry_stale=false. Đọc SSE để xác nhận event telemetry mới.
6. STOP đúng session. Đợi applied, sau đó kiểm tra final/session có storage_status=saved riêng; ACK STOP chưa chứng minh final đã ghi bền.
7. Chạy lại với mất sensor/mất mạng/reconnect để xác nhận gap/null, không dùng frame cũ và không gán nhầm phiên.

Ví dụ PowerShell tại `backend/`, sau khi broker/backend/firmware v2 sẵn sàng:

```powershell
$apiToken = ((Get-Content .env | Where-Object { $_ -like 'API_TOKEN=*' }) -split '=', 2)[1]
$headers = @{ Authorization = "Bearer $apiToken" }
$baseUrl = 'http://127.0.0.1:1880/api/v1'
$deviceId = 'esp32_01'

Invoke-RestMethod "$baseUrl/health" -Headers $headers
Invoke-RestMethod "$baseUrl/devices/$deviceId" -Headers $headers

$startBody = @{
  command = 'START'
  command_id = [guid]::NewGuid().ToString()
  mode = 'measurement_only'
} | ConvertTo-Json
$startCommand = Invoke-RestMethod "$baseUrl/devices/$deviceId/commands" `
  -Method Post -Headers $headers -ContentType application/json -Body $startBody

# Lặp truy vấn trạng thái khi cần; không POST START ID mới để thay cho việc chờ.
$startStatus = Invoke-RestMethod "$baseUrl/commands/$($startCommand.command_id)" -Headers $headers
$startStatus
```

Chỉ khi status đã applied, đọc state để lấy session:

```powershell
$device = Invoke-RestMethod "$baseUrl/devices/$deviceId" -Headers $headers
$sessionId = $device.state.session_id
$device.telemetry

# Chỉ gửi STOP khi sessionId thuộc đúng phiên đang RUNNING.
$stopBody = @{
  command = 'STOP'
  command_id = [guid]::NewGuid().ToString()
  session_id = $sessionId
} | ConvertTo-Json
$stopCommand = Invoke-RestMethod "$baseUrl/devices/$deviceId/commands" `
  -Method Post -Headers $headers -ContentType application/json -Body $stopBody
Invoke-RestMethod "$baseUrl/commands/$($stopCommand.command_id)" -Headers $headers

# Sau khi STOP applied và final đã tới:
$session = Invoke-RestMethod "$baseUrl/sessions/$sessionId" -Headers $headers
$session.meta
$session.final
```

Không tự đặt session ID nếu field chưa có. HTTP 202 là đã tiếp nhận yêu cầu, accepted là thiết bị đang xử lý, unknown là chưa xác định; xem [API](api.md) để retry đúng command ID/nội dung. Không coi JSON mẫu hoặc simulator `simulated:true` là telemetry thật.

## 5. Nối dashboard với backend và F02.1

Dashboard cổng 1881 là runtime riêng. Backend cổng 1880 phát REST/SSE. Các điểm `F06.1 normalized events and ACK` và `F06.1 command adapter OUT` trong flow dashboard hiện có `links:[]`, chưa nối với backend. Widget `geometry()` hiện từ chối mode khác demo; đây là giới hạn source đang có, không phải chỉ thiếu một URL cấu hình.

Người thực hiện adapter production cần làm đủ:

- Một thành phần phía server đọc REST snapshot và SSE của backend với Bearer token, reconnect và tải lại snapshot. Không đặt token quản trị trong Vue widget hoặc query string.
- Ánh xạ pitch_deg/sensor_quality/connection/received_at_ms thành state UI; kiểm tra device/boot/session/revision, độ mới và dữ liệu đồng bộ. Frame lỗi/stale phải xóa geometry và để gap.
- Ánh xạ START_SESSION→START, STOP_SESSION→STOP đúng session, SAVE_REFERENCE→SET_REFERENCE có guided_confirmation, SET_REMINDER và TEST_VIBRATION. Đối chiếu command ID và chỉ xác nhận applied/state có thẩm quyền.
- Nạp config snapshot có distances_mm thay vì tự dùng 70 mm. Xác nhận quy ước Pitch SPT và bằng chứng đồng bộ trước gọi `reconstructF01Frame`; core không tự nhận dữ liệu mạng hoặc chứng minh acquisition đồng bộ.
- Bổ sung đường render geometry production sau validation, giữ scale X:Y=1:1 và phân biệt nguồn dữ liệu thật/mô phỏng. Bỏ guard demo đơn thuần không phải một adapter hoàn chỉnh.
- Tải history/reference/report từ API; không dùng lịch sử và biểu đồ minh họa cố định của demo làm dữ liệu thiết bị.

Client REST/SSE đã có tại [posture-api.js](../frontend/assets/js/posture-api.js); contract và mapping UI xem [dashboard README](../frontend/dashboard/README.md). SSE dùng fetch streaming để gắn Authorization, không dùng native EventSource với token trong URL.

## 6. Checklist hoàn thiện firmware v2

1. Sinh boot ID mới; dùng clock đơn điệu 64 bit, session/sequence/revision trong struct frame. Tăng MQTT/JSON buffer theo kích thước đã đo, kiểm tra cấp phát và cả header/topic.
2. Cấu hình MQTT user là device ID và password riêng; production dùng TLS/CA. Subscribe cmd/receipt QoS 1. Không dùng tài khoản backend cho ESP32.
3. Publish state retained khi khởi động, heartbeat khoảng 1 giây và mỗi lần chuyển state/config. State có config snapshot đủ mapping/khoảng cách/calibration/reference revisions; không đưa Wi-Fi/MQTT password vào config publish.
4. LWT online:false có đúng device/boot. State_seq phải mới trong cùng boot; heartbeat hiện tại không được gửi lại một sequence cũ.
5. MQTT callback chỉ copy envelope vào command queue. Sensor/session task sở hữu I²C/filter/session/config và kiểm tra preflight bằng dữ liệu mới. Khởi tạo lỗi, thiếu sensor, hướng lắp chưa xác nhận hoặc geometry không hợp lệ phải reject START.
6. IDLE có chẩn đoán, PREFLIGHT warm-up; chưa cộng thời gian học. Gửi accepted/PREFLIGHT rồi applied/RUNNING kèm thời điểm bắt đầu thật, hoặc rejected/reason. Giữ filter đã ổn định khi bắt đầu.
7. Cache kết quả theo boot/command ID và nội dung. Retry khi PREFLIGHT không mở lại cửa sổ; lệnh đã applied trả kết quả cũ kể cả deadline qua; lệnh mới quá hạn không thực thi. TEST_VIBRATION lặp không tạo nhịp thứ hai.
8. Frame gắn session ID từ lúc thu nhận. STOP chỉ áp dụng đúng phiên, đóng event/tắt motor/chốt final. Xóa hoặc loại frame/cache đời phiên cũ trước START tiếp theo.
9. SET_REFERENCE chỉ khi IDLE và qua quy trình hướng dẫn; capture trên tín hiệu ổn định, giữ chênh góc hình học thật. Trả config mới trong ACK applied với reference_rev backend yêu cầu; không tự zero bốn góc hình học.
10. Relative theo P1−P2/P2−P3/P3−P4; dựng P4→P3→P2→P1 bằng d34/d23/d12, giữ θ4 thật. Dữ liệu lỗi có null/quality rõ; curve đầy đủ không hợp lệ thì null.
11. Tính dt/histogram/event trên mẫu cảm biến. Summary cộng dồn khoảng 5 giây; event revision và final có ID cố định, queue/outbox riêng và retry đến receipt stored. Không nối sự kiện qua gap; không lấy tần suất MQTT làm thời lượng.
12. Mất Internet vẫn đo/thống kê/rung tại chỗ khi hợp lệ. Reconnect gửi state/snapshot và outbox còn lại. Không hứa khôi phục dữ liệu RAM đã mất qua reboot; boot mới không tự chạy tiếp session cũ.

Firmware không thể tự xác nhận chắc chắn module còn áp sát người từ WHO_AM_I. Cách gắn, khoảng cách và axis mapping cần được kiểm tra trên đồ gá và xác nhận có hướng dẫn. Chi tiết nguồn/motor và phép thử theo [PLAN](PLAN.md).

## 7. Kiểm thử đã xác nhận và phần chưa xác nhận

Chạy broker, Node-RED, simulator theo setup. Gửi SET_REFERENCE → chờ applied/config → START mode reference → đọc data/summary → tắt nhắc/thử rung mô phỏng → STOP → nhận final/receipt → tải lại lịch sử. Sau đó thay simulator bằng firmware v2 có cùng device ID/credential và chạy lại checklist trên phần cứng thật.

Không chạy simulator và ESP32 cùng client ID đồng thời: broker sẽ thay kết nối cũ. Simulator gắn simulated:true, không dùng kết quả của nó làm bằng chứng độ chính xác cảm biến hoặc motor vật lý.

Trong lần rà soát tài liệu này, `npm test` tại backend chạy **50 PASS, 0 FAIL, 1 SKIP** (Firebase Emulator chưa chọn). Test tích hợp chạy broker xác thực + Node-RED + simulator + REST/SSE/persistence; test schema xác nhận JSON firmware legacy bị từ chối. Không có ESP32/MPU6050 thật, không chạy flash/Serial/LAN/Docker/nguồn/motor, nên chưa kết luận phần cứng đã kết nối được.

GitNexus không có index của repository này tại thời điểm kiểm tra; bảng trên được đối chiếu trực tiếp source/caller/contract trong checkout hiện tại, không lấy graph repo khác để xác nhận.
