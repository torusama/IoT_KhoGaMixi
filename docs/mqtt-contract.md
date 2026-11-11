# MQTT contract v2

Validator thực thi: `backend/integrations/mqtt/protocol.js`; ví dụ có thể kiểm tra: `backend/integrations/mqtt/examples/`. Đây là contract cho thiết bị v2, chưa được firmware hiện tại hỗ trợ đầy đủ. Không tự chuyển dữ liệu v1 thành dữ liệu phiên v2.

## Topic và QoS

Gốc `posture/{device_id}/`; ID chỉ gồm chữ/số/`_`/`-`, dài 1–64, bắt đầu bằng chữ hoặc số. Payload UTF-8 JSON object, tối đa **16 KiB**; broker cho phép packet đến 32 KiB để có phần topic/header. Thiết bị vẫn phải đo buffer JSON và MQTT thực tế, không mặc định buffer 512 byte đủ.

| Topic | Bên phát → nhận | QoS | Retained |
|---|---|---|---|
| `data` | ESP32 → backend | 0 | false |
| `state` | ESP32 → backend | 0, kể cả LWT | true |
| `ack` | ESP32 → backend | 0 | false |
| `summary` | ESP32 → backend | 0 + receipt/retry ứng dụng | false |
| `event` | ESP32 → backend | 0 + receipt/retry ứng dụng | false |
| `cmd` | backend → ESP32 | 1, ESP32 subscribe 1 | false |
| `receipt` | backend → ESP32 | 1, ESP32 subscribe 1 | false |

PubSubClient hiện tại chỉ publish QoS 0; không coi PUBACK là ACK thực thi. MQTT.js backend dùng TLS kiểm tra certificate khi URL là mqtts. Không retained lệnh, không phát lệnh cũ với deadline mới. Xóa retained cmd cũ nếu broker thử nghiệm trước đây từng lưu.

## Trường chung và thời gian

Message thiết bị có `schema_version:2`, `device_id`, `boot_id`, `t_mono_us` số nguyên an toàn không âm. Các ID không dùng từ dành riêng `constructor`, `prototype`, `__proto__`. `boot_id` mới mỗi lần boot; `t_mono_us` lấy từ clock đơn điệu 64 bit, không là Unix time. `ts_unix_ms` là UTC nếu đã đồng bộ, có thể null/vắng khi chưa có. Backend thêm `received_at_ms` riêng.

Message thuộc phiên có `session_id` do backend cấp trong START. ID gắn vào frame ngay khi thu nhận. Số thứ tự là integer an toàn không âm; các summary/event ID phải ổn định qua retry. Mọi giá trị số phải hữu hạn; không gửi NaN/Infinity. `__spt_type__` được dành riêng cho lớp lưu trữ, không dùng trong payload.

## State và cấu hình

State heartbeat mục tiêu mỗi giây, có `online:true`, `state_seq` tăng theo boot, `state` thuộc IDLE/PREFLIGHT/RUNNING/STOPPING. IDLE có `session_id:null`, trạng thái còn lại có ID phiên. Có `config` đầy đủ:

```json
{
  "config_rev": "cfg_1",
  "geometry_rev": "g_1",
  "calibration_rev": "c_1",
  "reference_rev": null,
  "algorithm_version": "arc2d_v1",
  "distances_mm": [70, 70, 70],
  "sensor_map": [0, 1, 2, 3],
  "mounting_confirmed": true,
  "reference": null
}
```

Khoảng cách >0, ≤1000 mm là giới hạn kiểm tra cấu hình bản đầu, không là ngưỡng giải phẫu. Bốn kênh sensor khác nhau trong 0–7. Mapping mặc định index 0–3=P1–P4, từ trên xuống; phải xác minh dây/gá thật. Khi có reference, `reference_rev` khác null và `reference` chứa cùng revision và `pitch_deg[4]`; bias/axis mapping là hiệu chuẩn thiết bị riêng.

State RUNNING nên kèm `started_at_mono_us`, `started_at_unix_ms` nếu biết; kèm `last_command_id`, `last_closed_session_id` để phục hồi mất ACK. LWT tối thiểu `schema_version/device_id/boot_id/online:false`. LWT sai boot bị bỏ qua. Retained state không chứng minh online; state trùng/lùi sequence không làm mới heartbeat. Mặc định 6 giây stale, 15 giây offline, cấu hình được.

## Commands

Mọi lệnh có `schema_version`, `device_id`, `command_id`, `command`, `target_boot_id`, `expected_config_rev`, `not_after_mono_us` theo boot đích. Thiết bị kiểm tra boot, idempotency cache rồi deadline/config trước thực thi mới. Lệnh đã thực thi trả lại kết quả cũ ngay cả khi deadline cũ đã qua; cùng ID khác nội dung bị từ chối.

| Command | Trường bổ sung | Điều kiện |
|---|---|---|
| START | `session_id`, `mode:measurement_only/reference`, `preflight_timeout_ms:5000` | IDLE, đủ sensor/cấu hình/hướng lắp/tín hiệu; reference mode cần mốc |
| STOP | `session_id` | Chỉ dừng đúng phiên RUNNING |
| SET_REFERENCE | `reference_rev`, `capture:current_stable` | IDLE; lấy mốc có hướng dẫn, không tự đặt lúc START |
| SET_REMINDER | `enabled:boolean` | Bật cần có reference; tắt không ngừng thu nhận |
| TEST_VIBRATION | `duration_ms`, 20–1000 | Nhịp hữu hạn, retry không rung lặp |
| CONFIG | `publish_interval_ms`, 50–5000 | Chỉ đổi nhịp truyền, không đổi thời gian tích lũy |

