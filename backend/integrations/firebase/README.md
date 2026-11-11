# Persistence

`store.js` có FileStore cho local và FirebaseStore dùng Firebase Admin SDK. STORE_DRIVER chọn adapter; runtime không tự fallback từ Firebase lỗi sang file. Các bản ghi dùng khóa xác định, multi-location update và receipt sau ghi bền. Marker `__spt_type__` bảo toàn JSON null/collection rỗng trong RTDB, được giải mã trước API.

`firebase.json`/`database.rules.json` phục vụ database đồ án/emulator; rules không cho frontend truy cập trực tiếp. Hướng dẫn tài khoản, ADC, emulator và kiểm thử: [setup](../../../docs/setup.md).
