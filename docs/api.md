# API cho frontend

Base path `/api/v1`, REST JSON và SSE. Mọi endpoint cần `Authorization: Bearer <API_TOKEN>`; không đưa token vào query string. CORS chỉ chấp nhận origin trong ALLOWED_ORIGINS. API token hiện là một token quản trị demo, chưa có tenant/user authorization.

## Endpoint

| Method | Path sau `/api/v1` | Kết quả |
|---|---|---|
| GET | `/health` | storage driver, trạng thái MQTT, readiness và counter |
| GET | `/devices` | Danh sách thiết bị/state/live data |
| GET | `/devices/:id` | online/stale/offline, tuổi state, telemetry và cờ telemetry_stale |
| POST | `/devices/:id/commands` | HTTP 202, command được lưu; chưa đồng nghĩa applied |
| GET | `/commands/:id` | Trạng thái pending/accepted/applied/rejected/unknown/cancelled và ACK/result |
| GET | `/devices/:id/references` | Các mốc đã xác nhận áp dụng |
| GET | `/sessions` | Metadata và final/snapshot mới nhất; có `device_id` filter |
| GET | `/sessions/:id` | Metadata, config snapshot, latest summary và final |
| GET | `/sessions/:id/keyframes` | Góc/curve lịch sử lưu thưa khoảng 5 giây |
| GET | `/sessions/:id/events` | Bản revision mới nhất của từng sự kiện |
| GET | `/sessions/:id/summaries` | Snapshot cộng dồn theo sequence |
| GET | `/reports/daily` | `from`, `to` dạng YYYY-MM-DD, tối đa 31 ngày; mặc định 7 ngày; tùy chọn device_id |
| GET | `/stream` | SSE snapshot/state/connection/telemetry/command/session/summary/event |

Danh sách phân trang dùng `limit` 1–200 (mặc định 50), `before` lấy từ `next_cursor`. Response `{items:[...],next_cursor:null/ID}`. Thứ tự giảm dần theo khóa ổn định, không bảo đảm key event là thời gian event. Sắp xếp theo trường thời gian tại frontend khi cần. Truy vấn history không gán dữ liệu cũ vào phiên hiện tại.

## Gửi lệnh

```json
{"command":"START","command_id":"ui_start_001","mode":"measurement_only"}
```

`mode:reference` yêu cầu mốc đã xác nhận. Backend cấp `session_id`; dùng ID đó cho STOP:

```json
{"command":"STOP","command_id":"ui_stop_001","session_id":"ses_ID_FROM_START"}
```

Các lệnh còn lại:

```json
{"command":"SET_REFERENCE","command_id":"ui_ref_001","guided_confirmation":true}
{"command":"SET_REMINDER","command_id":"ui_reminder_001","enabled":false}
{"command":"TEST_VIBRATION","command_id":"ui_motor_001","duration_ms":200}
{"command":"CONFIG","command_id":"ui_rate_001","publish_interval_ms":100}
```

Các dòng trên là những request JSON riêng. Nếu không gửi command_id, backend tạo ID mới. Frontend nên tạo và giữ ID trước request để retry HTTP dùng **cùng ID và cùng body**, tránh mất response rồi tạo thao tác mới. Backend chỉ cho một pending command/device; lỗi xung đột trả 409.

Frontend giữ trạng thái chờ đến command applied hoặc state mới phù hợp. accepted chỉ là thiết bị đang xử lý. unknown nghĩa là chưa xác định, không phải thất bại chắc chắn. Chuyển từ unknown sang rejected/applied dựa vào ACK/state đối chiếu; không tự giải phóng reservation trên UI rồi phát START mới.

Session `status=stopped` xác nhận đã kết thúc; `storage_status=saved` xác nhận final đã lưu bền. `storage_driver=file` không là cloud, nên `cloud_status=not_configured`. Với driver firebase, cloud_status=saved nói adapter Firebase đã nhận ghi; kiểm tra môi trường để phân biệt emulator/cloud thật. Phiên interrupted chưa có final dùng snapshot mới nhất và phải hiển thị là chưa hoàn chỉnh.

Mốc chỉ xuất hiện trong danh sách references sau thiết bị xác nhận config mới. START không tự chụp mốc. SET_REFERENCE bị khóa khi RUNNING; tắt nhắc vẫn tiếp tục đo.

## SSE và client có sẵn

```javascript
import { PostureApi } from './assets/js/posture-api.js';
const api = new PostureApi({ baseUrl: 'http://127.0.0.1:1880', token });
const controller = new AbortController();
for await (const event of api.stream({ signal: controller.signal })) {
  // event.type: snapshot, telemetry, state, connection, command, session, summary, event
  render(event);
}
```

Client dùng fetch streaming để đặt Bearer header; native EventSource không hỗ trợ header này. Token giữ trong bộ nhớ ứng dụng. SSE đầu tiên là snapshot các device hiện tại; có heartbeat comment mỗi 15 giây. Tối đa 64 stream, đóng stream bị backpressure. Dùng AbortController để hủy; frontend tự reconnect với backoff và đọc lại REST/history. SSE ID không có cam kết phát lại qua Last-Event-ID.

`telemetry_stale=true` hoặc connection khác online phải được thể hiện rõ. Đồ thị không nối qua mẫu lỗi/null/gap. Live data mục tiêu 10 Hz; history chỉ có keyframe thực sự đã lưu. Không tính histogram lại bằng số gói hoặc cộng tất cả cumulative summaries.

## Thời gian và lỗi

Report dùng Asia/Ho_Chi_Minh và nhóm theo **ngày bắt đầu phiên**. Phiên qua nửa đêm vẫn thuộc ngày bắt đầu. Response có incomplete_count/estimated_time_count; received_estimate không phải timestamp đo đã đồng bộ UTC.

Lỗi `{error:{code,message}}`: 400 dữ liệu sai, 401 thiếu/sai token, 403 origin không cho phép, 404 không có tài nguyên, 409 xung đột trạng thái, 415 POST không dùng application/json, 429 quá nhiều stream, 503 storage/broker/queue không sẵn sàng. Chi tiết MQTT reason giữ trong command result, không coi HTTP 202 là thành công của thao tác vật lý.
