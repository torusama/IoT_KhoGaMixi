# MQTT v2

`transport.js` dùng MQTT.js, reconnect và publish timeout; `protocol.js` kiểm tra envelope, chất lượng/relative, summary accounting và event. `examples/` chứa message mẫu. Chỉ state được retained; command/receipt dùng QoS 1 từ backend, summary/event của firmware dùng QoS 0 kèm receipt ứng dụng.

Xem [contract đầy đủ](../../../docs/mqtt-contract.md). Firmware cũ chưa đủ v2; dùng simulator để phát triển backend trước.
