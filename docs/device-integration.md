# Tích hợp ESP32 với backend v2

Backend và simulator đã thực thi [MQTT contract](mqtt-contract.md). Firmware đang có trong `hardware/firmware/` vẫn chỉ truyền pitch/relative/status và START/STOP/CONFIG cơ bản; chưa tương thích v2. Công việc backend này không thay firmware cảm biến, hiệu chuẩn hoặc driver motor.

## Checklist cho firmware

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

## Trình tự thử trước phần cứng

Chạy broker, Node-RED, simulator theo setup. Gửi SET_REFERENCE → chờ applied/config → START mode reference → đọc data/summary → tắt nhắc/thử rung mô phỏng → STOP → nhận final/receipt → tải lại lịch sử. Sau đó thay simulator bằng firmware v2 có cùng device ID/credential và chạy lại checklist trên phần cứng thật.

Không chạy simulator và ESP32 cùng client ID đồng thời: broker sẽ thay kết nối cũ. Simulator gắn simulated:true, không dùng kết quả của nó làm bằng chứng độ chính xác cảm biến hoặc motor vật lý.
