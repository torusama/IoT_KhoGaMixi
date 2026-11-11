# Backend logic

`service.js` điều phối command/session, ACK/state, lưu summary/event và cung cấp history/report. `errors.js` và `timeout.js` là helper dùng chung. ESP32 giữ vai trò tính góc, ba cung và thống kê trong phiên; backend không chạy lại bộ phát hiện tư thế từ telemetry.

Xem [kiến trúc](../../docs/architecture.md), [API](../../docs/api.md) và [MQTT](../../docs/mqtt-contract.md).
