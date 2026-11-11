# Node-RED runtime

Chạy `npm start` từ backend sau `npm ci` và `npm run configure`. `settings.js` nạp config từ environment, `nodesDir` trỏ tới custom nodes trong `nodes/`, và `flowFile` trỏ tới `flows.json`. Không cần import thủ công cho lần chạy đầu.

Flow gồm MQTT ingress → validate/reconcile/persist → diagnostic metadata; inject mỗi giây → retry/stale; HTTP GET/POST → REST/SSE node. Config node sở hữu service/store/transport; chỉ giữ một config instance cho bộ thiết bị này. `api.js` xử lý route, settings middleware áp dụng Bearer auth/CORS cho HTTP nodes.

Editor mặc định tắt; khi bật local, mở `/editor`. Các credential không nằm trong flow export. Xem [setup](../../docs/setup.md) và [API](../../docs/api.md).
