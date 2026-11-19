# F06.2 — Dashboard 2.0 (bản thử nghiệm)

Dashboard có hai chế độ chạy local. `npm run demo` dùng dữ liệu tạo trong giao diện. `npm run connected` đọc góc, mốc, trạng thái phiên và lịch sử từ backend đang chạy với simulator MQTT v2. Cả hai bind localhost. Xem [các bước chạy và bàn giao F04/F05](../../docs/F02.2-F03-ban-giao.md).

Để nối ESP32, đọc [đấu mạch/nạp firmware](../../hardware/README.md) và [tích hợp MQTT v2](../../docs/device-integration.md). Firmware hiện cần cập nhật auth và schema v2.

## Giao diện theo dõi

Tổng quan ưu tiên hình minh họa nhìn từ bên hông, đường lưng và bốn điểm đo; rê chuột hoặc đặt focus vào từng dòng cảm biến để đánh dấu vị trí tương ứng. Các thẻ thời gian phiên, thời gian hợp lệ, cảm biến và mốc lấy từ state hiện có. Chọn Gần thẳng/C/S ngay dưới hình, lưu mốc cá nhân và bật/tắt đường so sánh; bắt đầu/kết thúc phiên và nhắc rung vẫn chờ xác nhận lệnh mô phỏng. Các kịch bản lỗi/ACK nằm trong phần **Tùy chọn trải nghiệm**. Menu và giao diện Nhật ký/Tiến trình/Cài đặt dùng tiếng Việt và cùng hệ màu.

Hình thân người là minh họa định hướng; đường cong và marker dùng tọa độ core F02.1. ViewBox giữ tỷ lệ 1:1, dữ liệu lỗi xóa đường hiện tại. Tất cả được gắn nhãn Simulation; thiết kế mới không biến bản mô phỏng thành kết nối thiết bị thật. Xem [giải thích code từng bước](../../docs/F02.1-giai-thich.md) để đọc phần đo góc, góc tương đối, dựng cung và vẽ SVG.

## Chạy demo

Yêu cầu Node.js >= 22.9; package cố định Node-RED 5.0.9 và FlowFuse Dashboard 1.36.1. Trong PowerShell, từ thư mục này:

```powershell
npm ci
npm run demo
```

Mở http://127.0.0.1:1881/spt/dashboard. Các trang khác: `/spt/history`, `/spt/progress`, `/spt/settings`. `SPT_PORT` đổi cổng (mặc định 1881, backend dùng 1880). Dừng bằng Ctrl+C. `npm test` chạy unit test; `npm run build` tạo lại flow từ `model.js` và `widget.vue`. Không sửa JSON sinh ra mà không cập nhật nguồn. Runtime dùng flow trực tiếp, không cần import. Có thể import JSON vào một Node-RED đã cài Dashboard 2.0 bằng editor; kiểm tra xung đột `/spt`, link và bảo vệ truy cập trước deploy. Cài package trong user directory của Node-RED đích. Dashboard 1.0 không bị thay thế.

`SPT_MODE=demo` là lựa chọn tường minh; mặc định là `production`, không sinh telemetry hay ACK mô phỏng. Thay đổi mode cần khởi động lại runtime. Dữ liệu demo chỉ ở bộ nhớ Node-RED, bao gồm bảy phiên minh họa, sẽ mất khi khởi động lại. Điều khiển kịch bản ở Dashboard: gần thẳng, C, S, thiếu cảm biến, ngắt kết nối; tùy chọn ACK thành công, từ chối hoặc timeout. Lưu mốc khi dữ liệu hợp lệ và phiên idle. Đường cong demo dùng core F02.1 tại `shared/geometry/spine2d.js` qua build nhúng vào widget; giữ góc nghiêng tuyệt đối, wrap ±180°, ngưỡng gần thẳng thử nghiệm 0.3° và SVG fit tỷ lệ X:Y=1:1. Đây vẫn là dữ liệu Simulation; production chưa được nối. Timeline chỉ giữ 120 mẫu gần nhất, và phân bố của phiên demo chỉ dựa trên phần mẫu còn giữ, không đại diện cho toàn bộ phiên dài.

History demo có biểu đồ mẫu, tổng hợp góc, sự kiện và ghi chú. Progress demo có ví dụ độc lập cho phiên/ngày/7 ngày và phản hồi sau rung. Settings demo có ngưỡng, email và Writing Mode. Quy trình lấy mốc có kiểm tra đủ bốn kênh và độ ổn định nằm trong chế độ `connected`.

## Bàn giao tích hợp

Chế độ `connected` chạy adapter [backend-adapter.js](backend-adapter.js) trong Node-RED của dashboard. Adapter đọc REST, theo dõi mã lệnh, tải từng trang lịch sử và giữ token phía máy chủ. Các phần tích hợp qua link F06.1 bên dưới dành cho môi trường triển khai riêng.

