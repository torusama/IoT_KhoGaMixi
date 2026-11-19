<template>
<div class="spt" v-if="s">
  <div class="page-topline"><span class="brand-caption"><i class="brand-dot"></i> SMART POSTURE TRACKER</span><span class="banner" :class="{prod:!s.simulated && s.mode!=='demo'}">{{s.mode==='demo'?'Demo giao diện':s.simulated?'Dữ liệu mô phỏng qua MQTT':s.mode==='connected'?'Dữ liệu qua MQTT':'Chưa kết nối thiết bị'}}</span></div>
  <div class="heading"><div><span class="eyebrow">{{page==='Dashboard'?'KHÔNG GIAN THEO DÕI CỦA BẠN':'GÓC NHÌN CÁ NHÂN'}}</span><h1>{{title}}</h1><p class="page-description">{{page==='Dashboard'?'Hiểu chuyển động của lưng. Theo dõi từng thay đổi nhỏ.':page==='History'?'Nhìn lại các phiên theo dõi và ghi chú của bạn.':page==='Progress'?'Quan sát thay đổi theo thời gian, trong cùng điều kiện đo.':'Thiết lập cảm biến và những lời nhắc phù hợp với bạn.'}}</p></div><div class="heading-date"><span>{{date(s.updated || Date.now()).split(',')[0]}}</span><span class="connection-pill" :class="{offline:s.connection!=='online'}"><i></i>{{s.mode==='demo'?'Thiết bị mô phỏng':s.connection==='online'?'Thiết bị đã kết nối':'Đang chờ thiết bị'}}</span></div></div>
  <div v-if="s.error" class="alert" role="alert">{{s.error}}</div><div v-if="s.notice" class="notice">{{s.notice}}</div>
  <template v-if="page==='Dashboard'">
    <div class="overview-metrics">
      <div class="overview-metric"><span class="overview-icon mint">◷</span><div><small>Thời gian phiên</small><strong>{{s.session==='active'?clockTime(Date.now()-s.started):'00:00'}}</strong><span>{{s.session==='active'?'Phiên đang diễn ra':'Sẵn sàng khi bạn bắt đầu'}}</span></div></div>
      <div class="overview-metric"><span class="overview-icon lilac">✓</span><div><small>Thời gian đo hợp lệ</small><strong>{{clockTime(s.validMs)}}</strong><span>Không tính khoảng mất dữ liệu</span></div></div>
      <div class="overview-metric"><span class="overview-icon peach">⌁</span><div><small>Cảm biến sẵn sàng</small><strong>{{(s.sensorStatus || []).filter(status=>status==='ok').length}} <em>/ 4</em></strong><span>Bốn vị trí dọc theo lưng</span></div></div>
      <div class="overview-metric"><span class="overview-icon sand">♧</span><div><small>Mốc cá nhân</small><strong class="metric-word">{{s.reference?'Đã thiết lập':'Chưa thiết lập'}}</strong><span>{{s.reference?'Có thể so sánh với mốc':'Lưu mốc trước khi so sánh'}}</span></div></div>
    </div>
    <div class="dashboard-layout">
      <div class="dashboard-main">
        <div class="card curve"><div class="card-heading"><div><span class="eyebrow">MỘT GÓC NHÌN VỀ TƯ THẾ</span><h2>Lưng của bạn lúc này</h2><p>Bốn điểm đo. Một đường lưng liền mạch.</p></div><span class="data-badge" :class="{unavailable:!s.valid}"><i></i>{{s.valid?'Đủ dữ liệu':'Thiếu dữ liệu'}}</span></div>
          <div class="curve-toolbar"><div class="curve-legend"><span><i class="legend-line"></i> Hiện tại</span><span v-if="s.reference"><i class="legend-line reference"></i> Mốc của bạn</span></div><label class="reference-toggle"><input type="checkbox" v-model="showReference" :disabled="!s.reference"> So với mốc cá nhân</label></div>
          <div class="curve-stage">
            <div v-if="!curve" class="empty curve-empty"><span class="empty-symbol">⌁</span><h3>{{s.connection==='offline'?'Chưa có kết nối':'Đang chờ đủ bốn cảm biến'}}</h3><p>Đường lưng sẽ xuất hiện khi dữ liệu hợp lệ.<br>Bạn vẫn có thể xem riêng các cảm biến đang hoạt động.</p></div>
            <template v-else>
              <div class="view-caption"><span class="view-dot"></span> GÓC NHÌN BÊN HÔNG</div>
              <svg v-bind="{viewBox:curve.viewBox}" preserveAspectRatio="xMidYMid meet" aria-label="Minh họa bề mặt lưng nhìn từ bên hông, bốn cảm biến P4 đến P1">
                <path :d="curve.bodyPath" class="body-silhouette" aria-hidden="true"/>
                <ellipse :cx="curve.head.x" :cy="curve.head.y" :rx="curve.head.radiusX" :ry="curve.head.radiusY" class="body-head" aria-hidden="true"/>
                <path :d="curve.shoulderPath" class="body-detail" aria-hidden="true"/>
                <line :x1="curve.points[0][0]" :y1="curve.points[3][1]-12" :x2="curve.points[0][0]" :y2="curve.points[0][1]+12" class="vertical-reference"/>
                <path v-if="showReference && refCurve" :d="refCurve.path" class="refline"/>
                <path :d="curve.path" class="livepath"/>
                <g v-for="(point,index) in curve.points" :key="index" class="sensor-marker" :class="{highlighted:activeSensor===3-index}" @mouseenter="activeSensor=3-index" @mouseleave="activeSensor=null">
                  <circle :cx="point[0]" :cy="point[1]" r="6" class="sensor-halo"/><circle :cx="point[0]" :cy="point[1]" r="2.6" class="sensor-dot"/>
                  <line :x1="point[0]-10" :y1="point[1]" :x2="curve.labelX+8" :y2="point[1]" class="sensor-leader"/>
                  <text :x="curve.labelX" :y="point[1]-3" text-anchor="end" class="sensor-name">{{['Lưng dưới','Giữa dưới','Giữa trên','Lưng trên'][index]}}</text>
                  <text :x="curve.labelX" :y="point[1]+8" text-anchor="end" class="sensor-angle">P{{4-index}} · {{fmt(s.pitch[3-index])}}°</text>
                </g>
              </svg>
              <div class="view-orientation">Sau <span>⟶</span> Trước cơ thể</div>
            </template>
          </div>
          <div class="curve-footer"><span><i></i> Minh họa từ dữ liệu mô phỏng</span><span>Không dùng để chẩn đoán y khoa</span></div>
          <div v-if="s.mode==='demo'" class="posture-presets"><span>Khám phá chuyển động</span><div class="preset-buttons"><button v-for="scenario in scenarios.slice(0,3)" :key="scenario[0]" class="preset-button" :class="{active:s.scenario===scenario[0]}" :aria-pressed="s.scenario===scenario[0]" @click="dispatch({kind:'scenario',value:scenario[0]})"><svg viewBox="0 0 24 30" aria-hidden="true"><circle cx="13" cy="5" r="3"/><path :d="scenario[0]==='straight'?'M12 12 L12 26':scenario[0]==='c'?'M15 12 Q7 16 12 26':'M14 12 C4 16 19 21 10 26'"/></svg>{{scenario[1]}}</button></div></div>
        </div>
        <div class="card signal-card"><div class="card-heading"><div><span class="eyebrow">NHỮNG THAY ĐỔI NHỎ</span><h2>Chuyển động gần đây</h2></div><span class="chart-period">120 mẫu gần nhất</span></div><div class="series"><label v-for="(name,index) in names" :key="name" :style="{'--series-color':colors[index]}"><input type="checkbox" v-model="selected" :value="index"> {{name}}</label></div><div class="plot-wrap"><span class="plot-unit">Góc nghiêng (°)</span><div class="signal-chart"><div class="y-labels" aria-hidden="true"><span>30°</span><span>0°</span><span>−30°</span></div><svg class="timeline" viewBox="0 0 600 180" preserveAspectRatio="none" aria-label="Diễn biến các góc theo thời gian"><line v-for="lineY in [30,60,90,120,150]" :key="lineY" x1="0" :y1="lineY" x2="600" :y2="lineY" stroke="#e4e8ee" stroke-width="1"/><path v-for="index in selected" :key="index" :d="timeline(index)" fill="none" :stroke="colors[index]" stroke-width="2"/></svg></div><div class="chart-axis"><span>{{timeLabel(s.samples?.[0]?.t)}}</span><span>{{timeLabel(s.samples?.[s.samples.length-1]?.t)}}</span></div></div><p class="muted">Khoảng trống trên biểu đồ là lúc dữ liệu chưa hợp lệ.</p></div>
      </div>
      <div class="dashboard-side">
        <div class="card session-panel"><span class="eyebrow">DÀNH THỜI GIAN CHO BẠN</span><div class="session-panel-title"><h2>{{s.session==='active'?'Bạn đang theo dõi':'Bắt đầu một phiên mới'}}</h2><span class="session-state" :class="{running:s.session==='active'}">{{s.pending?.status==='unknown'?'Chưa xác định':s.pending?'Chờ xác nhận':s.session==='active'?'Đang đo':'Sẵn sàng'}}</span></div><p>Kiểm tra cảm biến và bắt đầu khi bạn sẵn sàng.</p>
          <label v-if="s.mode==='connected' && s.session==='idle' && s.referenceReady"><input type="checkbox" v-model="useReference" :disabled="!!s.pending"> So với mốc cá nhân trong phiên</label>
          <div class="session-big-clock">{{s.session==='active'?clockTime(Date.now()-s.started):'00:00'}}</div>
          <button v-if="s.session!=='active'" class="start-session" @click="startSession" :disabled="!!s.pending || s.session!=='idle' || !s.valid || s.connection!=='online'"><span>▶</span> {{s.pending?'Đang chờ xác nhận…':'Bắt đầu theo dõi'}} <span>↗</span></button>
          <button v-else class="start-session stop-session" @click="command('STOP_SESSION')" :disabled="!!s.pending || s.connection!=='online'"><span>■</span> {{s.pending?'Đang kết thúc…':'Kết thúc phiên'}}</button>
          <p class="session-caption">{{s.mode==='demo'?'Phiên trải nghiệm trong bộ nhớ':'Trạng thái phiên theo xác nhận của thiết bị'}}</p>
        </div>
        <div class="card angles-panel"><div class="card-heading"><div><span class="eyebrow">BỐN ĐIỂM KẾT NỐI</span><h2>Từng vùng lưng</h2></div><span class="muted">Góc nghiêng · °</span></div><div class="sensor-readings"><button class="sensor-reading" v-for="(name,index) in ['Lưng trên','Giữa trên','Giữa dưới','Lưng dưới']" :key="name" :class="{selected:activeSensor===index,unavailable:s.sensorStatus?.[index]!=='ok'}" @mouseenter="activeSensor=index" @mouseleave="activeSensor=null" @focus="activeSensor=index" @blur="activeSensor=null"><span class="sensor-number" :style="{'--sensor-color':colors[index]}">P{{index+1}}</span><span class="sensor-reading-name"><b>{{name}}</b><small>{{s.sensorStatus?.[index]==='ok'?'Có dữ liệu':'Chưa có dữ liệu'}}</small></span><strong>{{finite(s.pitch?.[index])?fmt(s.pitch[index])+'°':'—'}}</strong></button></div><details class="relative-details"><summary>Góc giữa hai vùng lưng <span>⌄</span></summary><div class="relative-tiles"><div v-for="(name,index) in ['Trên − giữa trên','Giữa trên − giữa dưới','Giữa dưới − dưới']" :key="name"><small>{{name}}</small><strong>{{finite(s.relative?.[index])?fmt(s.relative[index])+'°':'—'}}</strong></div></div><p>Góc của cảm biến phía trên trừ góc cảm biến phía dưới.</p></details><div class="sensor-updated">Cập nhật {{timeLabel(s.updated)}} <span>•</span> {{s.mode==='demo'?'Mô phỏng':'Thiết bị'}}</div></div>
        <div class="card reference-panel"><span class="eyebrow">MỘT ĐIỂM ĐỂ SO SÁNH</span><h2>Mốc của riêng bạn</h2><p>{{s.reference?'Mốc đã được lưu. Bật so sánh để xem thay đổi trên đường lưng.':'Lưu tư thế hiện tại làm mốc để quan sát thay đổi trong những lần đo sau.'}}</p>
          <div v-if="s.mode==='connected'" class="info-row"><span>Độ lệch Pitch P1 so với mốc</span><b>{{degrees(s.deviation?.value_deg)}}</b></div>
          <a v-if="s.mode==='connected'" class="text-button" href="./settings">{{s.reference?'Xem và đổi mốc cá nhân':'Thiết lập mốc cá nhân'}} →</a>
          <button v-else class="secondary" @click="command('SAVE_REFERENCE')" :disabled="!!s.pending || !s.valid || s.session!=='idle'">{{s.reference?'Đặt lại mốc cá nhân':'＋ Lưu mốc cá nhân'}}</button>
          <small v-if="s.session==='active'">Kết thúc phiên để thay đổi mốc.</small>
        </div>
        <div v-if="s.mode==='demo'" class="card reminder-panel"><div class="card-heading"><div><span class="eyebrow">MỘT LỜI NHẮC NHẸ</span><h2>Nhắc rung</h2></div><button class="toggle-switch" role="switch" :aria-checked="s.reminder" :aria-label="s.reminder?'Tắt nhắc rung':'Bật nhắc rung'" :class="{enabled:s.reminder}" @click="command('SET_REMINDER',{enabled:!s.reminder})" :disabled="!!s.pending || s.connection!=='online'"><span></span></button></div><p>{{s.reminder?'Lời nhắc đang bật trong bản mô phỏng.':'Bật lời nhắc để trải nghiệm tính năng nhắc thay đổi tư thế.'}}</p><div class="reminder-details"><div><small>Ngưỡng mô phỏng</small><b>{{s.demoSettings?.trigger ?? '—'}}°</b></div><div><small>Thời gian duy trì</small><b>{{s.demoSettings?.hold ?? '—'}} giây</b></div></div><button class="text-button" @click="command('TEST_VIBRATION')" :disabled="!!s.pending || s.connection!=='online'">Thử nhắc rung <span>↗</span></button></div>
      </div>
    </div>
    <details v-if="s.mode==='demo'" class="simulation-tools"><summary>Tùy chọn trải nghiệm <span>Thử mất cảm biến, mất kết nối hoặc phản hồi lệnh</span></summary><div class="actions"><button class="secondary" v-for="scenario in scenarios.slice(3)" :key="scenario[0]" @click="dispatch({kind:'scenario',value:scenario[0]})">{{scenario[1]}}</button><button class="secondary" @click="dispatch({kind:'scenario',value:'straight'})">Khôi phục dữ liệu</button></div><label>Phản hồi lệnh mô phỏng <select :value="s.ackMode" @change="dispatch({kind:'ackMode',value:$event.target.value})"><option value="success">Thành công</option><option value="rejected">Bị từ chối</option><option value="timeout">Không phản hồi</option></select></label></details>
  </template>
  <template v-if="page==='History'">
    <div class="section"><div><span class="eyebrow">NHẬT KÝ PHIÊN ĐO</span><h2>Nhìn lại các phiên của bạn</h2></div><span class="muted">{{filtered.length}} phiên</span></div>
    <div class="card history-list"><div class="section compact"><div><h2>Danh sách phiên</h2><p>Chọn một phiên để xem chi tiết và dữ liệu đã ghi.</p></div><div class="actions"><label>Từ ngày <input type="date" v-model="from"></label><label>Đến ngày <input type="date" v-model="to"></label></div></div>
      <div v-if="!filtered.length" class="empty">Chưa có phiên trong khoảng thời gian này.</div>
      <button v-for="h in filtered" :key="h.id" class="history-row" :class="{active:chosenId===h.id}" @click="chooseSession(h)"><span class="session-icon">↗</span><span class="session-main"><b>{{h.id}}</b><small>{{date(h.started)}} <span v-if="h.simulated">· Mô phỏng</span></small></span><span class="session-time">{{duration(elapsed(h))}}<small>Thời gian phiên</small></span><span class="session-time">{{duration(h.validMs)}}<small>Dữ liệu hợp lệ</small></span><span class="session-link">Xem chi tiết →</span></button>
      <div v-if="s.mode==='connected'" class="actions">
        <button class="secondary" @click="dispatch({kind:'historyRefresh',id:chosenId})">Làm mới lịch sử</button>
        <button v-if="s.historyCursor" class="secondary" @click="dispatch({kind:'historyMore'})">Tải phiên cũ hơn</button>
      </div>
    </div>
    <p v-if="chosenId && !chosen" role="status">Đang tải chi tiết phiên…</p>
    <template v-if="chosen"><div class="section"><div><span class="eyebrow">CHI TIẾT PHIÊN</span><h2>{{chosen.id}}</h2><p class="muted">{{date(chosen.started)}} — {{date(chosen.ended)}}</p></div><span class="status-pill">{{chosen.status || 'Đã kết thúc'}}</span></div>
      <p v-if="s.mode==='connected'">Dữ liệu phiên: {{chosen.saved?'Đã lưu bản tổng hợp cuối':'Chưa có bản tổng hợp cuối'}}</p>
      <div class="grid metrics"><div class="card"><small>Thời gian phiên</small><strong>{{duration(elapsed(chosen))}}</strong></div><div class="card"><small>Đo hợp lệ</small><strong>{{duration(chosen.validMs)}}</strong></div><div v-if="s.mode==='connected'" class="card"><small>Thiếu dữ liệu</small><strong>{{duration(chosen.invalidMs)}}</strong></div><div class="card"><small>Sự kiện vượt ngưỡng</small><strong>{{chosen.events ?? '—'}}</strong><p v-if="chosen.deviationStats">Ngưỡng {{degrees(chosen.deviationStats.threshold_deg)}}</p></div><div v-if="s.mode==='demo'" class="card"><small>Nhắc rung</small><strong>{{chosen.vibrations || 0}}</strong><p>Số lần mô phỏng</p></div></div>
      <div class="grid two"><div class="card"><h2>Diễn biến góc trong phiên</h2><p>Pitch bốn cảm biến · dữ liệu đã lưu</p><svg class="timeline" viewBox="0 0 600 180" preserveAspectRatio="none"><line x1="0" y1="90" x2="600" y2="90" stroke="#dbe4ea"/><path v-for="i in 4" :key="i" :d="historyLine(chosen,i-1)" fill="none" :stroke="colors[i-1]" stroke-width="2.5"/></svg><div class="legend"><span v-for="i in 4" :key="i" :style="{color:colors[i-1]}">● P{{i}}　</span></div><div class="chart-axis"><span>{{date(chosen.started)}}</span><span>{{date(chosen.ended)}}</span></div></div>
      <div class="card"><h2>Phân bố độ lệch P1</h2><p>Thời lượng có độ lệch hợp lệ · {{duration(binTotal)}}</p><div v-if="!binTotal" class="empty">Chưa có thời lượng so với mốc.</div><div v-else v-for="(b,i) in bins" :key="i" class="bin"><span>{{['0–&lt;5°','5–&lt;10°','10–&lt;15°','15–&lt;20°','20–&lt;25°','≥25°'][i]}}</span><div><i :style="{width:(100*b/binTotal)+'%'}"></i></div><span>{{(b/60000).toFixed(2)}} phút · {{(100*b/binTotal).toFixed(1)}}%</span></div><p class="muted">Các nhóm góc chỉ để quan sát, không phải đánh giá y khoa.</p></div></div>
      <div v-if="chosen.cursors?.samples" class="actions"><button class="secondary" @click="loadOlder('samples')">Tải mẫu góc cũ hơn</button></div>
      <div v-if="s.mode==='connected'" class="card"><h2>Thống kê góc</h2><p>Trung bình theo thời lượng đo hợp lệ.</p><div class="grid pitch">
        <div v-for="(stat,i) in savedAngles" :key="names[i]" class="angle-summary"><small>{{names[i]}}</small><strong>{{degrees(stat?.mean_deg)}}</strong><span>Nhỏ nhất {{degrees(stat?.min_deg)}} · Lớn nhất {{degrees(stat?.max_deg)}}</span></div>
      </div></div>
      <div v-else class="card"><h2>Góc theo cảm biến</h2><p>Trung bình và lớn nhất trong các mẫu hợp lệ đã lưu.</p><div class="grid pitch"><div v-for="n in 4" :key="n" class="angle-summary"><small>P{{n}}</small><strong>{{sessionAverage(chosen,n-1)}}°</strong><span>Lớn nhất {{sessionMax(chosen,n-1)}}°</span></div></div><p>Góc tương đối trung bình: P1–P2 {{sessionRelative(chosen,0)}}° · P2–P3 {{sessionRelative(chosen,1)}}° · P3–P4 {{sessionRelative(chosen,2)}}°</p></div>
      <div class="grid two"><div class="card"><h2>Nhật ký sự kiện</h2><div v-if="!(chosen.eventLog||[]).length" class="empty">Chưa có sự kiện đã lưu.</div><div v-for="(e,i) in chosen.eventLog || []" :key="e.id ?? i" class="event-row"><b>{{e.metric}}<template v-if="finite(e.peak)"> · {{degrees(e.peak)}}</template></b><span>{{date(e.start)}} → {{e.end ? date(e.end) : 'Đang mở'}}</span><small>{{duration(e.durationMs ?? (e.end ? e.end-e.start : null))}}<template v-if="e.vibrated"> · {{s.mode==='demo'?'Đã rung demo':'Đã ghi nhận rung'}}</template></small><small v-if="e.response">{{e.response}}</small></div><button v-if="chosen.cursors?.events" class="secondary" @click="loadOlder('events')">Tải sự kiện cũ hơn</button></div>
      <div class="card"><h2>Điều kiện phiên</h2><p>{{chosen.conditions || 'Chưa có thông tin'}}</p><p v-if="chosen.deviationStats">Thời gian vượt ngưỡng: {{duration(chosen.deviationStats.above_threshold_ms)}}</p><template v-if="s.mode==='demo'"><label class="field">Ghi chú phiên <textarea v-model="noteDraft" rows="3" placeholder="Ví dụ: học trên máy tính"></textarea></label><button class="secondary" @click="dispatch({kind:'sessionNote',id:chosen.id,value:noteDraft})">Lưu ghi chú demo</button></template></div></div>
    </template>
  </template>
  <template v-if="page==='Progress'">
    <div v-if="s.mode==='demo'">
      <div class="period-tabs" aria-label="Khoảng thời gian"><button v-for="period in ['Phiên','Ngày','7 ngày']" :key="period" :class="{selected:progressPeriod===period}" @click="progressPeriod=period">{{period}}</button><span>Đang xem: {{progressPeriod}} · số liệu minh họa</span></div>
      <div class="section"><div><span class="eyebrow">{{progressPeriod.toUpperCase()}} · DỮ LIỆU MINH HỌA</span><h2>Tổng quan tiến trình</h2></div><span class="muted">Thống kê demo, chưa kết nối F04</span></div>
      <div class="grid metrics"><div class="card"><small>Thời gian hợp lệ</small><strong>{{periodSummary.time}}</strong><p>Trong khoảng đã chọn</p></div><div class="card"><small>Phiên đo</small><strong>{{periodSummary.sessions}} phiên</strong><p>Dữ liệu minh họa</p></div><div class="card"><small>Sự kiện vượt ngưỡng</small><strong>{{periodSummary.events}} sự kiện</strong><p>Theo ngưỡng cấu hình demo</p></div><div class="card"><small>Nhắc rung</small><strong>{{periodSummary.vibrations}} lần</strong><p>Giả lập trong khoảng đã chọn</p></div></div>
      <div class="grid two"><div class="card"><h2>Tỷ lệ thời gian vượt ngưỡng</h2><p>Phần trăm trên thời gian đo hợp lệ · theo ngày</p><div class="bar-chart"><div v-for="(v,i) in visibleRates" :key="i" class="bar-col"><b>{{v}}%</b><div class="bar-track"><i :style="{height:(v*3)+'%'}"></i></div><span>{{dayLabel(i+7-visibleRates.length)}}</span></div></div></div><div class="card"><h2>Sự kiện trên giờ hợp lệ</h2><p>Số lần vượt ngưỡng / giờ · dữ liệu minh họa</p><div class="bar-chart"><div v-for="(v,i) in visibleEvents" :key="i" class="bar-col"><b>{{v}}</b><div class="bar-track light"><i :style="{height:(v*12)+'%'}"></i></div><span>{{dayLabel(i+7-visibleEvents.length)}}</span></div></div></div></div>
      <div class="grid two"><div class="card"><h2>Xu hướng góc tương đối</h2><p>Góc trung bình từng vùng trong 7 ngày · độ (°)</p><svg class="timeline" viewBox="0 0 600 180" preserveAspectRatio="none"><line x1="0" y1="140" x2="600" y2="140" stroke="#cbd5e1"/><path v-for="(series,i) in demoAngles" :key="i" :d="demoLine(series)" fill="none" :stroke="colors[i]" stroke-width="3"/></svg><div class="legend"><span v-for="(name,i) in ['P1–P2','P2–P3','P3–P4']" :key="name" :style="{color:colors[i]}">● {{name}}</span></div></div><div class="card"><h2>Phân bố độ lệch so với mốc</h2><p>Tổng thời gian minh họa · không phải đánh giá y khoa</p><div v-for="(v,i) in [76,94,68,42,25,15]" :key="i" class="bin"><span>{{['0–5°','5–10°','10–15°','15–20°','20–25°','≥25°'][i]}}</span><div><i :style="{width:(v/94*100)+'%'}"></i></div><span>{{v}} phút · {{(v/320*100).toFixed(1)}}%</span></div></div></div>
      <div class="card"><h2>So sánh gần đây</h2><div class="comparison"><div><small>Hôm qua</small><strong>15%</strong><p>Thời gian vượt ngưỡng</p></div><div><small>Trung bình 7 ngày</small><strong>20%</strong><p>Thời gian vượt ngưỡng</p></div><div><small>Sự kiện / giờ</small><strong>3,6</strong><p>Trên thời gian hợp lệ</p></div></div><p class="muted">Số liệu trên chỉ để minh họa, không dùng để đánh giá sức khỏe.</p></div>
      <div class="grid two"><div class="card"><span class="eyebrow">DỮ LIỆU MINH HỌA</span><h2>Phản hồi sau rung</h2><p>Theo dõi chỉ số sau mỗi lần nhắc; chỉ đánh giá khi dữ liệu liên tục hợp lệ.</p><div class="response-stat"><strong>8 / 12</strong><span>lần quay về gần mốc<br>trong cửa sổ 60 giây</span></div><div class="info-row"><span>Chỉ số trước rung</span><b>18,4°</b></div><div class="info-row"><span>Chỉ số sau rung</span><b>7,2°</b></div><div class="info-row"><span>Mẫu bị loại</span><b>1 lần thiếu dữ liệu</b></div></div><div class="card"><span class="eyebrow">LƯU Ý KHI SO SÁNH</span><h2>Điều kiện đo</h2><p>Chỉ đối chiếu các phiên có vị trí gắn, khoảng cách, mốc và ngưỡng tương đối nhất quán.</p><div class="comparison-warning">Các chỉ số và phản hồi ở đây là ví dụ demo. Khi backend cung cấp thông tin khác biệt giữa các phiên, cảnh báo sẽ được hiển thị tại đây.</div><p>Độ bao phủ, cửa sổ phân tích và số mẫu loại cần được kiểm tra trước khi kết luận xu hướng.</p></div></div>
    </div><div v-else class="card"><h2>Xu hướng tư thế</h2><div class="empty">Chưa đủ dữ liệu phân tích xu hướng từ F04.</div></div>
  </template>
  <template v-if="page==='Settings' && s.mode==='connected'">
    <div class="grid two">
      <div class="card">
        <h2>Thiết lập mốc cá nhân</h2>
        <label class="field">Tư thế tham chiếu<select v-model="posture" :disabled="!!s.pending || s.session!=='idle'"><option value="seated">Ngồi</option><option value="standing">Đứng</option></select></label>
        <p>{{posture==='seated'?'Ngồi thoải mái, đặt hai chân vững trên sàn và thả lỏng vai.':'Đứng thoải mái, phân bố trọng lượng đều hai chân và thả lỏng vai.'}} Kiểm tra vị trí gắn cảm biến, rồi giữ yên khi bắt đầu lấy mốc.</p>
        <div class="checklist">
          <span :class="{ok:s.valid}">{{s.valid?'✓':'○'}} Bốn cảm biến có dữ liệu hợp lệ</span>
          <span :class="{ok:s.mountingConfirmed}">{{s.mountingConfirmed?'✓':'○'}} Thiết bị đã xác nhận cách lắp</span>
        </div>
        <p v-if="s.session!=='idle'">Kết thúc phiên trước khi đổi mốc.</p>
        <label><input type="checkbox" v-model="guidedConfirmation" :disabled="!!s.pending || s.session!=='idle'"> Tôi đã vào tư thế tham chiếu và sẵn sàng giữ yên.</label>
        <div class="actions"><button @click="saveReference" :disabled="!guidedConfirmation || !!s.pending || s.connection!=='online' || s.session!=='idle' || !s.mountingConfirmed">Bắt đầu lấy mốc</button></div>
        <div v-if="s.referenceCapture" role="status">
          <p>{{captureLabel}} · {{(s.referenceCapture.stable_ms/1000).toFixed(1)}} / {{(s.referenceCapture.required_ms/1000).toFixed(1)}} giây</p>
          <progress :value="s.referenceCapture.stable_ms" :max="s.referenceCapture.required_ms" aria-label="Thời gian cảm biến ổn định"></progress>
        </div>
        <p v-else-if="s.pending?.status==='unknown'" role="status">Kết quả lệnh chưa xác định. Đang đối chiếu thiết bị.</p>
      </div>
      <div class="card">
        <h2>Mốc hiện tại</h2>
        <template v-if="s.reference">
          <p>{{postureLabel(s.reference.posture)}} · {{date(s.reference.timestamp)}}<br>Phiên bản {{s.reference.reference_rev}} · Hiệu chuẩn {{s.reference.calibration_rev || '—'}}</p>
          <p v-if="!s.referenceReady">Hãy lấy lại mốc sau khi thay đổi hiệu chuẩn hoặc cách lắp.</p>
          <div class="reference-grid"><div v-for="(pitch,i) in s.reference.pitch" :key="i"><small>P{{i+1}}</small><strong>{{degrees(pitch)}}</strong></div></div>
          <p>Góc tương đối P1–P2 / P2–P3 / P3–P4: {{(s.reference.relative || []).map(value=>degrees(value)).join(' / ') || '—'}}</p>
        </template>
        <div v-else class="empty">Chưa có mốc được xác nhận.</div>
      </div>
    </div>
    <div class="card"><h2>Lịch sử đổi mốc</h2>
      <p v-if="!s.references.length">Chưa có mốc đã lưu.</p>
      <div class="event-row" v-for="reference in s.references" :key="reference.reference_rev">
        <b>{{postureLabel(reference.posture)}} · {{date(reference.timestamp)}}</b>
        <small>{{reference.reference_rev}} · Hiệu chuẩn {{reference.calibration_rev || '—'}}<template v-if="reference.simulated"> · Mô phỏng</template></small>
        <span>Pitch: {{reference.pitch.map(value=>degrees(value)).join(' / ')}}</span>
        <span v-if="reference.relative">Góc tương đối: {{reference.relative.map(value=>degrees(value)).join(' / ')}}</span>
      </div>
      <button v-if="s.referenceCursor" class="secondary" @click="dispatch({kind:'referenceMore'})">Tải mốc cũ hơn</button>
    </div>
  </template>
  <template v-if="page==='Settings' && s.mode!=='connected'"><div class="grid two"><div class="card"><span class="eyebrow">THÔNG TIN THIẾT BỊ</span><h2>Thiết bị & cảm biến</h2><div class="info-row"><span>Device ID</span><b>{{s.deviceId||'—'}}</b></div><div class="info-row"><span>Kết nối</span><b>{{s.connection}}</b></div><div class="info-row"><span>Cập nhật gần nhất</span><b>{{date(s.updated)}}</b></div><div class="info-row" v-for="n in 4" :key="n"><span>Cảm biến P{{n}}</span><b>{{s.sensorStatus?.[n-1]==='ok'?'Hoạt động':'Không có dữ liệu'}}</b></div><p class="muted">Firmware và hiệu chuẩn sẽ hiển thị khi backend cung cấp.</p></div>
  <div class="card"><span class="eyebrow">MỐC TƯ THẾ CÁ NHÂN</span><h2>Thiết lập mốc tham chiếu</h2><p>Ngồi thoải mái, đặt chân vững, thả lỏng vai và giữ yên các cảm biến. Mốc cá nhân khác với hiệu chuẩn cảm biến.</p><div class="checklist"><span :class="{ok:s.valid}">{{s.valid?'✓':'○'}} Bốn kênh có dữ liệu hợp lệ</span><span>○ Kiểm tra hướng lắp và khoảng cách trước khi lưu</span><span>○ Độ ổn định 5–10 giây: chờ dữ liệu thiết bị thật</span></div><div v-if="s.reference" class="reference-grid"><div v-for="(p,i) in s.reference.pitch" :key="i"><small>P{{i+1}}</small><strong>{{fmt(p)}}°</strong></div></div><div v-else class="empty">Chưa có mốc được xác nhận.</div><p v-if="s.reference">Góc tương đối: {{fmt(s.reference.pitch[0]-s.reference.pitch[1])}}° · {{fmt(s.reference.pitch[1]-s.reference.pitch[2])}}° · {{fmt(s.reference.pitch[2]-s.reference.pitch[3])}}°<br>Lưu lúc {{date(s.reference.timestamp)}} · {{s.reference.deviceId}}</p><p class="muted">Nếu tháo đeo lại hoặc thay đổi vị trí, hãy kiểm tra và đặt lại mốc trước khi so sánh.</p><button @click="command('SAVE_REFERENCE')" :disabled="!!s.pending || !s.valid || s.session!=='idle'">Lưu mốc cá nhân</button></div>
  <div class="card"><span class="eyebrow">THIẾT LẬP KHOẢNG CÁCH · DEMO</span><h2>Vị trí cảm biến</h2><p>Đơn vị mm. Cấu hình dưới đây chỉ ảnh hưởng mô phỏng.</p><div class="form-grid"><label v-for="(name,i) in ['d12 · P1–P2','d23 · P2–P3','d34 · P3–P4']" :key="name">{{name}}<input type="number" min="1" v-model.number="form.distances[i]" :disabled="s.mode!=='demo'"></label></div></div>
  <div class="card"><span class="eyebrow">NHẮC NHỞ</span><h2>Chế độ rung</h2><p>Trạng thái: <b>{{s.reminder?'Đang bật':'Đang tắt'}}</b></p><div class="actions"><button @click="command('SET_REMINDER',{enabled:!s.reminder})" :disabled="!!s.pending">{{s.reminder?'Tắt':'Bật'}} nhắc rung</button><button class="secondary" @click="command('TEST_VIBRATION')" :disabled="!!s.pending">Kiểm tra rung</button></div><p>Các giá trị bên dưới là cấu hình demo, chưa gửi firmware.</p><label class="field">Chỉ số theo dõi<select v-model="form.metric" :disabled="s.mode!=='demo'"><option value="p1">Độ lệch Pitch P1 so với mốc</option><option value="q12">Thay đổi góc tương đối P1–P2</option><option value="q23">Thay đổi góc tương đối P2–P3</option><option value="q34">Thay đổi góc tương đối P3–P4</option></select></label><div class="form-grid"><label>Ngưỡng kích hoạt (°)<input type="number" min="1" v-model.number="form.trigger" :disabled="s.mode!=='demo'"></label><label>Ngưỡng kết thúc (°)<input type="number" min="0" v-model.number="form.release" :disabled="s.mode!=='demo'"></label><label>Thời gian duy trì (giây)<input type="number" min="0" v-model.number="form.hold" :disabled="s.mode!=='demo'"></label><label>Cooldown (giây)<input type="number" min="0" v-model.number="form.cooldown" :disabled="s.mode!=='demo'"></label></div><div class="info-row"><span>Chế độ viết bài · tạm dừng nhắc (demo)</span><button class="secondary small-button" @click="dispatch({kind:'writingMode',value:!s.writingMode})" :disabled="s.mode!=='demo'">{{s.writingMode?'Đang bật':'Đang tắt'}}</button></div><p class="muted">Chế độ viết chỉ là trạng thái minh họa, chưa điều khiển thiết bị.</p></div>
  <div class="card"><span class="eyebrow">THÔNG BÁO · DEMO</span><h2>Thông báo email</h2><p>Chỉ lưu lựa chọn mô phỏng, không gửi email.</p><label><input type="checkbox" v-model="form.emailEnabled" :disabled="s.mode!=='demo'"> Bật thông báo email</label><div class="form-grid"><label>Địa chỉ nhận<input type="email" placeholder="ban@example.com" v-model="form.email" :disabled="s.mode!=='demo'"></label><label>Lệch kéo dài (giây)<input type="number" min="1" v-model.number="form.emailHold" :disabled="s.mode!=='demo'"></label></div><p>Trạng thái gửi: chưa kết nối dịch vụ email.</p></div><div class="card"><h2>Lưu cấu hình demo</h2><p>Các thay đổi lưu trong bộ nhớ và mất khi khởi động lại. Cấu hình thiết bị thật đang chờ backend.</p><button @click="dispatch({kind:'demoSettings',value:form})" :disabled="s.mode!=='demo'">Lưu cấu hình demo</button></div></div></template>