Node-RED chỉ cho một command pending/device. Đổi geometry/calibration/reference/algorithm khi RUNNING bị từ chối; snapshot phiên bất biến. Chưa có API chỉnh geometry/calibration từ backend: firmware phải cung cấp config đã xác nhận qua state trước khi START.

## ACK

Có envelope thiết bị, `command_id`, `session_id` của START/STOP, `status:accepted/applied/rejected`, `state`.

- accepted/PREFLIGHT: đã nhận, chưa xác nhận phiên chạy.
- applied/RUNNING cho START: đã bắt đầu thật; cung cấp thời điểm bắt đầu thực tế.
- applied/IDLE cho STOP: đã dừng cục bộ, chưa đồng nghĩa final đã lưu.
- SET_REFERENCE applied **phải** kèm config đầy đủ và reference revision backend yêu cầu; chỉ lúc này backend lưu mốc đã xác nhận.
- rejected có `reason` dạng ID như `SENSOR_MISSING`, `REFERENCE_REQUIRED`, `COMMAND_EXPIRED`; có thể thêm `failed_checks`.

Timeout backend là `unknown`, không tự mở phiên khác. Retry nguyên envelope để lấy cache/rejected; state mới đúng boot/session có thể khôi phục START, STOP hoặc SET_REFERENCE. Sau reboot, pending cũ bị cancelled và phiên bị interrupted.

## Telemetry data

Ngoài envelope/phiên: `sample_seq`, `telemetry_seq`, năm trường revision/version khớp snapshot; `pitch_deg[4]`, `relative_deg[3]`, `sensor_quality[4]`, `curve_valid`, `metric_valid`, `curve`.

Góc chuẩn hóa [-180,180). Relative là `[wrap(θ1−θ2),wrap(θ2−θ3),wrap(θ3−θ4)]`; validator cho dung sai số học 0,05°. Đây là dung sai kiểm tra payload, không là sai số phần cứng đã chứng minh. Quality thuộc OK/MISSING/READ_ERROR/MOTION/STALE/WARMING_UP. Pitch null khi quality không OK; relative null khi một đầu không hợp lệ.

Curve hợp lệ khi đủ bốn sensor: `order:[P4,P3,P2,P1]`, `nodes_mm` là bốn cặp số, `kappa_per_mm` ba số có dấu. Curve không hợp lệ phải null. P4=(0,0), x trước/y trên, giữ θ4 thật. Metric hợp lệ cần đủ bốn sensor và reference; mode measurement_only không tính histogram theo mốc. Backend không tự dựng curve thay dữ liệu lỗi.

## Summary/final

Trường bắt buộc: `message_id`, `summary_seq`, `last_sample_seq`, `coverage_start_mono_us`, `coverage_end_mono_us`, `elapsed_ms`, `valid_measurement_ms`, `valid_metric_ms`, `invalid_ms`, `histogram_ms[6]`, `is_final`.

`valid_measurement_ms + invalid_ms = elapsed_ms`; `valid_metric_ms ≤ valid_measurement_ms`; tổng histogram bằng valid metric time. Các bin là [0,5), [5,10), [10,15), [15,20), [20,25), [25,+∞). Thời lượng do ESP32 tính từ dt mẫu hợp lệ, không lấy số gói MQTT nhân publish interval.

Summary khoảng 5 giây là **cộng dồn từ đầu phiên**. Sequence mới không được giảm counter/bin. `is_final:true` phải là snapshot mới nhất; sau final không nhận summary vượt cutoff. Retry cùng ID/sequence giữ nguyên nội dung. Backend không cộng các snapshot trong cùng phiên. Có thể bổ sung thống kê góc/event/rung theo schema mở rộng nhưng phải giữ quy ước và đơn vị.

## Event và receipt

Event có `message_id`, `event_id`, `event_seq`, `type:posture/reminder/prolonged/data_gap`, `metric`, `started_at_mono_us`, `ended_at_mono_us:null/integer`, `duration_ms`, `peak_deg` (0–180), `vibrated`, `notification_requested`. Mỗi revision mới có message ID mới; retry revision giữ ID/nội dung. Revision cũ được receipt sau lưu dấu vết nhưng không thay bản mới. Event đã đóng không được mở lại; onset bất biến, duration/peak không giảm. Gap đóng event; khi hồi phục tạo event mới.

Receipt gồm `schema_version/device_id/boot_id/session_id/message_id`, `status:stored`, `stored_at_ms`. Backend gửi sau ghi bền thành công bằng khóa xác định; lỗi storage không receipt. Mất receipt thì thiết bị retry. Outbox firmware phải riêng với queue telemetry; giới hạn RAM và mất dữ liệu qua reboot cần công bố.

Tài liệu chính thức đối chiếu: [MQTT.js](https://github.com/mqttjs/MQTT.js), [Mosquitto auth/ACL](https://mosquitto.org/man/mosquitto-conf-5.html). Phần ID, session, ACK và receipt là giao thức ứng dụng của dự án.
