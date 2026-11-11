# Chạy backend và tích hợp thiết bị

Backend chạy bằng Node-RED 5, yêu cầu Node.js **≥22.9**; đã kiểm tra trên Node 24. Firmware dùng PlatformIO/Arduino, là luồng phát triển riêng. [API](api.md), [MQTT v2](mqtt-contract.md), [tích hợp firmware](device-integration.md).

## 1. Chạy local không cần tài khoản cloud

Từ thư mục gốc:

```powershell
cd backend
npm ci
npm run configure
npm run broker
```

`configure` tạo `.env` với token/password ngẫu nhiên, không ghi đè tệp đã có và không in secret. Broker Aedes chỉ bind `127.0.0.1:1883`, có xác thực và ACL riêng backend/device. `.env`, `.runtime/`, cache và node_modules không commit.

Trong terminal thứ hai, tại `backend/`:

```powershell
npm start
```

Trong terminal thứ ba, tại `backend/`:

```powershell
npm run simulator
```

Node-RED phục vụ `http://127.0.0.1:1880/api/v1/`. Editor mặc định tắt. Muốn xem flow trong môi trường local, đặt `ENABLE_EDITOR=true` trong `.env`, restart và mở `/editor`. Khi bind ngoài loopback, editor cần user/bcrypt hash qua `NODE_RED_ADMIN_*`; tạo hash bằng `npx node-red admin hash-pw`. Không mở editor không bảo vệ ra Internet.

Kiểm tra trong PowerShell tại `backend/`:

```powershell
$apiToken = ((Get-Content .env | Where-Object { $_ -like 'API_TOKEN=*' }) -split '=', 2)[1]
$headers = @{ Authorization = "Bearer $apiToken" }
Invoke-RestMethod http://127.0.0.1:1880/api/v1/health -Headers $headers
Invoke-RestMethod http://127.0.0.1:1880/api/v1/devices -Headers $headers
$body = @{ command='START'; command_id=[guid]::NewGuid().ToString(); mode='measurement_only' } | ConvertTo-Json
$command = Invoke-RestMethod http://127.0.0.1:1880/api/v1/devices/esp32_01/commands -Method Post -Headers $headers -ContentType application/json -Body $body
Invoke-RestMethod "http://127.0.0.1:1880/api/v1/commands/$($command.command_id)" -Headers $headers
```

HTTP 202 chỉ xác nhận backend đã lưu yêu cầu. Chờ command `status=applied` và state/session phù hợp. Khi dừng, gửi STOP với `session_id` nhận từ START; sau đó kiểm tra `storage_status=saved` riêng với ACK STOP.

Chế độ mặc định `STORE_DRIVER=file` lưu `.runtime/store.json`; `cloud_status=not_configured`, không phải Firebase. Simulator không đọc sensor hoặc chạy motor thật; dữ liệu có `simulated:true`. Dừng từng tiến trình bằng Ctrl+C.

## 2. Firebase Emulator

Cần JDK **21** để chạy CLI/emulator đã khóa trong devDependencies. Nếu `java -version` vẫn chọn Java 8, đặt JAVA_HOME tới JDK 21 và đưa `JAVA_HOME/bin` lên đầu PATH cho terminal này. Không cần đăng nhập Firebase để dùng project demo.

```powershell
cd backend
npm run emulators
```

Đổi `.env` của backend:

```dotenv
STORE_DRIVER=firebase
FIREBASE_PROJECT_ID=demo-spt
FIREBASE_DATABASE_URL=https://demo-spt-default-rtdb.firebaseio.com
FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000
```

Restart backend; broker/simulator giữ như trước. Host emulator không có tiền tố http. Cấu hình/rules ở `backend/integrations/firebase/`. Emulator mặc định không giữ dữ liệu sau khi tắt; cần export/import riêng nếu muốn giữ fixture qua các lần chạy.

## 3. Firebase RTDB thật

Tạo database dành cho đồ án, lấy chính xác project ID và Database URL từ Firebase Console. Cấu hình `.env`:

