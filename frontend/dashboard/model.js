// State machine shared by the Node-RED function and unit tests.
function step(s, input, now, mode) {
  const demo = mode === 'demo';
  if (!s || s.mode !== mode) s = {mode, deviceId: demo ? 'demo-001' : '', connection: demo ? 'online' : 'offline', session:'idle', pending:null, error:'', reference:null, samples:[], history:[], scenario:'straight', ackMode:'success', distances:[70,70,70], reminder:false, validMs:0};
  if (demo && !s.seeded) {
    for (let day=0; day<7; day++) {
      const start=now-(day+1)*86400000, ref={pitch:[4,3,2,1],timestamp:start,deviceId:s.deviceId};
      const samples=Array.from({length:61},(_,i)=>({t:start+i*1000,pitch:[4+(8+day)*Math.abs(Math.sin(i/15)),3+Math.sin(i/12),2,1]}));
      const eventLog=[{start:start+12000,end:start+45000,metric:'Độ lệch P1',peak:12+day,vibrated:true,email:'Không gửi',response:'Trở về gần mốc sau 18 giây'}];
      s.history.push({id:'DEMO-'+String(day+1).padStart(3,'0'),started:start,ended:start+60000,validMs:60000,samples,reference:ref,events:eventLog.length,vibrations:1,eventLog,gaps:[],note:day%2?'Đọc tài liệu':'Học trên máy tính',status:'Đã hoàn thành',conditions:'Mốc demo · 70 / 70 / 70 mm'});
    }
    s.demoSettings={trigger:15,release:10,hold:30,cooldown:60,emailHold:180,metric:'p1',emailEnabled:false,email:''}; s.writingMode=false; s.seeded=true;
  }
  const emit = [];
  const p = input || {};
  if (p.kind === 'scenario' && demo) { s.scenario = p.value; s.connection = p.value === 'disconnect' ? 'offline' : 'online'; }
  if (p.kind === 'ackMode' && demo) s.ackMode = p.value;
  if (p.kind === 'writingMode' && demo) { s.writingMode=!!p.value; s.notice=s.writingMode?'Đã bật chế độ viết demo.':'Đã tắt chế độ viết demo.'; }
  if (p.kind === 'sessionNote' && demo) { const h=s.history.find(x=>x.id===p.id); if(h){ h.note=String(p.value||'').slice(0,200); s.notice='Đã lưu ghi chú demo.'; } }
  if (p.kind === 'demoSettings' && demo) {
    const v=p.value || {}, nums=[v.trigger,v.release,v.hold,v.cooldown,...(v.distances||[])].map(Number), emailHold=Number(v.emailHold ?? 180);
    if (nums.length!==7 || nums.some(x=>!Number.isFinite(x)) || nums[0]<=0 || nums[1]<0 || nums[1]>=nums[0] || nums[2]<0 || nums[3]<0 || nums.slice(4).some(x=>x<=0) || !Number.isFinite(emailHold) || emailHold<=0) s.error='Cấu hình không hợp lệ: khoảng cách phải dương và ngưỡng kết thúc phải thấp hơn ngưỡng kích hoạt.';
    else { s.demoSettings={trigger:nums[0],release:nums[1],hold:nums[2],cooldown:nums[3],emailHold,metric:['p1','q12','q23','q34'].includes(v.metric)?v.metric:'p1',emailEnabled:!!v.emailEnabled,email:String(v.email||'')}; s.distances=nums.slice(4); s.error=''; s.notice='Đã lưu cấu hình mô phỏng trong bộ nhớ.'; }
  }
  if (p.kind === 'command' && !s.pending && !s.unknown) {
    const allowed = ['START_SESSION','STOP_SESSION','SAVE_REFERENCE','SET_REMINDER','TEST_VIBRATION'];
    if (!allowed.includes(p.command)) s.error = 'Lệnh không được hỗ trợ.';
    else if (s.connection !== 'online') s.error = 'Thiết bị không kết nối.';
    else if (p.command === 'START_SESSION' && (s.session !== 'idle' || !s.valid) || p.command === 'STOP_SESSION' && s.session !== 'active' || p.command === 'SAVE_REFERENCE' && (s.session !== 'idle' || !s.valid)) s.error = 'Trạng thái hoặc dữ liệu chưa cho phép thao tác.';
    else {
      const id = 'ui_' + now + '_' + Math.random().toString(36).slice(2,10);
      s.pending = {requestId:id, deviceId:s.deviceId, commandType:p.command, payload:p.payload || {}, timestamp:new Date(now).toISOString(), sessionId:s.sessionId || null, deadline:now+8000, demoResult:s.ackMode};
      s.error=''; emit.push({type:'command', ...s.pending});
    }
  }
  if (p.kind === 'ack' && s.pending && p.requestId === s.pending.requestId && p.deviceId === s.pending.deviceId && p.commandType === s.pending.commandType && (!s.pending.sessionId || p.sessionId === s.pending.sessionId) && now < s.pending.deadline) {
    const c = s.pending;
    if (p.status === 'applied') {
      if (c.commandType === 'START_SESSION') { s.session='active'; s.sessionId=p.sessionId || ('demo_' + now); s.started=now; s.validMs=0; s.samples=[]; }
      if (c.commandType === 'STOP_SESSION') { s.session='idle'; if (demo) s.history.unshift({id:s.sessionId, started:s.started, ended:now, validMs:s.validMs, samples:s.samples.slice(), reference:s.reference}); s.sessionId=null; }
      if (c.commandType === 'SAVE_REFERENCE' && demo && s.valid && s.pitch) s.reference={pitch:s.pitch.slice(), timestamp:now, deviceId:s.deviceId};
      if (c.commandType === 'SET_REMINDER') s.reminder=!!c.payload.enabled;
      s.notice='Đã xác nhận: '+c.commandType;
    } else if (p.status === 'rejected') s.error='Thiết bị từ chối: '+(p.reason || c.commandType);
    else return {state:s,emit};
    s.pending=null;
  }
  if (s.pending && now >= s.pending.deadline) { s.error='Hết thời gian chờ; kết quả chưa xác định. Kiểm tra trạng thái thiết bị trước khi gửi lại.'; if (!demo) s.unknown=true; s.pending=null; }
  if (demo && p.kind === 'tick') {
    if (s.pending && s.pending.demoResult !== 'timeout' && now >= Date.parse(s.pending.timestamp)+1000) {
      const c=s.pending; return step(s,{kind:'ack',requestId:c.requestId,deviceId:c.deviceId,commandType:c.commandType,sessionId:c.sessionId,status:c.demoResult === 'success' ? 'applied' : 'rejected'},now,mode);
    }
    const t=now/1000, wave=Math.sin(t/8); let pitch;
    if (s.scenario === 'c') pitch=[25+wave*3,16+wave*2,8,2];
    else if (s.scenario === 's') pitch=[18+wave*3,6,-8+wave*2,0];
    else pitch=[4+wave*2,3+wave,2,1];
    const ok=s.connection==='online' && s.scenario!=='missing'; s.valid=ok;
    s.sensorStatus=Array.from({length:4},(_,i)=>s.connection!=='online'?'offline':s.scenario==='missing' && i===2?'missing':'ok');
    s.pitch=s.connection!=='online'?null:pitch.map((v,i)=>s.sensorStatus[i]==='ok'?v:null);
    s.relative=s.pitch?[0,1,2].map(i=>Number.isFinite(s.pitch[i])&&Number.isFinite(s.pitch[i+1])?s.pitch[i]-s.pitch[i+1]:null):null; s.updated=now;
    if (s.session==='active' && ok && s.lastTick && now-s.lastTick<=2000) s.validMs += now-s.lastTick;
    s.lastTick=now; s.samples.push({t:now,pitch:ok?pitch:null,relative:s.relative}); if(s.samples.length>120)s.samples.shift();
  }
  // Production messages must come from a trusted F06.1 adapter; no simulated success.
  if (!demo && p.kind === 'state') {
    if (p.deviceId && (!s.deviceId || p.deviceId===s.deviceId)) Object.assign(s,p.state || {});
  }
  return {state:s,emit};
}
if (typeof module !== 'undefined') module.exports = {step};
