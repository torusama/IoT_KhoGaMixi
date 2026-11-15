# MQTT v2

`transport.js` dùng MQTT.js, reconnect và publish timeout; `protocol.js` kiểm tra envelope, chất lượng/relative, summary accounting và event. `examples/` chứa message mẫu. Chỉ state được retained; command/receipt dùng QoS 1 từ backend, summary/event của firmware dùng QoS 0 kèm receipt ứng dụng.

Xem [contract đầy đủ](../../../docs/mqtt-contract.md). Firmware cũ chưa đủ v2; dùng simulator để phát triển backend trước.

`MqttTransport` subscribe `posture/+/{state,ack,data,summary,event}` rồi đưa message qua các node MQTT ingress và `PostureService.ingest()`. Validator từ chối JSON firmware hiện tại vì chưa có schema_version=2; sau schema còn phải khớp state/boot/session/revision. Lệnh backend đi `/cmd`, xác nhận lưu summary/event đi `/receipt`.

Đấu mạch: [hardware README](../../../hardware/README.md). Auth, listener LAN, đối chiếu JSON legacy/v2, API kiểm tra và adapter dashboard: [hướng dẫn tích hợp](../../../docs/device-integration.md). `mosquitto-config.js` chỉ sinh credential file/ACL; broker mặc định và Compose đều chỉ mở host loopback. Không coi MQTT connected là đã nhận được dữ liệu phần cứng hợp lệ.
