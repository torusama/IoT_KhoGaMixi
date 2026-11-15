# Frontend

Bản thử nghiệm Node-RED Dashboard 2.0 nằm trong [dashboard](dashboard/README.md). Demo chạy độc lập và được đánh dấu rõ; tích hợp production với backend REST/SSE, geometry production và thống kê F04 chưa hoàn thành. `assets/js/posture-api.js` là client REST/SSE có sẵn. Xem [API](../docs/api.md) cho contract và trạng thái lệnh.

Core [F02.1](../docs/F02.1.md) đã dùng chung cho đường cong demo dashboard và simulator. Developer demo độc lập nằm ở `geometry-demo/`: từ root chạy `node frontend/geometry-demo/serve.js`, mở http://127.0.0.1:1882/frontend/geometry-demo/ (Simulation).

Nối mạch thật bắt đầu tại [hardware README](../hardware/README.md), sau đó làm theo [hướng dẫn tích hợp](../docs/device-integration.md). Firmware hiện publish MQTT legacy, backend chỉ nhận v2, dashboard vẫn thiếu adapter REST/SSE production. Có client `posture-api.js` không đồng nghĩa dashboard đã tự sử dụng nó.
