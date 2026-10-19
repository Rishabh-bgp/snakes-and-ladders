/* ==========================================================================
   Sound effects synthesized live with the Web Audio API (no audio files).
   The AudioContext is only created after a user gesture.
   ========================================================================== */
(function (root) {
  'use strict';
  var ctx = null;
  var master = null;
  var muted = false;
  try { muted = localStorage.getItem('snl.muted') === '1'; } catch (e) { /* storage blocked */ }

  // Call from inside a click / key handler so browsers allow audio.
  function unlock() {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function ready() { return ctx && master && !muted && ctx.state === 'running'; }

  function tone(freq, start, dur, type, vol, endFreq) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, start);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(master);
    o.start(start); o.stop(start + dur + 0.02);
  }

  function noiseBurst(start, dur, vol, freq) {
    var n = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq || 2400; bp.Q.value = 1.2;
    var g = ctx.createGain(); g.gain.value = vol || 0.5;
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(start);
  }

  var sfx = {
    dice: function () {
      if (!ready()) return;
      var t = ctx.currentTime;
      for (var i = 0; i < 7; i++) noiseBurst(t + i * 0.07 + Math.random() * 0.03, 0.05, 0.55 - i * 0.05, 1800 + Math.random() * 1600);
      tone(180, t + 0.55, 0.08, 'triangle', 0.25);
    },
    hop: function (i) {
      if (!ready()) return;
      var t = ctx.currentTime;
      tone(520 + (i || 0) * 40, t, 0.09, 'sine', 0.18, 820 + (i || 0) * 40);
    },
    ladder: function () {
      if (!ready()) return;
      var t = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach(function (f, i) { tone(f, t + i * 0.09, 0.22, 'square', 0.09); tone(f * 2, t + i * 0.09, 0.15, 'sine', 0.05); });
    },
    snake: function () {
      if (!ready()) return;
      var t = ctx.currentTime;
      var o = ctx.createOscillator();
      var lfo = ctx.createOscillator();
      var lfoGain = ctx.createGain();
      var lp = ctx.createBiquadFilter();
      var g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(720, t);
      o.frequency.exponentialRampToValueAtTime(90, t + 0.85);
      lfo.frequency.value = 14; lfoGain.gain.value = 30;
      lfo.connect(lfoGain); lfoGain.connect(o.frequency);
      lp.type = 'lowpass'; lp.frequency.value = 1600;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(lp); lp.connect(g); g.connect(master);
      o.start(t); lfo.start(t); o.stop(t + 0.95); lfo.stop(t + 0.95);
      noiseBurst(t, 0.35, 0.25, 5200);
    },
    blocked: function () {
      if (!ready()) return;
      var t = ctx.currentTime;
      tone(220, t, 0.14, 'square', 0.1); tone(180, t + 0.15, 0.2, 'square', 0.1);
    },
    win: function () {
      if (!ready()) return;
      var t = ctx.currentTime;
      var notes = [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.36], [783.99, 0.56], [1046.5, 0.68]];
      notes.forEach(function (n) { tone(n[0], t + n[1], 0.3, 'triangle', 0.22); tone(n[0] / 2, t + n[1], 0.3, 'sine', 0.12); });
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f) { tone(f, t + 0.9, 1.1, 'triangle', 0.1); });
    }
  };

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('snl.muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  root.SNLAudio = { unlock: unlock, sfx: sfx, setMuted: setMuted, isMuted: function () { return muted; } };
})(typeof self !== 'undefined' ? self : this);
