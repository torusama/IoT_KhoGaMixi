/** Framework-independent client. Keep the token in application memory, never in URLs. */
export class PostureApi {
  constructor({ baseUrl = '', token, fetchImpl = globalThis.fetch }) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); this.token = token; this.fetch = fetchImpl;
  }
  async request(path, { method = 'GET', body, signal } = {}) {
    const response = await this.fetch(`${this.baseUrl}/api/v1${path}`, {
      method, signal, headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const value = await response.json();
    if (!response.ok) { const error = new Error(value.error?.message || response.statusText); error.code = value.error?.code; error.status = response.status; throw error; }
    return value;
  }
  query(params = {}) { const value = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)); return value.size ? `?${value}` : ''; }
  devices() { return this.request('/devices'); }
  device(id) { return this.request(`/devices/${encodeURIComponent(id)}`); }
  sessions(params) { return this.request(`/sessions${this.query(params)}`); }
  session(id) { return this.request(`/sessions/${encodeURIComponent(id)}`); }
  history(id, type, params) { return this.request(`/sessions/${encodeURIComponent(id)}/${type}${this.query(params)}`); }
  references(id, params) { return this.request(`/devices/${encodeURIComponent(id)}/references${this.query(params)}`); }
  reports(params) { return this.request(`/reports/daily${this.query(params)}`); }
  command(id) { return this.request(`/commands/${encodeURIComponent(id)}`); }
  send(deviceId, command, fields = {}, commandId = globalThis.crypto.randomUUID()) {
    return this.request(`/devices/${encodeURIComponent(deviceId)}/commands`, { method: 'POST', body: { ...fields, command, command_id: commandId } });
  }
  start(id, mode = 'measurement_only', commandId) { return this.send(id, 'START', { mode }, commandId); }
  stop(id, sessionId, commandId) { return this.send(id, 'STOP', { session_id: sessionId }, commandId); }
  setReference(id, commandId) { return this.send(id, 'SET_REFERENCE', { guided_confirmation: true }, commandId); }
  setReminder(id, enabled, commandId) { return this.send(id, 'SET_REMINDER', { enabled }, commandId); }
  vibrate(id, durationMs = 200, commandId) { return this.send(id, 'TEST_VIBRATION', { duration_ms: durationMs }, commandId); }
  /** Authenticated fetch streaming; native EventSource cannot attach this Bearer header. */
  async *stream({ signal } = {}) {
    const response = await this.fetch(`${this.baseUrl}/api/v1/stream`, { signal, headers: { Authorization: `Bearer ${this.token}`, Accept: 'text/event-stream' } });
    if (!response.ok) throw new Error(`Realtime HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (data) yield JSON.parse(data);
        }
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}
