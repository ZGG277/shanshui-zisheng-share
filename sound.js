'use strict';
(() => {
  // Procedural material foley only. Activity frames renew rain/fire/snow;
  // effective brush dabs renew friction. Timers can only stop sound.
  const STORAGE_KEY = 'shanshui.sfx.enabled.v1';
  const MATERIALS = {
    stone: { high: 950, low: 3100, level: 0.17 },
    sand: { high: 1400, low: 6800, level: 0.14 },
    gold: { high: 1900, low: 8500, level: 0.12 },
    soil: { high: 650, low: 6400, level: 0.13 },
    wood: { high: 500, low: 2400, level: 0.13 },
    grow: { high: 1000, low: 4700, level: 0.055 },
  };
  const AMBIENT = {
    rain: { high: 280, low: 2300, level: 0.04 },
    fire: { high: 850, low: 6400, level: 0.14 },
    snow: { high: 1700, low: 7600, level: 0.025 },
  };
  let instance = null;

  function create() {
    if (instance) return instance;
    const doc = window.document;
    let enabled = true, context = null, gestureArmed = false, authorized = false;
    let pageHidden = false, epoch = 0, pendingResume = null;
    let seed = 0x6d2b79f5, nextSnow = null, lastAmbient = -Infinity;
    const buffers = Object.create(null);
    const channels = {};
    ['gesture', 'rain', 'fire', 'snow'].forEach(name => {
      channels[name] = { name, source: null, key: null, graph: null, envelope: [], timer: null, token: 0, mode: 'silent', end: Infinity };
    });
    try { enabled = window.localStorage.getItem(STORAGE_KEY) !== 'off'; } catch (error) { /* Optional storage. */ }

    function random() {
      // Sound owns this PRNG; it never advances the painting simulation's RNG.
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    }
    function makeNoise(kind) {
      const rate = context.sampleRate;
      const rain = kind === 'rain';
      const length = Math.ceil(rate * (kind === 'fire' ? 3.713 : 2.071));
      const overlap = Math.max(2, Math.ceil(rate * 0.024));
      const work = new Float32Array(length + overlap);
      const lowAlpha = 1 - Math.exp(-2 * Math.PI * (rain ? 160 : 350) / rate);
      const highAlpha = 1 - Math.exp(-2 * Math.PI * Math.min(rain ? 1850 : 8500, rate * 0.4) / rate);
      const grainAlpha = 1 - Math.exp(-1 / (rate * (kind === 'grain' ? 0.0015 : rain ? 0.034 : 0.006)));
      let low = 0, high = 0, veil = 0, grain = 0.7, target = 0.7, remaining = 0, crackle = 0, decay = 0.99;
      for (let i = 0; i < work.length; i++) {
        if (remaining <= 0) {
          if (kind === 'fire') {
            // Unequal gaps and decays, with a quiet continuous rustle beneath.
            crackle = 0.25 + random() * 0.75;
            decay = Math.exp(-1 / (rate * (0.0015 + random() * 0.007)));
            remaining = Math.floor(rate * (0.008 + Math.pow(random(), 2) * 0.085));
          } else {
            target = (kind === 'grain' ? 0.23 : rain ? 0.68 : 0.55) + random() * (kind === 'grain' ? 0.77 : rain ? 0.32 : 0.45);
            remaining = Math.floor(rate * (kind === 'grain' ? 0.002 + random() * 0.013 : 0.014 + random() * 0.035));
          }
        }
        remaining--;
        grain += grainAlpha * (target - grain);
        crackle *= decay;
        const raw = random() * 2 - 1;
        low += lowAlpha * (raw - low); high += highAlpha * (raw - high);
        // Distant drizzle: a second soft roll-off removes the broad hiss,
        // with shallow, rounded changes instead of individual pitched drops.
        // Keep the PRNG cadence unchanged so other material textures stay intact.
        if (rain) veil += highAlpha * (high - veil);
        work[i] = ((rain ? veil : high) - low) * (kind === 'fire' ? 0.13 + crackle : grain);
      }
      const result = context.createBuffer(1, length, rate);
      const data = result.getChannelData(0);
      let mean = 0, peak = 0;
      for (let i = 0; i < length; i++) {
        let value = work[i];
        if (i < overlap) {
          const u = i / (overlap - 1), blend = u * u * (3 - 2 * u);
          value = work[length + i] * (1 - blend) + value * blend;
        }
        data[i] = value; mean += value;
      }
      mean /= length;
      for (let i = 0; i < length; i++) { data[i] -= mean; peak = Math.max(peak, Math.abs(data[i])); }
      const scale = peak > 0 ? 0.25 / peak : 0;
      for (let i = 0; i < length; i++) data[i] *= scale;
      return result;
    }
    function makeSnow(variant) {
      // Intentionally tiny wind-chime flecks, only while real snow is moving.
      // Non-harmonic partials, no scale/melody, no equal-interval scheduler.
      const rate = context.sampleRate, length = Math.ceil(rate * 0.185);
      const result = context.createBuffer(1, length, rate), data = result.getChannelData(0);
      const pitch = [2513, 2837, 3163][variant];
      let peak = 0;
      for (let i = 0; i < length; i++) {
        const t = i / rate, u = i / (length - 1);
        const attack = Math.min(1, t / 0.006), tail = Math.pow(1 - u, 2);
        let value = Math.sin(2 * Math.PI * Math.min(pitch, rate * 0.29) * t) * Math.exp(-t / 0.050);
        value += 0.31 * Math.sin(2 * Math.PI * Math.min(pitch * 1.431, rate * 0.36) * t) * Math.exp(-t / 0.027);
        value += 0.12 * Math.sin(2 * Math.PI * Math.min(pitch * 2.117, rate * 0.43) * t) * Math.exp(-t / 0.016);
        data[i] = value * attack * attack * tail;
        peak = Math.max(peak, Math.abs(data[i]));
      }
      const scale = peak > 0 ? 0.16 / peak : 0;
      for (let i = 0; i < length; i++) data[i] *= scale;
      return result;
    }
    function hidden() { return pageHidden || !!(doc && (doc.hidden || doc.visibilityState === 'hidden')); }
    function usable() { return enabled && authorized && !hidden() && context && context.state === 'running'; }
    function clearTimer(channel) {
      channel.token++;
      if (channel.timer !== null) { window.clearTimeout(channel.timer); channel.timer = null; }
    }
    function retire(channel) {
      if (!channel.source) return;
      const source = channel.source; channel.source = null; channel.key = null; channel.end = Infinity; channel.mode = 'silent';
      source.onended = null;
      try { source.stop(); } catch (error) { /* Already ended. */ }
      try { source.disconnect(); } catch (error) { /* Already disconnected. */ }
    }
    function levelAt(channel, time) {
      const points = channel.envelope;
      if (!points.length) return 0;
      for (let i = 1; i < points.length; i++) {
        if (time <= points[i].time) {
          const a = points[i - 1], b = points[i];
          const u = Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time)));
          return a.value + (b.value - a.value) * u;
        }
      }
      return points[points.length - 1].value;
    }
    function automate(channel, points) {
      const param = channel.graph.gain.gain;
      param.cancelScheduledValues(points[0].time); param.setValueAtTime(points[0].value, points[0].time);
      for (let i = 1; i < points.length; i++) param.linearRampToValueAtTime(points[i].value, points[i].time);
      channel.envelope = points;
    }
    function zero(channel) {
      channel.envelope = [];
      if (!channel.graph || !context) return;
      try {
        const param = channel.graph.gain.gain;
        param.cancelScheduledValues(context.currentTime); param.setValueAtTime(0, context.currentTime); param.value = 0;
      } catch (error) { /* Source retirement is the final fallback. */ }
    }
    function cleanupAfter(channel, seconds) {
      const token = channel.token;
      channel.timer = window.setTimeout(() => {
        if (token !== channel.token) return;
        channel.timer = null; zero(channel); retire(channel);
      }, Math.ceil(seconds * 1000) + 5);
    }
    function stopChannel(channel, immediate, duration) {
      if (!immediate && channel.mode === 'fading') return;
      clearTimer(channel);
      if (!channel.source || immediate || !context || context.state !== 'running') {
        zero(channel); retire(channel); return;
      }
      try {
        const now = context.currentTime;
        automate(channel, [{ time: now, value: levelAt(channel, now) }, { time: now + duration, value: 0 }]);
        channel.mode = 'fading'; cleanupAfter(channel, duration);
      } catch (error) { zero(channel); retire(channel); }
    }
    function stop(immediate = false) {
      if (!immediate) { stopChannel(channels.gesture, false, 0.030); return; }
      epoch++; gestureArmed = false; nextSnow = null; lastAmbient = -Infinity;
      Object.keys(channels).forEach(name => stopChannel(channels[name], true, 0));
      // Retain successful prior permission for activity-driven ambience after
      // returning, but never create/resume a context without another gesture.
    }
    function createGraph(channel) {
      if (channel.graph) return;
      const nodes = [];
      try {
        const high = context.createBiquadFilter(); nodes.push(high);
        const low = context.createBiquadFilter(); nodes.push(low);
        const gain = context.createGain(); nodes.push(gain);
        high.type = 'highpass'; high.Q.value = 0.55; low.type = 'lowpass'; low.Q.value = 0.55;
        gain.gain.value = 0;
        high.connect(low); low.connect(gain); gain.connect(context.destination);
        channel.graph = { high, low, gain };
      } catch (error) {
        nodes.forEach(node => { try { node.disconnect(); } catch (ignored) { /* Cleanup only. */ } });
        throw error;
      }
    }
    function begin(channel, key, loop) {
      createGraph(channel);
      if (channel.source && (context.currentTime >= channel.end || channel.key !== key)) { zero(channel); retire(channel); }
      if (channel.source) return;
      if (!buffers[key]) buffers[key] = key.indexOf('snow') === 0 ? makeSnow(Number(key.slice(4))) : makeNoise(key);
      const source = context.createBufferSource(); channel.source = source; channel.key = key;
      source.buffer = buffers[key]; source.loop = loop;
      channel.end = loop ? Infinity : context.currentTime + source.buffer.duration;
      source.connect(channel.graph.high);
      source.onended = () => {
        if (channel.source !== source) return;
        clearTimer(channel); zero(channel); retire(channel);
      };
      source.start();
    }
    function renew(channel, material, strength, attack, hold, end) {
      clearTimer(channel);
      const now = context.currentTime, limit = context.sampleRate * 0.45;
      channel.graph.high.frequency.cancelScheduledValues(now); channel.graph.low.frequency.cancelScheduledValues(now);
      channel.graph.high.frequency.setTargetAtTime(Math.min(material.high, limit), now, 0.015);
      channel.graph.low.frequency.setTargetAtTime(Math.min(material.low, limit), now, 0.015);
      const target = material.level * Math.sqrt(strength);
      automate(channel, [
        { time: now, value: levelAt(channel, now) }, { time: now + attack, value: target },
        { time: now + hold, value: target }, { time: now + end, value: 0 },
      ]);
      channel.mode = 'active'; cleanupAfter(channel, end);
    }
    function unlock() {
      if (!enabled || hidden()) return Promise.resolve(false);
      const token = epoch;
      try {
        if (!context) {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (!AudioContext) return Promise.resolve(false);
          context = new AudioContext();
        }
        if (context.state === 'closed') return Promise.resolve(false);
        if (context.state === 'running') { authorized = true; gestureArmed = true; return Promise.resolve(true); }
        if (!pendingResume) {
          pendingResume = Promise.resolve(context.resume()).then(() => {
            pendingResume = null; return context.state === 'running';
          }, () => { pendingResume = null; return false; });
        }
        return pendingResume.then(resumed => {
          const ready = resumed && token === epoch && enabled && !hidden();
          if (ready) { authorized = true; gestureArmed = true; }
          return ready;
        });
      } catch (error) { gestureArmed = false; return Promise.resolve(false); }
    }
    function gesture(kind, strength) {
      const channel = channels.gesture;
      try {
        if (!usable()) { stopChannel(channel, true, 0); return false; }
        if (!gestureArmed || !Object.prototype.hasOwnProperty.call(MATERIALS, kind)
          || !Number.isFinite(strength) || strength <= 0 || !Number.isFinite(context.currentTime)) return false;
        begin(channel, kind === 'sand' || kind === 'gold' ? 'grain' : 'soft', true);
        renew(channel, MATERIALS[kind], Math.min(1, strength), 0.018, 0.110, 0.140);
        return true;
      } catch (error) { stopChannel(channel, true, 0); return false; }
    }
    function ambience(activity) {
      try {
        if (!usable() || !Number.isFinite(context.currentTime)) {
          ['rain', 'fire', 'snow'].forEach(name => stopChannel(channels[name], true, 0));
          nextSnow = null; return false;
        }
        const now = context.currentTime;
        const amounts = {};
        ['rain', 'fire', 'snow'].forEach(name => {
          const value = activity && activity[name];
          amounts[name] = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
        });
        if (now - lastAmbient > 0.205) nextSnow = null;
        lastAmbient = now;
        ['rain', 'fire'].forEach(name => {
          const channel = channels[name], amount = amounts[name];
          if (amount <= 0) { stopChannel(channel, false, 0.040); return; }
          begin(channel, name === 'fire' ? 'fire' : 'rain', true);
          renew(channel, AMBIENT[name], amount, 0.060, 0.150, 0.200);
        });
        const snow = channels.snow, amount = amounts.snow;
        if (amount <= 0) {
          nextSnow = null; stopChannel(snow, false, 0.035);
        } else {
          if (nextSnow === null) nextSnow = now + 0.35 + random() * 1.05;
          if (snow.source && now >= snow.end) { clearTimer(snow); zero(snow); retire(snow); }
          if (!snow.source && now >= nextSnow) {
            begin(snow, 'snow' + Math.floor(random() * 3), false);
            nextSnow = now + (1.1 + random() * 2.8) / (0.65 + 0.35 * Math.sqrt(amount));
          }
          if (snow.source) renew(snow, AMBIENT.snow, amount, 0.012, 0.150, 0.200);
        }
        return true;
      } catch (error) {
        ['rain', 'fire', 'snow'].forEach(name => stopChannel(channels[name], true, 0));
        nextSnow = null; return false;
      }
    }
    function setEnabled(value) {
      const next = !!value;
      if (next !== enabled) { enabled = next; stop(true); }
      try { window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off'); } catch (error) { /* Keep in-session choice. */ }
      return enabled;
    }
    if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', () => { if (hidden()) stop(true); });
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', () => { pageHidden = true; stop(true); });
      window.addEventListener('pageshow', () => { pageHidden = false; stop(true); });
    }
    instance = Object.freeze({ unlock, gesture, ambience, stop, setEnabled, get enabled() { return enabled; } });
    return instance;
  }
  window.MaterialSound = Object.freeze({ create });
})();
