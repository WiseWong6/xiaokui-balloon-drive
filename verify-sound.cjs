'use strict';
// 无浏览器、无扬声器的声音检查：事件与画面对齐、节点回收、静音和音量余量。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness(options = {}) {
  const timers = new Map(), instances = [];
  let timerId = 0;
  class Parameter {
    constructor(value = 0) {this.value = value;this.targets = [];}
    cancelScheduledValues() {}
    setTargetAtTime(value, time, smoothing) {this.value = value;this.targets.push({value, time, smoothing});}
  }
  class Node {
    constructor(context, type) {
      this.context = context;this.kind = type;this.type = type;this.connections = [];this.disconnected = false;
      context.nodes.push(this);
    }
    connect(node) {this.connections.push(node);return node;}
    disconnect() {this.connections = [];this.disconnected = true;}
  }
  class Source extends Node {
    constructor(context, type) {
      super(context, type);this.frequency = new Parameter();this.playbackRate = new Parameter(1);
      this.loop = false;this.started = null;this.stopped = Infinity;this.ended = false;
    }
    start(time = this.context.currentTime) {assert.equal(this.started, null);this.started = time;}
    stop(time = this.context.currentTime) {this.stopped = time;}
  }
  class AudioContext {
    constructor() {
      this.nodes = [];this.destination = {};this.sampleRate = options.sampleRate || 24000;
      this.currentTime = 0;this.state = 'suspended';this.resumes = 0;this.suspends = 0;
      instances.push(this);
    }
    createGain() {const n = new Node(this, 'gain');n.gain = new Parameter(1);return n;}
    createDynamicsCompressor() {
      const n = new Node(this, 'compressor');
      for (const name of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[name] = new Parameter();
      return n;
    }
    createBiquadFilter() {const n = new Node(this, 'filter');n.frequency = new Parameter();n.Q = new Parameter();return n;}
    createStereoPanner() {const n = new Node(this, 'pan');n.pan = new Parameter();return n;}
    createOscillator() {return new Source(this, 'oscillator');}
    createBufferSource() {return new Source(this, 'buffer');}
    createBuffer(channels, length, rate) {
      assert.equal(channels, 1);
      return {data: new Float32Array(length), duration: length / rate, sampleRate: rate,
        copyToChannel(data, channel) {assert.equal(channel, 0);this.data.set(data);}};
    }
    async resume() {
      this.resumes++;
      if (options.resumeGate) await options.resumeGate;
      if (options.rejectResume) throw new Error('音频解锁被拒绝');
      this.state = 'running';
    }
    async suspend() {
      this.suspends++;
      if (options.rejectSuspend) throw new Error('音频设备已经关闭');
      this.state = 'suspended';
    }
    advance(seconds) {
      if (this.state !== 'running') return;
      this.currentTime += seconds;
      for (const node of this.nodes) if (node instanceof Source && !node.ended && node.started !== null) {
        const naturalEnd = node.buffer && !node.loop ? node.started + node.buffer.duration / node.playbackRate.value : Infinity;
        if (Math.min(node.stopped, naturalEnd) <= this.currentTime + 1e-9) {
          node.ended = true;node.onended?.();
        }
      }
    }
  }
  const context = vm.createContext({console, Float32Array, Math, Number, Object, Set, Array,
    atob: text => Buffer.from(text, 'base64').toString('binary'),
    window: options.unsupported ? {} : {AudioContext},
    setTimeout(fn) {const id = ++timerId;timers.set(id, fn);return id;},
    clearTimeout(id) {timers.delete(id);}});
  for(const file of ['assets/audio/meow.js','sound.js'])vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
  const api = vm.runInContext('({DrivingSound, createReleaseSamples, createDrivingNoise, decodeMeowRecording, XIAOKUI_MEOW, DRIVING_AUDIO_LEVELS})', context);
  return {...api, instances, timers, async flushTimers() {
    for (const [id, fn] of [...timers]) {timers.delete(id);fn();}
    await Promise.resolve();await Promise.resolve();
  }};
}

