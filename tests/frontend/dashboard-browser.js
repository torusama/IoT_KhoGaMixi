// Chạy với dashboard demo, hoặc connected + simulator exercise khi đặt SPT_DASHBOARD_MODE=connected.
// Có thể đặt CHROME_PATH và SPT_DASHBOARD_ORIGIN khi dùng cài đặt khác.
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

const repositoryRoot = path.resolve(__dirname, '../..');
const screenshotDirectory = path.join(repositoryRoot, '.runtime/dashboard-review');
const dashboardOrigin = process.env.SPT_DASHBOARD_ORIGIN || 'http://127.0.0.1:1881';
const chromePath = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome');

(async function () {
  await fs.mkdir(screenshotDirectory, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'spt-ui-browser-'));
  const browser = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0',
    ...(process.env.SPT_CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    '--user-data-dir=' + profile, 'about:blank'
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let socket;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let logs = '';
      const timeout = setTimeout(() => reject(Error('Chrome timeout')), 15000);
      browser.stderr.on('data', chunk => {
        logs += chunk;
        const match = logs.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
      browser.on('error', reject);
    });
    const origin = endpoint.replace('ws:', 'http:').split('/devtools/')[0];
    const pages = await (await fetch(origin + '/json/list')).json();
    socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
    let nextId = 0;
    const pending = new Map();
    const errors = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(request.timeout);
        if (message.error) request.reject(Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
      } else if (message.method === 'Runtime.exceptionThrown') {
        errors.push(message.params.exceptionDetails.text);
      } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        errors.push(JSON.stringify(message.params.args));
      }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 20000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
      return response.result.value;
    };
    const waitFor = async expression => {
      await evaluate(`new Promise((resolve,reject)=>{const deadline=Date.now()+15000;const interval=setInterval(()=>{if(${expression}){clearInterval(interval);resolve(true)}else if(Date.now()>deadline){clearInterval(interval);reject(Error('Condition timed out: '+${JSON.stringify(expression)}))}},100)})`);
    };
    const screenshot = async filename => {
      const response = await send('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(path.join(screenshotDirectory, filename), Buffer.from(response.data, 'base64'));
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1150, deviceScaleFactor: 1, mobile: false });
    if (process.env.SPT_DASHBOARD_MODE === 'connected') {
      await send('Page.navigate', { url: dashboardOrigin + '/spt/settings' });
      await waitFor("document.querySelector('.spt .checklist .ok') !== null");
      assert.equal(await evaluate("document.querySelector('.spt .actions button').disabled"), true);
      await evaluate("const posture=document.querySelector('.spt select'); posture.value='standing'; posture.dispatchEvent(new Event('change')); document.querySelector('.spt input[type=checkbox]').click()");
      await evaluate("document.querySelector('.spt .actions button').click()");
      await waitFor("document.querySelector('.spt progress') !== null");
      await waitFor("document.querySelector('.spt .notice')?.textContent.includes('Đã lưu mốc')");
      await waitFor("document.querySelector('.spt .event-row')?.textContent.includes('Đứng')");
      await screenshot('connected-settings.png');

      await send('Page.navigate', { url: dashboardOrigin + '/spt/dashboard' });
      await waitFor("document.querySelector('.start-session:not([disabled])') !== null");
      await evaluate("document.querySelector('.start-session').click()");
      await waitFor("document.querySelector('.stop-session:not([disabled])') !== null");
      await waitFor("document.querySelector('.reference-panel .info-row b')?.textContent.includes('°')");
      await waitFor("document.querySelector('.livepath') !== null");
      await screenshot('connected-dashboard.png');
      await evaluate('new Promise(resolve=>setTimeout(resolve,8500))');
      await evaluate("document.querySelector('.stop-session').click()");
      await waitFor("document.querySelector('.stop-session') === null");

      await send('Page.navigate', { url: dashboardOrigin + '/spt/history' });
      await waitFor("document.querySelector('.history-row')?.textContent.includes('Mô phỏng')");
      await evaluate("document.querySelector('.history-row').click()");
      await waitFor("document.querySelector('.spt')?.textContent.includes('Đã lưu bản tổng hợp cuối')");
      await waitFor("document.querySelectorAll('.angle-summary').length === 7 && document.querySelectorAll('.bin').length === 6");
      assert.match(await evaluate("document.querySelector('.spt').textContent"), /Mất dữ liệu.*Vượt ngưỡng P1|Vượt ngưỡng P1.*Mất dữ liệu/s);
      await screenshot('connected-history.png');
      await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 1000, deviceScaleFactor: 1, mobile: false });
      await evaluate('new Promise(resolve=>setTimeout(resolve,300))');
      const viewport = await evaluate(`({
        width: innerWidth, scroll: document.documentElement.scrollWidth,
        overflow: [...document.querySelectorAll('.spt *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1)
          .slice(0,12).map(el=>el.tagName+'.'+String(el.className))
      })`);
      await screenshot('connected-history-mobile.png');
      assert.ok(viewport.scroll <= viewport.width, 'Connected History overflows: ' + JSON.stringify(viewport));
      assert.deepEqual(errors, []);
      console.log('PASS: browser → guided reference → MQTT START/STOP → deviation → persisted History with seven angles, histogram and gap events.');
      return;
    }
    await send('Page.navigate', { url: dashboardOrigin + '/spt/dashboard' });
    await waitFor("document.querySelectorAll('.preset-button').length === 3");
    await evaluate("document.querySelector('.preset-button').click()");
    await waitFor("document.querySelector('.livepath') !== null");
    const curveFitsViewport = await evaluate(`(()=>{
      const plot=document.querySelector('.curve-stage svg');
      const line=document.querySelector('.livepath');
      const plotBounds=plot.getBoundingClientRect();
      const lineBounds=line.getBoundingClientRect();
      return plot.viewBox.baseVal.height>0 && lineBounds.height>100 &&
        lineBounds.top>=plotBounds.top && lineBounds.bottom<=plotBounds.bottom &&
        lineBounds.left>=plotBounds.left && lineBounds.right<=plotBounds.right;
    })()`);
    assert.equal(curveFitsViewport,true,'Curve must be visible and fitted inside SVG');
    await screenshot('dashboard-desktop.png');
    for (const width of [375, 768, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await evaluate('new Promise(resolve=>setTimeout(resolve,250))');
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Page overflow at ' + width);
      assert.equal(await evaluate("document.querySelectorAll('.sensor-dot').length"), 4);
      assert.equal(await evaluate("document.querySelector('.preset-button').getBoundingClientRect().height < 80"), true, 'Preset controls must stay compact at ' + width);
      if (width === 375) {
        await screenshot('dashboard-mobile.png');
        await evaluate("document.querySelector('.curve-stage').scrollIntoView({block:'center'})");
        await screenshot('dashboard-mobile-curve.png');
        await evaluate('window.scrollTo(0,0)');
      }
    }
    await evaluate("document.querySelectorAll('.preset-button')[2].click()");
    await waitFor("document.querySelectorAll('.preset-button')[2].getAttribute('aria-pressed') === 'true'");
    await screenshot('dashboard-s-shape.png');
    await evaluate("document.querySelector('.reference-panel button').click()");
    await waitFor("document.querySelector('.refline') !== null");
    await evaluate("document.querySelector('.reference-toggle input').click()");
    await waitFor("document.querySelector('.refline') === null");
    await evaluate("document.querySelector('.start-session').click()");
    await waitFor("document.querySelector('.stop-session') !== null");
    assert.equal(await evaluate("document.querySelector('.reference-panel button').disabled"), true);
    await evaluate("document.querySelector('.stop-session').click()");
    await waitFor("document.querySelector('.stop-session') === null");
    if (await evaluate("document.querySelector('.toggle-switch').getAttribute('aria-checked') === 'true'")) {
      await evaluate("document.querySelector('.toggle-switch').click()");
      await waitFor("document.querySelector('.toggle-switch').getAttribute('aria-checked') === 'false'");
    }
    await evaluate("document.querySelector('.toggle-switch').click()");
    await waitFor("document.querySelector('.toggle-switch').getAttribute('aria-checked') === 'true'");
    await evaluate("document.querySelector('.simulation-tools').open=true;document.querySelectorAll('.simulation-tools .actions button')[0].click()");
    await waitFor("document.querySelector('.livepath') === null");
    assert.equal(await evaluate("document.querySelectorAll('.sensor-reading.unavailable').length"), 1);
    assert.equal(await evaluate("document.querySelector('.start-session').disabled"), true);
    await evaluate("document.querySelectorAll('.simulation-tools .actions button')[2].click()");
    await waitFor("document.querySelector('.livepath') !== null");
    for (const page of ['history', 'progress', 'settings']) {
      await send('Page.navigate', { url: dashboardOrigin + '/spt/' + page });
      await waitFor("document.querySelector('.spt h1') !== null");
      await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 1000, deviceScaleFactor: 1, mobile: false });
      await evaluate('new Promise(resolve=>setTimeout(resolve,250))');
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, page + ' overflows');
    }
    assert.deepEqual(errors, []);
    console.log('PASS: dashboard at 375/768/1440; all four pages; C/S presets; reference; START/STOP; reminder; missing sensor; no browser errors.');
  } finally {
    if (browser.exitCode === null) {
      const stopped = new Promise(resolve => browser.once('exit', resolve));
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: 99999, method: 'Browser.close' }));
      else browser.kill();
      await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 3000))]);
    }
    socket?.close();
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