```dotenv
STORE_DRIVER=firebase
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_DATABASE_URL=https://your-instance.REGION.firebasedatabase.app
GOOGLE_APPLICATION_CREDENTIALS=D:/private/secrets/firebase-admin.json
```

Bỏ `FIREBASE_DATABASE_EMULATOR_HOST` khỏi cả `.env` và environment của terminal. Dùng service account/ADC có quyền phù hợp, lưu bên ngoài Git. Rules đi kèm từ chối client đọc/ghi; frontend đi qua API có xác thực, Admin SDK thực hiện ghi. Áp dụng rules vào đúng database đồ án, không ghi đè rules của ứng dụng khác.

Adapter bảo toàn null/collection rỗng của JSON bằng marker nội bộ `__spt_type__` trong RTDB; API tự giải mã, frontend vẫn nhận null/array/object như contract. Không sửa marker bằng tay hoặc dùng khóa này trong payload.

Chỉ một instance backend điều phối cùng bộ thiết bị. Chuyển driver không tự di chuyển lịch sử từ file sang Firebase. `storage_driver` trong metadata cho biết adapter đã dùng; Firebase Emulator cũng dùng driver firebase nhưng không phải cloud thật.

## 4. Mosquitto bằng Docker Compose

Cần Docker/Compose, chạy tại `backend/` sau configure:

```powershell
npm run broker:config
docker compose up --build
```

Script tạo password hash PBKDF2 và ACL trong `.runtime/mosquitto/`, không in password. Linux cần bảo đảm user của container Mosquitto đọc được các tệp mount này. Compose này dành cho phát triển, chỉ publish port ra loopback; dừng broker/backend Node local trước để tránh trùng port. Simulator chạy trên host dùng cùng `.env`.

Compose giữ dữ liệu bằng named volume. Không chạy `docker compose down -v` nếu còn cần lịch sử. Môi trường hiện tại chưa chạy kiểm chứng Compose/Mosquitto; đường Node local/Aedes đã được kiểm thử tích hợp.

## 5. Triển khai Internet

- Dùng broker public có DNS, tài khoản/ACL và certificate hợp lệ. Có template `mosquitto-tls.conf.example` cho listener 8883; mount certificate/key riêng. Cập nhật publish port/firewall theo môi trường đã chọn.
- Backend đặt `MQTT_URL=mqtts://...`, user/password, `MQTT_CA_FILE` nếu CA riêng; ESP32 cũng cần client TLS và xác minh CA.
- Dùng HTTPS reverse proxy cho API/SSE. Tắt proxy buffering cho `/api/v1/stream`; chỉ cho các origin frontend cần thiết trong ALLOWED_ORIGINS.
- Đặt NODE_ENV=production: runtime yêu cầu MQTT TLS có auth và Firebase thật. API dùng Bearer token dài ≥24 ký tự; token hiện có quyền quản lý toàn bộ demo, chưa có phân quyền nhiều người dùng. Không nhúng service account vào frontend.
- Thử điện thoại 4G/5G khác mạng thiết bị trước khi coi đạt yêu cầu Internet. Không coi broker LAN hoặc localhost là bản triển khai Internet.

## 6. Kiểm thử

Từ `backend/`:

```powershell
npm run check
npm test
npm run test:firebase
```

`npm test` chạy logic và Node-RED/MQTT/REST/SSE thật, dùng port/temp directory riêng; test Firebase được skip nếu không chọn emulator. `test:firebase` tự khởi động RTDB Emulator với project demo, chạy test Firebase rồi tắt. Lần đầu cần Internet để tải binary emulator. Đã kiểm tra persistence, null round-trip và session/event với Firebase Admin SDK trên emulator; chưa dùng tài khoản cloud hoặc ESP32 thật.

## 7. Firmware

Từ gốc repository:

```text
pio run -d hardware/firmware
pio run -d hardware/firmware -t upload
pio device monitor -d hardware/firmware -b 115200
```

Các lệnh này là workflow PlatformIO của thư mục hiện có, chưa được xác minh lại trong thay đổi backend này. Firmware MQTT hiện còn v1; hoàn thiện [device-integration.md](device-integration.md) trước khi dùng để nghiệm thu v2.