const events = Array.from({length: 35}, (_, i) => ({time: 1.1 + Math.floor(i / 7) * 1.5 + i % 7 * .105, index: i, x: -.4}));
const frame = (time, running = true, rate = 1) => ({time, running, rate, duration: 14});
const tickPromises = async () => {for (let i = 0; i < 8; i++) await Promise.resolve();};

async function main() {
  const h = harness(), sound = new h.DrivingSound(events);
  sound.update(frame(0));
  assert.equal(sound.enabled, false);assert.equal(h.instances.length, 0, '静音时不占用音频设备');
  const scheduled = [], schedule = sound.schedule.bind(sound);
  sound.schedule = (event, when, rate) => {scheduled.push({event, when, rate});schedule(event, when, rate);};
  await sound.setEnabled(true);
  const c = sound.context;
  assert.equal(c.state, 'running');assert.equal(sound.enabled, true);
  assert.equal(c.nodes.filter(node => node.kind === 'oscillator').length, 2);
  const baseNodes = c.nodes.length;
  let maxVoices = 0;
  for (let i = 1; i <= 9 * 60; i++) {
    c.advance(1 / 60);sound.update(frame(i / 60));maxVoices = Math.max(maxVoices, sound.voices.size);
  }
  assert.equal(scheduled.length, events.length, '每轮每只气球只响一次');
  assert.equal(new Set(scheduled.map(item => item.event.index)).size, events.length);
  for (const item of scheduled) assert.ok(Math.abs(item.when - item.event.time) < .00001, '声音在脱落时响起');
  assert.ok(maxVoices <= 6);assert.equal(sound.voices.size, 0);
  assert.equal(c.nodes.filter(node => !node.disconnected).length, baseNodes, '短音效结束后释放所有临时节点');
  assert.equal(h.timers.size, 0, '播放过程没有后台计时循环');

  // 自然循环从头重新排未来事件；不补播上一轮遗漏的声音。
  c.advance(5);sound.update(frame(14));
  sound.update(frame(0));assert.equal(scheduled.length, events.length);
  for (let i = 1; i <= 9 * 60; i++) {c.advance(1 / 60);sound.update(frame(i / 60));}
  assert.equal(scheduled.length, events.length * 2);

  // 暂停、切换后台或关闭声音都快速静音并挂起音频处理。
  sound.update(frame(9, false));
  assert.equal(sound.master.gain.value, 0);assert.equal(sound.enabled, true);
  c.advance(.08);await h.flushTimers();assert.equal(c.state, 'suspended');
  assert.equal(sound.voices.size, 0);
  const beforeResume = scheduled.length;
  sound.update(frame(9));await tickPromises();
  assert.equal(c.state, 'running');assert.equal(scheduled.length, beforeResume, '恢复播放不重放旧事件');
  sound.silence();c.advance(.08);await h.flushTimers();
  assert.equal(c.state, 'suspended');assert.equal(sound.enabled, true);
  sound.update(frame(10));await tickPromises();assert.equal(c.state, 'running');
  await sound.setEnabled(false);c.advance(.08);await h.flushTimers();
  assert.equal(c.state, 'suspended');assert.equal(sound.enabled, false);
  sound.update(frame(11));assert.equal(c.state, 'suspended');

  // 在后半段开启声音，不补播已经飘走的气球；重新播放才再次进入脱落事件。
  sound.update(frame(11));await sound.setEnabled(true);assert.equal(scheduled.length, beforeResume);
  sound.invalidate();sound.update(frame(0));
  for (let i = 1; i <= 180; i++) {c.advance(1 / 60);sound.update(frame(i / 60 * 2, true, 2));}
  assert.equal(scheduled.slice(beforeResume).every(item => item.rate === 2), true);
  assert.ok(scheduled.length > beforeResume);
  for (const voice of sound.voices) assert.equal(voice.source.playbackRate.value, 2);
  const beforeSeek = scheduled.length;
  sound.invalidate();sound.update(frame(12, true, 2));
  c.advance(.1);sound.update(frame(12.2, true, 2));
  assert.equal(scheduled.length, beforeSeek, '快进不补播中间事件');
  assert.equal(sound.voices.size, 0, '拖动后取消已经提前安排的声音');

  // 掉帧或连续拖动也不能累积音效；恢复时最多安排前方很短的一段。
  sound.invalidate();sound.update(frame(0));c.advance(4);sound.update(frame(4));
  assert.equal(scheduled.length, beforeSeek);
  for (let i = 0; i < 100; i++) {
    sound.invalidate();sound.update(frame((i % 70) / 10));c.advance(.025);
  }
  assert.ok(sound.voices.size <= 8);
  await sound.setEnabled(false);c.advance(.1);await h.flushTimers();assert.equal(sound.voices.size, 0);

  // 同一时刻再次恢复，不重响刚刚过去的那个事件。
  const exact = harness(), exactSound = new exact.DrivingSound(events);
  exactSound.update(frame(events[0].time));await exactSound.setEnabled(true);
  assert.equal(exactSound.voices.size, 0);

  // 汽车远去时，行驶声随距离减弱并移向右侧；车外仍保留三成环境风声。
  const departing = harness(), departingSound = new departing.DrivingSound(events);
  departingSound.update({...frame(10), vehicleGain: .5, vehiclePan: .7});await departingSound.setEnabled(true);
  assert.equal(departingSound.engine.gain.gain.value, departing.DRIVING_AUDIO_LEVELS.engine * .5);
  assert.equal(departingSound.harmonic.gain.gain.value, departing.DRIVING_AUDIO_LEVELS.harmonic * .5);
  assert.equal(departingSound.carPan.pan.value, .7);
  departingSound.context.advance(.1);
  departingSound.update({...frame(10.1), vehicleGain: 0, vehiclePan: 1});
  assert.equal(departingSound.engine.gain.gain.value, 0);assert.equal(departingSound.harmonic.gain.gain.value, 0);
  assert.equal(departingSound.carPan.pan.value, 1);
  assert.equal(departingSound.wind.gain.value, departing.DRIVING_AUDIO_LEVELS.wind * (.93 + .07 * Math.sin(10.1 * .8)) * .3);
  assert.ok(departingSound.wind.gain.targets.at(-1).smoothing > 0, '风声平滑减弱，不瞬间切断');
  departingSound.context.advance(.1);departingSound.update(frame(10.2));
  assert.equal(departingSound.engine.gain.gain.value, departing.DRIVING_AUDIO_LEVELS.engine);
  assert.equal(departingSound.carPan.pan.value, .08, '缺省参数保留原声音位置与音量');

  // 用户解锁设备期间切换暂停，须读取最新画面，而不是启动旧状态。
  let resolveGate;
  const gate = new Promise(resolve => {resolveGate = resolve;});
  const asyncHarness = harness({resumeGate: gate}), asyncSound = new asyncHarness.DrivingSound(events);
  let current = frame(0);asyncSound.getFrame = () => current;
  const enabling = asyncSound.setEnabled(true);current = frame(5, false);resolveGate();await enabling;
  assert.equal(asyncSound.master.gain.value, 0);assert.equal(asyncSound.voices.size, 0);
  await asyncHarness.flushTimers();assert.equal(asyncSound.context.state, 'suspended');

  // 解锁等待中关闭声音，迟到的完成回调也不能重新发声。
  let unlock;
  const raceHarness = harness({resumeGate: new Promise(resolve => {unlock = resolve;})});
  const raceSound = new raceHarness.DrivingSound(events);raceSound.update(frame(0));
  const firstEnable = raceSound.setEnabled(true);await raceSound.setEnabled(false);
  await raceHarness.flushTimers(); // 设备解锁慢于静音挂起，也不能在迟到后持续空转。
  unlock();await firstEnable;
  assert.equal(raceSound.enabled, false);assert.equal(raceSound.master.gain.value, 0);
  await raceHarness.flushTimers();assert.equal(raceSound.context.state, 'suspended');

  const unavailable = harness({unsupported: true}), unavailableSound = new unavailable.DrivingSound(events);
  let reported = 0;unavailableSound.onError = () => reported++;
  await assert.rejects(() => unavailableSound.setEnabled(true), /不支持/);
  assert.equal(unavailableSound.enabled, false);assert.equal(reported, 1);

  const rejected = harness({rejectResume: true}), rejectedSound = new rejected.DrivingSound(events);
  await assert.rejects(() => rejectedSound.setEnabled(true), /被拒绝/);
  assert.equal(rejectedSound.enabled, false);assert.equal(rejectedSound.resumePromise, null);
  await rejected.flushTimers();assert.equal(rejected.timers.size, 0);

  const closed = harness({rejectSuspend: true}), closedSound = new closed.DrivingSound(events);
  let deviceErrors = 0;closedSound.onError = () => deviceErrors++;
  closedSound.update(frame(0));await closedSound.setEnabled(true);
  closedSound.update(frame(0, false));await closed.flushTimers();await tickPromises();
  assert.equal(closedSound.enabled, false);assert.equal(closed.timers.size, 0);
  assert.equal(deviceErrors, 1, '挂起失败只报告一次，不重新创建失败计时器');

  // 从真实场景取猫叫时刻：正常经过只叫一次，跳过不补播，回拖和下一轮可再次叫。
  const scene = vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'assets/audio/meow.js'), 'utf8')+'\n'+fs.readFileSync(path.join(__dirname, 'scene.js'), 'utf8')
    + '\n({MEOW_AT,MEOW_DURATION,DURATION})');
  const meowEvent = {type: 'meow', time: scene.MEOW_AT, duration: scene.MEOW_DURATION, x: .04};
  for (const rate of [.5, 1, 1.5, 2, 3]) {
    const mh = harness({sampleRate: rate===1?44100:rate===2?48000:24000}), cat = new mh.DrivingSound([...events, meowEvent]), calls = [];
    const play = cat.schedule.bind(cat);
    cat.schedule = (event, when, speed) => {
      play(event, when, speed);
      if (event.type !== 'meow') return;
      calls.push({when, speed});
      const voice = [...cat.voices].at(-1);
      assert.equal(voice.source.buffer, cat.meowBuffer, '猫叫使用真实录音');
      assert.equal(voice.source.buffer.sampleRate, mh.XIAOKUI_MEOW.rate, '设备采样率变化不改变录音的音高与时长');
      assert.equal(voice.source.playbackRate.value, rate);
      assert.equal(voice.gain.gain.value, mh.DRIVING_AUDIO_LEVELS.meow);
      assert.ok(Math.abs(voice.source.buffer.duration - scene.MEOW_DURATION) < 1 / cat.context.sampleRate);
    };
    cat.update(frame(0, true, rate));await cat.setEnabled(true);
    const audio = cat.context;
    for (let i=1;i<=Math.ceil(scene.DURATION/rate*60);i++) {
      audio.advance(1/60);cat.update(frame(i/60*rate, true, rate));
    }
    assert.equal(calls.length, 1, '每轮恰好喵一次');
    assert.ok(Math.abs(calls[0].when-scene.MEOW_AT/rate) < .001, '猫叫与当前倍速对齐');
    assert.equal(calls[0].speed, rate);assert.equal(cat.voices.size, 0);
    cat.invalidate();cat.update(frame(0, true, rate));
    cat.invalidate();cat.update(frame(scene.MEOW_AT+.2, true, rate));
    assert.equal(calls.length, 1, '跳过猫叫时刻不补播');
    cat.invalidate();cat.update(frame(scene.MEOW_AT-.04*rate, true, rate));
    assert.equal(calls.length, 2, '回到猫叫之前会重新安排一次');
    cat.update(frame(scene.MEOW_AT-.04*rate, false, rate));
    audio.advance(.08);await mh.flushTimers();
    assert.equal(cat.voices.size, 0, '暂停取消尚未开始的猫叫');
    assert.equal(audio.state, 'suspended');
    cat.update(frame(0, true, rate));await tickPromises();
    for(let i=1;i<=Math.ceil(scene.DURATION/rate*60);i++) {
      audio.advance(1/60);cat.update(frame(i/60*rate, true, rate));
    }
    assert.equal(calls.length, 3, '下一轮正常经过再次喵一次');
  }

  // 页面播放的每个采样都必须来自可独立试听的录音文件，避免再被合成音替换。
  const wav=fs.readFileSync(path.join(__dirname,'assets/audio/meow.wav'));
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',8,12),'WAVE');
  let format,pcm;
  for(let offset=12;offset+8<=wav.length;){
    const name=wav.toString('ascii',offset,offset+4),size=wav.readUInt32LE(offset+4);
    const chunk=wav.subarray(offset+8,offset+8+size);
    if(name==='fmt ')format=chunk;if(name==='data')pcm=chunk;
    offset+=8+size+(size%2);
  }
  assert.ok(format&&pcm);assert.equal(format.readUInt16LE(0),1);assert.equal(format.readUInt16LE(2),1);
  assert.equal(format.readUInt16LE(14),16);assert.equal(format.readUInt32LE(4),h.XIAOKUI_MEOW.rate);
  const recorded=h.decodeMeowRecording();
  assert.equal(pcm.length,recorded.length*2);assert.equal(recorded.length/h.XIAOKUI_MEOW.rate,scene.MEOW_DURATION);
  for(let i=0;i<recorded.length;i++)assert.equal(recorded[i],pcm.readInt16LE(i*2)/32768);
  assert.throws(()=>h.decodeMeowRecording({...h.XIAOKUI_MEOW,data:''}),/录音不完整/);

  // 采样首尾平滑、无无穷值；按同时播放八个短声计算，仍有充分峰值余量。
  for (const sampleRate of [24000, 44100, 48000]) {
    const noise = h.createDrivingNoise(sampleRate);
    assert.ok([...noise.data].every(Number.isFinite));
    const loopIndex = Math.round(noise.loopStart * sampleRate);
    assert.ok(Math.abs(noise.data.at(-1) - noise.data[loopIndex - 1]) < 1e-6);
    let peak = 0;
    for (const value of noise.data) peak = Math.max(peak, Math.abs(value));
    for (let i = 0; i < 4; i++) {
      const data = h.createReleaseSamples(sampleRate, i);
      assert.equal(Math.abs(data[0]), 0);assert.ok(Math.abs(data.at(-1)) < .0001);
      assert.ok([...data].every(value => Number.isFinite(value) && Math.abs(value) <= .721));
    }
    const levels = h.DRIVING_AUDIO_LEVELS;
    const worstPeak = levels.master * (levels.engine + levels.harmonic + levels.wind * peak + 8 * levels.release * .72);
    assert.ok(worstPeak < .3, `音量保留余量：${worstPeak}`);
    const meow = h.decodeMeowRecording();
    assert.equal(Math.abs(meow[0]),0);assert.ok(Math.abs(meow.at(-1))<.001);
    assert.ok([...meow].every(value=>Number.isFinite(value)&&Math.abs(value)<=.651));
    assert.ok(levels.master*(levels.engine+levels.harmonic+levels.wind*peak+6*levels.release*.72+levels.meow*.65)<.4,'猫叫与松绳声同时响起时仍保留音量余量');
  }
  console.log(`声音检查通过：${events.length} 次脱落逐一对齐、循环/暂停/后台/拖动/倍速、汽车远去与声像、异步开关、节点回收；最多同时 ${maxVoices} 个短声，保守总峰值低于 0.3。`);
  console.log('猫叫检查通过：与真实录音逐采样一致，最后一个气球脱落时每轮一声，五档倍速和三种设备采样率同步，跳过不补播、暂停可取消，采样首尾平滑。');
}
main().catch(error => {console.error(error);process.exitCode = 1;});
