/* 确定性导出：seek 驱动 renderScene() 截帧，页面内 OfflineAudioContext 复刻声音引擎（行驶、风、松绳、猫叫）。
   运行：node tools/export-3x4.cjs（需本机 Playwright 与 ffmpeg） */
'use strict';
const fs = require('node:fs'), path = require('node:path'), {spawn} = require('node:child_process'), {once} = require('node:events');
const root = path.resolve(__dirname, '..');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/Users/wisewong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const FPS = 30, D = 14, OUT_W = 1080, OUT_H = 1440; // 画布逻辑 900×1200，导出 3:4 1080×1440
const outDir = path.join(root, '交付文件');
const videoPath = path.join(outDir, '小葵驾车-3比4.mp4');
fs.mkdirSync(outDir, {recursive: true});
fs.mkdirSync(path.join(root, 'output/'), {recursive: true});

async function main() {
  const browser = await chromium.launch({headless: true});
  const work = fs.mkdtempSync(path.join(root, 'output/', 'export-'));
  try {
    const page = await browser.newPage({viewport: {width: 900, height: 1200}, deviceScaleFactor: 1});
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto('file://' + path.join(root, 'index.html'));
    await page.waitForFunction(() => typeof renderScene === 'function' && typeof sceneSound !== 'undefined' && sceneSound !== null, null, {timeout: 60000});
    if (errors.length) throw Error(errors.join('\n'));

    // ---- 离线音频：按项目 sound.js 的图与混音逻辑在 OfflineAudioContext 里重建 ----
    await page.evaluate(duration => {
      const SR = 48000, total = Math.ceil((duration + .2) * SR), L = DRIVING_AUDIO_LEVELS;
      const off = new OfflineAudioContext(2, total, SR);
      const master = off.createGain(); master.gain.value = 0;
      const limiter = off.createDynamicsCompressor();
      limiter.threshold.value = -9; limiter.knee.value = 6; limiter.ratio.value = 10;
      limiter.attack.value = .006; limiter.release.value = .16;
      master.connect(limiter); limiter.connect(off.destination);
      const carFilter = off.createBiquadFilter(); carFilter.type = 'lowpass'; carFilter.frequency.value = 260; carFilter.Q.value = .5;
      const carPan = off.createStereoPanner(); carPan.pan.value = .08;
      carFilter.connect(carPan); carPan.connect(master);
      const tone = (frequency, type) => {
        const source = off.createOscillator(), gain = off.createGain();
        source.frequency.value = frequency; source.type = type; gain.gain.value = 0;
        source.connect(gain); gain.connect(carFilter); source.start(0);
        return {source, gain};
      };
      const engine = tone(76, 'triangle'), harmonic = tone(152, 'sine');
      const noise = createDrivingNoise(SR);
      const buffer = off.createBuffer(1, noise.data.length, SR); buffer.copyToChannel(noise.data, 0);
      const windSource = off.createBufferSource(); windSource.buffer = buffer; windSource.loop = true;
      windSource.loopStart = noise.loopStart; windSource.loopEnd = buffer.duration;
      const windFilter = off.createBiquadFilter(); windFilter.type = 'lowpass'; windFilter.frequency.value = 780; windFilter.Q.value = .5;
      const wind = off.createGain(); wind.gain.value = 0;
      windSource.connect(windFilter); windFilter.connect(wind); wind.connect(master); windSource.start(0);
      const releases = Array.from({length: 4}, (_, i) => {
        const samples = createReleaseSamples(SR, i);
        const b = off.createBuffer(1, samples.length, SR); b.copyToChannel(samples, 0); return b;
      });
      const meow = decodeMeowRecording();
      const meowBuffer = off.createBuffer(1, meow.length, XIAOKUI_MEOW.rate); meowBuffer.copyToChannel(meow, 0);
      for (const e of sceneSound.events) {
        const source = off.createBufferSource();
        source.buffer = e.type === 'meow' ? meowBuffer : releases[Math.abs(Math.round(e.index)) % releases.length];
        const gain = off.createGain(); gain.gain.value = e.type === 'meow' ? L.meow : L.release;
        const pan = off.createStereoPanner(); pan.pan.value = e.x * .75;
        source.connect(gain); gain.connect(pan); pan.connect(master); source.start(e.time);
      }
      // 连续声部：45ms 步进采样 soundFrame()，与页面 RAF 混音节奏一致
      paused = false; playbackRate = 1;
      for (let t = 0; t <= duration; t += .045) {
        clock = t; const f = soundFrame();
        engine.source.frequency.setTargetAtTime(76, t, .08);
        harmonic.source.frequency.setTargetAtTime(152, t, .08);
        engine.gain.gain.setTargetAtTime(L.engine * f.vehicleGain, t, .07);
        harmonic.gain.gain.setTargetAtTime(L.harmonic * f.vehicleGain, t, .07);
        carPan.pan.setTargetAtTime(f.vehiclePan, t, .08);
        wind.gain.setTargetAtTime(L.wind * (.93 + .07 * Math.sin(t * .8)) * (.3 + .7 * f.vehicleGain), t, .08);
      }
      master.gain.setTargetAtTime(L.master, .02, .035);
      master.gain.setValueAtTime(L.master, duration - .3);
      master.gain.linearRampToValueAtTime(0, duration - .02);
      return off.startRendering().then(rendered => {
        const n = rendered.length, bytes = new Uint8Array(44 + n * 4), dv = new DataView(bytes.buffer);
        const wstr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
        wstr(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); wstr(8, 'WAVEfmt ');
        dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
        dv.setUint32(24, SR, true); dv.setUint32(28, SR * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
        wstr(36, 'data'); dv.setUint32(40, n * 4, true);
        const CH = [rendered.getChannelData(0), rendered.getChannelData(1)];
        for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++)
          dv.setInt16(44 + i * 4 + c * 2, Math.max(-1, Math.min(1, CH[c][i])) * 32767, true);
        window.__wavBytes = bytes;
        window.__wavChunks = Math.ceil(bytes.length / (3 * 1024 * 1024));
      });
    }, D);
    const wavPath = path.join(work, 'audio.wav');
    const fd = fs.openSync(wavPath, 'w');
    for (let k = 0; k < await page.evaluate(() => window.__wavChunks); k++) {
      const part = await page.evaluate(i => {
        const bytes = window.__wavBytes.subarray(i * 3 * 1024 * 1024, (i + 1) * 3 * 1024 * 1024);
        let bin = ''; const step = 0x8000;
        for (let j = 0; j < bytes.length; j += step) bin += String.fromCharCode.apply(null, bytes.subarray(j, j + step));
        return btoa(bin);
      }, k);
      fs.writeSync(fd, Buffer.from(part, 'base64'));
    }
    fs.closeSync(fd);
    await page.evaluate(() => { delete window.__wavBytes; delete window.__wavChunks; });
    console.log('音频已烘焙', fs.statSync(wavPath).size, '字节', '事件数', await page.evaluate(() => sceneSound.events.length));

    // ---- 视频帧：导出画布 1080×1440，seek + renderScene + toDataURL ----
    await page.evaluate(({w, h}) => {
      noLoop();
      const canvas = document.querySelector('#stage canvas');
      canvas.width = w; canvas.height = h;
      drawingContext.setTransform(w / 900, 0, 0, h / 1200, 0, 0);
    }, {w: OUT_W, h: OUT_H});
    if (errors.length) throw Error(errors.join('\n'));
    const log = fs.openSync(path.join(work, 'ffmpeg.log'), 'w');
    const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'warning',
      '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0', '-i', wavPath,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-t', String(D), videoPath],
      {stdio: ['pipe', 'ignore', log]});
    const done = once(ff, 'close'); ff.stdin.on('error', () => {});
    const frames = Math.round(D * FPS), t0 = Date.now();
    for (let i = 0; i < frames; i++) {
      const data = await page.evaluate(t => {
        renderScene(t);
        return document.querySelector('#stage canvas').toDataURL('image/jpeg', .95).split(',')[1];
      }, i / FPS);
      if (errors.length) throw Error(errors.join('\n'));
      if (!ff.stdin.write(Buffer.from(data, 'base64'))) await once(ff.stdin, 'drain');
      if (i % 90 === 0) console.log(`已渲染 ${i}/${frames} 帧（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
    }
    ff.stdin.end();
    const [code] = await done; fs.closeSync(log);
    if (code !== 0) throw Error(fs.readFileSync(path.join(work, 'ffmpeg.log'), 'utf8'));
    console.log('完成：' + videoPath);
  } finally {
    await browser.close(); fs.rmSync(work, {recursive: true, force: true});
  }
}
main().catch(e => {console.error(e); process.exitCode = 1;});