Giao diện dùng `styles.css` làm bộ style chung. Font Be Vietnam Pro được lưu trong `fonts/` theo SIL Open Font License (`fonts/OFL.txt`); build nhúng font vào một `ui-template` CSS dùng chung, nên không cần truy cập Google Fonts khi chạy. Chỉnh giao diện trong `widget.vue` và `styles.css`, sau đó chạy `npm run build` và khởi động lại runtime để nạp flow mới.

Flow có link `F06.1 normalized events and ACK` vào state machine và `F06.1 command adapter OUT` cho lệnh. **Các link chưa kết nối adapter thực.** Backend hiện tại dùng REST/SSE có Bearer token, không phải link events, nên cần adapter phía server có xác thực và tải lại dữ liệu. Không đặt token trong widget. Tham khảo [API](../../docs/api.md), [MQTT v2](../../docs/mqtt-contract.md) và [backend Node-RED](../../backend/node-red/README.md). Những mapping sau là yêu cầu để hoàn thiện, không phải mapping đã chạy:

- `START_SESSION` → `START` với mode, `STOP_SESSION` → `STOP` kèm session_id do backend cấp; `SAVE_REFERENCE` → `SET_REFERENCE` với guided_confirmation; `SET_REMINDER` → `SET_REMINDER`; `TEST_VIBRATION` → `TEST_VIBRATION`. Backend dùng `command_id` tương ứng requestId, trả HTTP 202 trước khi thiết bị thực thi. Chỉ `applied` hoặc state được backend đối chiếu mới xác nhận; `accepted` chưa đủ, `unknown` không có nghĩa thất bại. Đối chiếu command_id, device_id và session_id. Backend hiện cho một lệnh pending/device.
- Telemetry v2 dùng `pitch_deg[4]`, `relative_deg[3]`, `sensor_quality[4]`, `ts_unix_ms`/`received_at_ms`; relative được wrap [-180,180). Cần xác thực identity, timestamp, freshness, chất lượng từng sensor và session trước khi cấp state. Không điền 0 khi thiếu. Source hiện chưa có normalizer production hoàn chỉnh.
- [F02.1](../../docs/F02.1.md) đã có core, adapter `reconstructF01Frame` và converter xuất `curve.order`, `nodes_mm`, `kappa_per_mm` theo P4→P1. Frontend đã dùng core cho demo; **chưa có adapter vẽ geometry production**. F06.1 phải xác nhận identity/session/freshness/đồng bộ và quy ước Pitch trước khi cấp frame; không suy ra synchronized từ curve_valid hoặc một timestamp tổng.
- History cần GET `/sessions`, `/sessions/:id`, `/keyframes`, `/events`, `/summaries` và `/devices/:id/references`; backend trả summary cộng dồn, không cộng các snapshot. `histogram_ms` tổng bằng `valid_metric_ms`, không tính gap. File store không phải cloud; Firebase cần cấu hình riêng.
- Progress cần F04 hoặc dữ liệu `/reports/daily` đã được nhóm xác nhận: thời gian hợp lệ, số phiên/sự kiện/rung, tỷ lệ vượt ngưỡng, sự kiện/giờ và xu hướng góc. Progress hiển thị biểu đồ và số liệu minh họa cố định trong demo; production báo chưa có dữ liệu.
- Backend hiện không có API chỉnh khoảng cách, calibration, ngưỡng/hysteresis, cooldown hoặc email preferences. Các trường này chỉ chỉnh được trong demo và không được gửi tới thiết bị thật. Chờ giao thức và validation của Hiển/Hoàng/F07; không tự ghi đè firmware hay F04.

ACK nội bộ của flow nhận `{kind:'ack',requestId,deviceId,commandType,sessionId,status:'applied'|'rejected',reason}`. `sessionId` phải khớp với lệnh STOP; START cần adapter chuyển session ID backend cấp. Timeout production khóa thao tác tiếp theo trong state (`unknown`) và cần thêm cơ chế đồng bộ trạng thái có thẩm quyền để giải tỏa. Không nối production trước khi hoàn thành adapter, xác thực và kiểm thử.

## Kiểm thử và giới hạn

`npm test` kiểm tra góc tương đối, khoảng thiếu dữ liệu, ACK và các kịch bản demo. `npm run test:browser` dùng Chrome headless, mặc định với dashboard đang chạy `npm run demo`. Để kiểm tra qua backend, chạy stack `connected` với simulator `exercise`, đặt `SPT_DASHBOARD_MODE=connected` rồi chạy cùng lệnh. Có thể đặt `CHROME_PATH` hoặc `SPT_DASHBOARD_ORIGIN`. Ảnh kiểm tra lưu ở `.runtime/dashboard-review/` tại root.

## Công cụ kiểm chứng F02.1

Từ root repository: `node frontend/geometry-demo/serve.js`, mở http://127.0.0.1:1882/frontend/geometry-demo/. Demo độc lập có chọn Straight/C/S, chỉnh bốn góc/ba chiều dài, R/κ, trạng thái lỗi và JSON. Chạy T04 bằng `node --test tests/geometry/*.test.js`; xem [báo cáo](../../docs/F02.1-report.md). Khi sửa core, chạy lại `npm run build` ở thư mục dashboard để cập nhật flow được giao.