</div><div v-else class="spt empty">Đang tải dữ liệu…</div>
</template>
<script>
export default {
  data() {
    return {
      activeSensor: null,
      progressPeriod: '7 ngày',
      noteDraft: '',
      posture: 'seated',
      guidedConfirmation: false,
      useReference: true,
      formLoaded: false,
      form: {
        distances: [70, 70, 70], trigger: 15, release: 10, hold: 30,
        cooldown: 60, emailHold: 180, metric: 'p1', emailEnabled: false, email: ''
      },
      demoRates: [25, 23, 21, 24, 18, 15, 14],
      demoEvents: [5.2, 4.8, 4.2, 4.5, 3.5, 3.0, 2.8],
      demoAngles: [[12, 11, 10, 12, 9, 8, 7], [8, 9, 8, 7, 8, 7, 6], [6, 6, 7, 6, 5, 6, 5]],
      showReference: true,
      selected: [0, 1, 2, 3],
      from: '',
      to: '',
      chosenId: null,
      names: ['P1', 'P2', 'P3', 'P4', 'P1–P2', 'P2–P3', 'P3–P4'],
      colors: ['#328a78', '#697fc0', '#bd8b54', '#a77ca9', '#c17162', '#507f91', '#8a9560'],
      scenarios: [
        ['straight', 'Gần thẳng'], ['c', 'Cong C'], ['s', 'Cong S'],
        ['missing', 'Thiếu cảm biến'], ['disconnect', 'Mất kết nối']
      ]
    };
  },

  watch: {
    s: {
      immediate: true,
      handler(state) {
        if (!this.formLoaded && state?.demoSettings) {
          this.form = { ...state.demoSettings, distances: [...state.distances] };
          this.formLoaded = true;
        }
      }
    }
  },

  computed: {
    s() { return this.msg?.payload; },
    page() { return PAGE_NAME; },
    title() {
      return { Dashboard: 'Tư thế của bạn, mỗi ngày.', History: 'Nhật ký theo dõi', Progress: 'Tiến trình của bạn', Settings: 'Thiết lập cá nhân' }[this.page];
    },
    curve() { return this.geometry(this.s?.pitch); },
    refCurve() {
      if (this.s?.mode === 'connected' && !this.s.referenceReady) return null;
      return this.geometry(this.s?.reference?.pitch);
    },
    chosen() {
      if (!this.chosenId) return null;
      return this.s.mode === 'connected' ? this.s.historyDetails?.[this.chosenId] : this.s.history.find(session => session.id === this.chosenId);
    },
    captureLabel() {
      const labels = { waiting: 'Đang chờ mẫu', stabilizing: 'Đang kiểm tra ổn định', unstable: 'Phát hiện chuyển động, đang đếm lại',
        invalid: 'Đang chờ đủ bốn cảm biến', ready: 'Đang lưu mốc' };
      return labels[this.s.referenceCapture?.status];
    },
    savedAngles() {
      const stats = this.chosen?.angleStats;
      return stats ? [...stats.pitch, ...stats.relative] : this.names.map(() => null);
    },
    periodSummary() {
      if (this.progressPeriod === 'Phiên') return { time: '42 phút', sessions: 1, events: 2, vibrations: 1 };
      if (this.progressPeriod === 'Ngày') return { time: '1 giờ 5 phút', sessions: 2, events: 4, vibrations: 2 };
      return { time: '5 giờ 20 phút', sessions: 7, events: 19, vibrations: 12 };
    },
    visibleRates() { return this.progressPeriod === '7 ngày' ? this.demoRates : this.demoRates.slice(-1); },
    visibleEvents() { return this.progressPeriod === '7 ngày' ? this.demoEvents : this.demoEvents.slice(-1); },
    filtered() {
      return (this.s.history || []).filter(session => {
        const sessionDate = new Date(session.started).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
        return (!this.from || sessionDate >= this.from) && (!this.to || sessionDate <= this.to);
      }).sort((first, second) => second.started - first.started);
    },
    bins() {
      const histogram = [0, 0, 0, 0, 0, 0];
      const session = this.chosen;
      if (this.s.mode === 'connected') return session?.histogram ?? histogram;
      if (!session?.reference) return histogram;
      for (let index = 1; index < session.samples.length; index++) {
        const previousSample = session.samples[index - 1];
        const currentSample = session.samples[index];
        const elapsedMilliseconds = currentSample.t - previousSample.t;
        if (previousSample.pitch && currentSample.pitch && elapsedMilliseconds > 0 && elapsedMilliseconds <= 2000) {
          const deviationDegrees = Math.abs(previousSample.pitch[0] - session.reference.pitch[0]);
          const binIndex = Math.min(5, Math.floor(deviationDegrees / 5));
          histogram[binIndex] += elapsedMilliseconds;
        }
      }
      return histogram;
    },
    binTotal() { return this.bins.reduce((total, duration) => total + duration, 0); }
  },

  methods: {
    finite(value) { return Number.isFinite(value); },
    fmt(value) { return Number.isFinite(value) ? value.toFixed(1) : '—'; },
    degrees(value) { return Number.isFinite(value) ? this.fmt(value) + '°' : '—'; },
    postureLabel(value) { return { seated: 'Ngồi', standing: 'Đứng' }[value] || 'Chưa ghi tư thế'; },
    date(timestamp) {
      return timestamp ? new Date(timestamp).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—';
    },
    timeLabel(timestamp) {
      return timestamp ? new Date(timestamp).toLocaleTimeString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit'
      }) : '--:--';
    },
    duration(milliseconds) {
      if (!Number.isFinite(milliseconds)) return '—';
      const totalSeconds = Math.floor(milliseconds / 1000);
      return Math.floor(totalSeconds / 60) + ' phút ' + totalSeconds % 60 + ' giây';
    },
    elapsed(session) { return session.elapsedMs ?? (session.ended ? session.ended - session.started : null); },
    clockTime(milliseconds) {
      const totalSeconds = Math.floor(Math.max(0, milliseconds || 0) / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor(totalSeconds / 60) % 60;
      const seconds = totalSeconds % 60;
      const minuteAndSecond = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
      return hours > 0 ? String(hours).padStart(2, '0') + ':' + minuteAndSecond : minuteAndSecond;
    },
    dispatch(payload) { this.send({ payload: payload }); },
    command(commandType, payload = {}) {
      this.dispatch({ kind: 'command', command: commandType, payload: payload });
    },
    startSession() {
      this.command('START_SESSION', { mode: this.useReference && this.s.referenceReady ? 'reference' : 'measurement_only' });
    },
    saveReference() {
      this.command('SAVE_REFERENCE', { posture: this.posture, guided_confirmation: this.guidedConfirmation });
      this.guidedConfirmation = false;
    },

    // Chỉ đổi kết quả hình học sang SVG. Toàn bộ công thức dựng cung nằm ở core.
    geometry(pitchDegrees) {
      if (!['demo','connected'].includes(this.s?.mode)) return null;
      if (this.s.mode === 'connected' && !this.s.curveReady) return null;
      if (!globalThis.Spine2D) { /* F02.1_CORE */ }

      const sensorNames = ['P1', 'P2', 'P3', 'P4'];
      const distancesMillimeters = this.s.distances;
      const pitchesBySensor = {};
      const statusesBySensor = {};
      for (let sensorIndex = 0; sensorIndex < sensorNames.length; sensorIndex++) {
        const sensorName = sensorNames[sensorIndex];
        pitchesBySensor[sensorName] = pitchDegrees?.[sensorIndex];
        statusesBySensor[sensorName] = this.s.sensorStatus?.[sensorIndex] === 'ok' ? 'OK' : 'INVALID';
      }

      const result = globalThis.Spine2D.reconstructSpine2D({
        pitchDeg: pitchesBySensor,
        sensorStatus: statusesBySensor,
        distances: {
          d12: distancesMillimeters?.[0],
          d23: distancesMillimeters?.[1],
          d34: distancesMillimeters?.[2]
        },
        unit: 'mm',
        frameValid: this.s.valid === true,
        synchronized: true // Mỗi khung đã ghép bốn kênh tại thiết bị.
      });
      if (!result.valid) return null;

      // Giữ nguyên X, đảo Y vì SVG có trục Y hướng xuống màn hình.
      const points = [];
      for (const sensorName of ['P4', 'P3', 'P2', 'P1']) {
        const sensorPoint = result.points[sensorName];
        points.push([sensorPoint.x, -sensorPoint.y]);
      }
      let path = '';
      for (let pointIndex = 0; pointIndex < result.curvePoints.length; pointIndex++) {
        const point = result.curvePoints[pointIndex];
        path += (pointIndex === 0 ? 'M ' : ' L ') + point.x + ' ' + (-point.y);
      }

      // Phần thân người chỉ là minh họa nhìn từ bên hông, không phải kết quả giải phẫu.
      // Kích thước minh họa theo chiều dài đường lưng; các điểm cảm biến không bị dịch.
      const bottomPoint = points[0];
      const topPoint = points[3];
      const middlePoint = points[2];
      const bodyWidth = result.totalLength * 0.32;
      const head = {
        x: topPoint[0] + bodyWidth * 0.35,
        y: topPoint[1] - bodyWidth * 0.48,
        radiusX: bodyWidth * 0.25,
        radiusY: bodyWidth * 0.31
      };
      let bodyPath = 'M ' + (bottomPoint[0] + 5) + ' ' + (bottomPoint[1] + bodyWidth * 0.3);
      for (const point of result.curvePoints) {
        bodyPath += ' L ' + (point.x + 5) + ' ' + (-point.y);
      }
      bodyPath += ' Q ' + (topPoint[0] + 12) + ' ' + (topPoint[1] - 14) + ' ' + (topPoint[0] + 25) + ' ' + (topPoint[1] - 7);
      bodyPath += ' Q ' + (topPoint[0] + bodyWidth) + ' ' + (topPoint[1] + 8) + ' ' + (topPoint[0] + bodyWidth) + ' ' + (topPoint[1] + bodyWidth * 0.6);
      bodyPath += ' Q ' + (middlePoint[0] + bodyWidth * 0.6) + ' ' + middlePoint[1] + ' ' + (bottomPoint[0] + bodyWidth) + ' ' + (bottomPoint[1] + bodyWidth * 0.3);
      bodyPath += ' Z';
      const shoulderPath = 'M ' + (topPoint[0] + bodyWidth * 0.45) + ' ' + (topPoint[1] + 8) + ' Q ' + (topPoint[0] + bodyWidth * 0.8) + ' ' + (topPoint[1] + 25) + ' ' + (middlePoint[0] + bodyWidth * 0.65) + ' ' + middlePoint[1];

      const curveXValues = result.curvePoints.map(point => point.x);
      const curveYValues = result.curvePoints.map(point => -point.y);
      const minimumX = Math.min(...curveXValues) - bodyWidth * 1.3;
      const maximumX = Math.max(...curveXValues) + bodyWidth * 1.3;
      const minimumY = Math.min(...curveYValues) - bodyWidth;
      const maximumY = Math.max(...curveYValues) + bodyWidth * 0.5;
      // ViewBox vuông và preserveAspectRatio=meet: tỷ lệ X:Y luôn bằng 1:1.
      const viewSize = Math.max(maximumX - minimumX, maximumY - minimumY);
      const viewLeft = (minimumX + maximumX - viewSize) / 2;
      const viewTop = (minimumY + maximumY - viewSize) / 2;
      return {
        path: path,
        points: points,
        bodyPath: bodyPath,
        head: head,
        shoulderPath: shoulderPath,
        labelX: Math.min(...curveXValues) - 20,
        viewBox: [viewLeft, viewTop, viewSize, viewSize].join(' ')
      };
    },

    timeline(seriesIndex) {
      const samples = this.s.samples || [];
      let path = '';
      let hasPreviousPoint = false;
      for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex++) {
        const sample = samples[sampleIndex];
        const angleDegrees = seriesIndex < 4 ? sample.pitch?.[seriesIndex] : sample.relative?.[seriesIndex - 4];
        if (!Number.isFinite(angleDegrees)) {
          hasPreviousPoint = false;
          continue;
        }
        const positionX = sampleIndex * 600 / 119;
        const positionY = 90 - angleDegrees * 2;
        path += (hasPreviousPoint ? ' L ' : ' M ') + positionX + ' ' + positionY;
        hasPreviousPoint = true;
      }
      return path;
    },
    chooseSession(session) {
      this.chosenId = session.id;
      this.noteDraft = session.note || '';
      if (this.s.mode === 'connected') this.dispatch({ kind: 'historyDetail', id: session.id });
    },
    loadOlder(more) { this.dispatch({ kind: 'historyDetail', id: this.chosenId, more }); },
    sessionAverage(session, sensorIndex) {
      const samples = session.samples.filter(sample => sample.pitch && Number.isFinite(sample.pitch[sensorIndex]));
      if (!samples.length) return '—';
      const sum = samples.reduce((total, sample) => total + sample.pitch[sensorIndex], 0);
      return this.fmt(sum / samples.length);
    },
    sessionMax(session, sensorIndex) {
      const samples = (session.samples || []).filter(sample => sample.pitch && Number.isFinite(sample.pitch[sensorIndex]));
      return samples.length ? this.fmt(Math.max(...samples.map(sample => sample.pitch[sensorIndex]))) : '—';
    },
    sessionRelative(session, sensorIndex) {
      const samples = (session.samples || []).filter(sample => sample.pitch && Number.isFinite(sample.pitch[sensorIndex]) && Number.isFinite(sample.pitch[sensorIndex + 1]));
      if (!samples.length) return '—';
      const sum = samples.reduce((total, sample) => total + sample.pitch[sensorIndex] - sample.pitch[sensorIndex + 1], 0);
      return this.fmt(sum / samples.length);
    },
    historyLine(session, sensorIndex) {
      const samples = session.samples || [];
      const range = Math.max(45, ...(session.angleStats?.pitch ?? []).flatMap(stat =>
        [Math.abs(stat.min_deg ?? 0), Math.abs(stat.max_deg ?? 0)]));
      let path = '';
      let hasPreviousPoint = false;
      let previousMono;
      samples.forEach((sample, index) => {
        const angleDegrees = sample.pitch?.[sensorIndex];
        if (!Number.isFinite(angleDegrees)) { hasPreviousPoint = false; return; }
        const elapsedMs = this.elapsed(session);
        const positionX = elapsedMs > 0 ? Math.max(0, Math.min(600, (sample.t - session.started) * 600 / elapsedMs))
          : samples.length > 1 ? index * 600 / (samples.length - 1) : 0;
        if (sample.gapBefore || session.gaps?.some(gap => gap.startMono < sample.mono && (gap.endMono ?? Infinity) > previousMono)) hasPreviousPoint = false;
        path += (hasPreviousPoint ? ' L ' : ' M ') + positionX + ' ' + (90 - angleDegrees * 80 / range);
        hasPreviousPoint = true;
        previousMono = sample.mono;
      });
      return path;
    },
    dayLabel(dayIndex) {
      const date = new Date(Date.now() - (6 - dayIndex) * 86400000);
      return date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' });
    },
    demoLine(values) {
      return values.map((value, index) => (index ? 'L ' : 'M ') + index * 100 + ' ' + (150 - value * 7)).join(' ');
    }
  }
};
</script>
