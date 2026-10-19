/* ==========================================================================
   App controller: setup screen, dice, token animation, turns, bots,
   log, announcements, win screen, sound, theme and save / resume.
   ========================================================================== */
(function () {
  'use strict';

  var SNL = window.SNL;
  var Board = window.SNLBoard;
  var Audio = window.SNLAudio;
  var CONFIG = window.SNL_CONFIG;
  var SAVE_KEY = 'snl.save.v1';
  var SETUP_KEY = 'snl.setup.v1';

  var COLORS = [
    { name: 'Red', value: '#ef4444' }, { name: 'Blue', value: '#3b82f6' },
    { name: 'Green', value: '#22c55e' }, { name: 'Amber', value: '#f59e0b' },
    { name: 'Violet', value: '#a855f7' }, { name: 'Pink', value: '#ec4899' }
  ];
  var BOT_NAMES = ['Robo Raja', 'Chip', 'Byte Baba', 'Dicey'];
  var SPEEDS = {
    relaxed: { dice: 1000, step: 270, jump: 1.25, bot: 1100 },
    normal: { dice: 760, step: 185, jump: 1, bot: 700 },
    turbo: { dice: 380, step: 85, jump: 0.5, bot: 260 }
  };
  // Die face on each side of the cube and the rotation that brings it to the front.
  var FACE_ROT = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
  var PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

  function $(id) { return document.getElementById(id); }
  var el = {
    board: $('board'), roll: $('rollBtn'), rollLabel: $('rollLabel'), die: $('die'),
    turnToken: $('turnToken'), turnEyebrow: $('turnEyebrow'), turnName: $('turnName'), turnSub: $('turnSub'),
    lastRoll: $('lastRoll'), chips: $('ruleChips'), players: $('players'), log: $('log'), moveCount: $('moveCount'),
    announcer: $('announcer'), caption: $('boardCaption'),
    setup: $('setupDialog'), setupForm: $('setupForm'), setupPlayers: $('setupPlayers'), addPlayer: $('addPlayer'),
    optExact: $('optExact'), optSix: $('optSix'), optTriple: $('optTriple'), setupError: $('setupError'),
    cancelSetup: $('cancelSetup'), resume: $('resumeBtn'),
    win: $('winDialog'), winTitle: $('winTitle'), winSub: $('winSub'), statsBody: $('statsBody'), confetti: $('confetti'),
    help: $('helpDialog'), sound: $('soundBtn'), theme: $('themeBtn')
  };

  var state = null;
  var busy = false;
  var generation = 0;          // bumps on every new game; cancels stale timers/animations
  var botTimer = null;
  var speed = 'normal';
  var paths = {};
  var tokens = [];             // SVG <g> per player
  var disp = [];               // displayed {x, y, s} per player
  var cube = { x: -20, y: 25 };
  var reducedMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var seeded = null;
  var setupRows = [];

  (function () {
    var m = /[?&]seed=(\d+)/.exec(location.search);
    if (m) seeded = SNL.mulberry32(Number(m[1]));
  })();

  function reduced() { return !!reducedMQ.matches; }
  function timing() {
    var s = SPEEDS[speed] || SPEEDS.normal;
    if (reduced()) return { dice: 0, step: 0, jump: 0, bot: Math.max(250, s.bot * 0.6) };
    return s;
  }
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function rollValue() {
    if (seeded) return SNL.rollDie(seeded);
    if (window.crypto && window.crypto.getRandomValues) {
      var b = new Uint8Array(1);
      do { window.crypto.getRandomValues(b); } while (b[0] >= 252);
      return (b[0] % 6) + 1;
    }
    return SNL.rollDie(Math.random);
  }

  /* ======================= dice ======================= */
  function buildDie() {
    var faces = [['front', 1], ['back', 6], ['right', 3], ['left', 4], ['top', 2], ['bottom', 5]];
    el.die.innerHTML = faces.map(function (f) {
      var pips = '';
      for (var i = 1; i <= 9; i++) pips += '<i class="' + (PIPS[f[1]].indexOf(i) >= 0 ? 'pip' : 'nopip') + '"></i>';
      return '<span class="face face-' + f[0] + '">' + pips + '</span>';
    }).join('');
    setCube(cube.x, cube.y, true);
  }
  function setCube(x, y, instant) {
    if (instant) el.die.style.transition = 'none';
    el.die.style.transform = 'rotateX(' + x + 'deg) rotateY(' + y + 'deg)';
    if (instant) { void el.die.offsetWidth; el.die.style.transition = ''; }
  }
  function spinDie(v) {
    var t = timing();
    var r = FACE_ROT[v];
    var tx = (Math.floor(cube.x / 360) + 2 + (Math.random() < 0.5 ? 1 : 0)) * 360 + r[0];
    var ty = (Math.floor(cube.y / 360) + 2 + (Math.random() < 0.5 ? 1 : 0)) * 360 + r[1];
    cube = { x: tx, y: ty };
    el.die.style.transitionDuration = t.dice + 'ms';
    el.roll.classList.add('rolling');
    Audio.sfx.dice();
    setCube(tx, ty, t.dice === 0);
    return wait(t.dice + 40).then(function () { el.roll.classList.remove('rolling'); });
  }

  /* ======================= tokens ======================= */
  function tween(dur, fn) {
    return new Promise(function (res) {
      if (!(dur > 0)) { fn(1); res(); return; }
      var t0 = performance.now();
      function step(now) {
        var t = Math.min(1, (now - t0) / dur);
        fn(t);
        if (t < 1) requestAnimationFrame(step); else res();
      }
      requestAnimationFrame(step);
    });
  }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function place(i, x, y, s, lift) {
    disp[i] = { x: x, y: y, s: s };
    var g = tokens[i];
    if (!g) return;
    g.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') scale(' + s.toFixed(3) + ')');
    var inner = g.firstChild;
    var l = lift || 0;
    inner.setAttribute('transform', l ? 'translate(0 ' + (-l).toFixed(1) + ') scale(' + (1 + l / 260).toFixed(3) + ')' : '');
  }

  function buildTokens() {
    var layer = $('tokenLayer');
    layer.innerHTML = '';
    tokens = [];
    disp = [];
    if (!state) return;
    state.players.forEach(function (p, i) {
      var g = Board.makeToken(p);
      layer.appendChild(g);
      tokens.push(g);
      var spot = Board.tokenSpot(0, 0, 1, i);
      place(i, spot.x, spot.y, spot.s);
    });
    layoutTokens(0);
  }

  function spots() {
    var groups = {};
    state.players.forEach(function (p, i) { (groups[p.pos] = groups[p.pos] || []).push(i); });
    var out = [];
    Object.keys(groups).forEach(function (sq) {
      var list = groups[sq];
      list.forEach(function (pi, k) { out[pi] = Board.tokenSpot(Number(sq), k, list.length, pi); });
    });
    return out;
  }

  function layoutTokens(dur) {
    var target = spots();
    var from = disp.map(function (d) { return { x: d.x, y: d.y, s: d.s }; });
    tokens.forEach(function (g, i) { g.classList.toggle('active', !!state && state.winner === null && i === state.current); });
    // Active token paints on top.
    if (state && tokens[state.current]) tokens[state.current].parentNode.appendChild(tokens[state.current]);
    return tween(dur, function (t) {
      var e = easeOut(t);
      target.forEach(function (sp, i) {
        var a = from[i];
        place(i, a.x + (sp.x - a.x) * e, a.y + (sp.y - a.y) * e, a.s + (sp.s - a.s) * e);
      });
    });
  }

  function hopTo(i, x, y, dur) {
    var a = disp[i];
    return tween(dur, function (t) {
      var e = easeInOut(t);
      place(i, a.x + (x - a.x) * e, a.y + (y - a.y) * e, a.s + (1 - a.s) * e, Math.sin(Math.PI * t) * 34);
    });
  }

  function follow(i, pts, dur) {
    var cum = [0];
    for (var k = 1; k < pts.length; k++) {
      cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
    }
    var total = cum[cum.length - 1] || 1;
    var j = 1;
    return tween(dur, function (t) {
      var d = easeInOut(t) * total;
      j = 1;
      while (j < pts.length - 1 && cum[j] < d) j++;
      var seg = (d - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1);
      place(i, pts[j - 1].x + (pts[j].x - pts[j - 1].x) * seg, pts[j - 1].y + (pts[j].y - pts[j - 1].y) * seg, 1, 6);
    });
  }

  function shake(i, dur) {
    var a = disp[i];
    return tween(dur, function (t) {
      place(i, a.x + Math.sin(t * Math.PI * 6) * 10 * (1 - t), a.y, a.s);
    });
  }

  function flash(selector) {
    var g = el.board.querySelector(selector);
    if (!g) return;
    g.classList.remove('flash');
    void g.getBoundingClientRect();
    g.classList.add('flash');
    setTimeout(function () { g.classList.remove('flash'); }, 1400);
  }

  function animateResult(r) {
    var t = timing();
    var i = r.player;
    var gen = generation;
    var g = tokens[i];
    if (g) g.parentNode.appendChild(g);
    var chain = Promise.resolve();
    if (r.forfeited) {
      Audio.sfx.blocked();
      chain = shake(i, t.step * 3).then(function () {
        if (r.to === r.from) return null;
        var c = r.to === 0 ? Board.dockSlot(i) : SNL.squareCenter(r.to);
        return hopTo(i, c.x, c.y + 6, t.step * 3);
      });
    } else if (r.blocked) {
      Audio.sfx.blocked();
      chain = shake(i, t.step * 3);
    } else {
      r.steps.forEach(function (sq, k) {
        chain = chain.then(function () {
          if (gen !== generation) return null;
          Audio.sfx.hop(k);
          var c = SNL.squareCenter(sq);
          return hopTo(i, c.x, c.y + 6, t.step);
        });
      });
      if (r.jump) {
        chain = chain.then(function () {
          if (gen !== generation) return null;
          var isLadder = r.jump.type === 'ladder';
          var pts = (paths[(isLadder ? 'L' : 'S') + r.jump.from] || []).map(function (p) { return { x: p.x, y: p.y + 6 }; });
          var length = 0;
          for (var k = 1; k < pts.length; k++) length += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
          flash('.' + (isLadder ? 'ladder' : 'snake') + '[data-from="' + r.jump.from + '"]');
          if (isLadder) Audio.sfx.ladder(); else Audio.sfx.snake();
          return wait(t.step ? 120 : 0).then(function () {
            return follow(i, pts, t.jump ? Math.max(650, length * (isLadder ? 1.1 : 1.35)) * t.jump : 0);
          });
        });
      }
    }
    return chain.then(function () {
      if (gen !== generation) return null;
      return layoutTokens(t.step ? 220 : 0);
    });
  }

  /* ======================= UI ======================= */
  function tokenHTML(p, cls) {
    return '<span class="' + (cls || 'mini-token') + '" style="--tok:' + esc(p.color) + '" aria-hidden="true">' + esc(p.name.trim().charAt(0).toUpperCase() || '?') + '</span>';
  }

  function renderTurn() {
    if (!state) return;
    var p = state.players[state.current];
    var done = state.winner !== null;
    var w = done ? state.players[state.winner] : p;
    el.turnToken.style.setProperty('--tok', w.color);
    el.turnToken.textContent = w.name.trim().charAt(0).toUpperCase();
    el.turnCard.style.setProperty('--tok', w.color);
    if (done) {
      el.turnEyebrow.textContent = 'Game over';
      el.turnName.textContent = w.name + ' wins!';
      el.turnSub.textContent = 'Play again or change players to start a new game.';
    } else {
      el.turnEyebrow.textContent = 'Turn ' + state.turn + (state.streak ? ' · bonus roll' : '');
      el.turnName.textContent = p.name + (p.name.slice(-1).toLowerCase() === 's' ? "' turn" : "'s turn");
      var where = p.pos === 0 ? 'At the start' : 'On square ' + p.pos;
      var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      var hint = p.bot ? 'Bot is rolling…' : (busy ? 'Moving…' : coarse ? 'Tap the dice to roll.' : 'Click the dice or press Space.');
      if (state.streak && !busy) hint = 'Rolled a 6, roll again!' + (p.bot ? '' : ' ');
      el.turnSub.textContent = where + ' · ' + hint;
    }
    renderControls();
  }

  function renderControls() {
    var can = !!state && !busy && state.winner === null && !state.players[state.current].bot;
    el.roll.disabled = !can;
    var label = 'Roll the dice';
    if (state && state.winner === null) {
      if (busy) label = 'Rolling…';
      else if (state.players[state.current].bot) label = 'Bot is rolling…';
    } else if (state) label = 'Game over';
    el.rollLabel.textContent = label;
  }

  function renderPlayers() {
    if (!state) { el.players.innerHTML = ''; return; }
    var lead = Math.max.apply(null, state.players.map(function (p) { return p.pos; }));
    el.players.innerHTML = state.players.map(function (p, i) {
      var cur = state.winner === null && i === state.current;
      var won = state.winner === i;
      return '<li class="player' + (cur ? ' current' : '') + (won ? ' winner' : '') + '" style="--tok:' + esc(p.color) + '"' + (cur ? ' aria-current="true"' : '') + '>' +
        tokenHTML(p) +
        '<div class="pl-main"><div class="pl-top"><span class="pl-name">' + esc(p.name) + '</span>' +
        (p.bot ? '<span class="tag">Bot</span>' : '') + (won ? '<span class="tag gold">Winner</span>' : (p.pos === lead && lead > 0 && !cur ? '<span class="tag">Leading</span>' : '')) + '</div>' +
        '<div class="pl-bar" aria-hidden="true"><span style="width:' + p.pos + '%"></span></div>' +
        '<div class="pl-stats"><span>' + (p.pos === 0 ? 'Start' : 'Square ' + p.pos) + '</span>' +
        '<span>▲ ' + plural(p.stats.ladders, 'ladder') + '</span><span>▼ ' + plural(p.stats.snakes, 'snake') + '</span></div>' +
        '</div></li>';
    }).join('');
  }

  function renderLog() {
    if (!state) { el.log.innerHTML = ''; el.moveCount.textContent = '0 moves'; return; }
    var items = state.log.slice(-80).reverse();
    el.log.setAttribute('start', String(state.moves));
    el.log.innerHTML = items.length ? items.map(function (e) {
      var p = state.players[e.player];
      var kind = e.won ? 'won' : e.forfeited || e.blocked ? 'blocked' : e.jump || '';
      return '<li class="log-item ' + kind + '" style="--tok:' + esc(p.color) + '"><span class="log-roll" aria-hidden="true">' + e.roll + '</span><span>' + esc(e.text) + '</span></li>';
    }).join('') : '<li class="log-empty">No moves yet. Roll to start!</li>';
    el.moveCount.textContent = state.moves + (state.moves === 1 ? ' move' : ' moves');
  }

  function renderChips() {
    if (!state) return;
    var o = state.options;
    var chips = [
      [o.exactFinish, 'Exact finish'],
      [o.sixExtra, '6 = extra roll'],
      [o.sixExtra && o.tripleSix, 'Three 6s forfeit']
    ];
    el.chips.innerHTML = chips.map(function (c) {
      return '<li class="chip' + (c[0] ? ' on' : '') + '">' + (c[0] ? '✓ ' : '✕ ') + c[1] + '</li>';
    }).join('');
  }

  function renderCaption() {
    if (!state) return;
    var best = state.players.slice().sort(function (a, b) { return b.pos - a.pos; })[0];
    el.caption.textContent = state.winner !== null ? state.players[state.winner].name + ' reached square 100!' :
      best.pos > 0 ? best.name + ' leads on square ' + best.pos + '. Ladders climb up, snakes slide down.' :
      'Ladders climb up, snakes slide down. First to square 100 wins.';
  }

  function renderBoardLabel() {
    var t = document.getElementById('boardTitle');
    if (!t || !state) return;
    t.textContent = 'Snakes and Ladders board. ' + state.players.map(function (p) {
      return p.name + (p.pos ? ' on square ' + p.pos : ' at the start');
    }).join(', ') + '.';
  }

  function renderAll() {
    renderBoardLabel();
    renderTurn(); renderPlayers(); renderLog(); renderChips(); renderCaption();
  }

  function announce(text) {
    el.announcer.textContent = '';
    setTimeout(function () { el.announcer.textContent = text; }, 30);
  }

  function save() {
    if (!state || state.winner !== null) store(SAVE_KEY, null);
    else store(SAVE_KEY, SNL.serialize(state));
  }

  /* ======================= turns ======================= */
  function roll(fromBot) {
    if (!state || busy || state.winner !== null) return;
    var p = state.players[state.current];
    if (!!p.bot !== !!fromBot) return;
    if (!fromBot) Audio.unlock();
    clearTimeout(botTimer);
    busy = true;
    var gen = generation;
    var v = rollValue();
    renderTurn();
    spinDie(v).then(function () {
      if (gen !== generation) return null;
      var res = SNL.playRoll(state, v);
      state = res.state;
      save();
      el.lastRoll.textContent = p.name + ' rolled ' + v;
      el.lastRoll.style.setProperty('--tok', p.color);
      renderPlayers();
      return animateResult(res.result).then(function () {
        if (gen !== generation) return;
        busy = false;
        renderAll();
        announce(res.result.text);
        if (res.result.won) {
          setTimeout(function () { if (gen === generation) showWin(); }, reduced() ? 150 : 550);
        } else {
          scheduleBot();
        }
      });
    });
  }

  function scheduleBot() {
    clearTimeout(botTimer);
    if (!state || !SNL.isBotTurn(state) || busy) return;
    var gen = generation;
    botTimer = setTimeout(function () { if (gen === generation) roll(true); }, timing().bot);
  }

  function startGame(setup, existing) {
    generation++;
    clearTimeout(botTimer);
    busy = false;
    state = existing || SNL.createGame(setup, CONFIG);
    buildTokens();
    el.lastRoll.innerHTML = '&nbsp;';
    save();
    renderAll();
    var p = state.players[state.current];
    announce((existing ? 'Game resumed. ' : 'New game. ') + p.name + ' to roll.');
    scheduleBot();
  }

  /* ======================= setup dialog ======================= */
  function defaultRows() {
    return [
      { name: 'Player 1', color: COLORS[0].value, bot: false },
      { name: BOT_NAMES[0], color: COLORS[1].value, bot: true }
    ];
  }

  function readSavedSetup() {
    try {
      var d = JSON.parse(load(SETUP_KEY) || 'null');
      if (d && Array.isArray(d.players) && d.players.length >= 2 && d.players.length <= 4) return d;
    } catch (e) { /* ignore */ }
    return null;
  }

  function renderSetupRows() {
    el.setupPlayers.innerHTML = setupRows.map(function (r, i) {
      var n = i + 1;
      var sw = COLORS.map(function (c) {
        return '<label class="sw" style="--c:' + c.value + '"><input type="radio" name="color' + n + '" value="' + c.value + '"' +
          (r.color === c.value ? ' checked' : '') + ' aria-label="' + c.name + '"><span></span></label>';
      }).join('');
      return '<fieldset class="pl-row" style="--tok:' + r.color + '" data-i="' + i + '">' +
        '<legend class="sr-only">Player ' + n + '</legend>' +
        '<span class="pl-num" aria-hidden="true">' + esc((r.name.trim().charAt(0) || n).toString().toUpperCase()) + '</span>' +
        '<label class="field"><span class="sr-only">Player ' + n + ' name</span>' +
        '<input type="text" class="name-in" maxlength="14" autocomplete="off" spellcheck="false" value="' + esc(r.name) + '" placeholder="Player ' + n + '"></label>' +
        '<div class="swatches" role="radiogroup" aria-label="Player ' + n + ' colour">' + sw + '</div>' +
        '<div class="segmented small" role="radiogroup" aria-label="Player ' + n + ' type">' +
        '<label><input type="radio" name="type' + n + '" value="human"' + (r.bot ? '' : ' checked') + '><span>Human</span></label>' +
        '<label><input type="radio" name="type' + n + '" value="bot"' + (r.bot ? ' checked' : '') + '><span>Bot</span></label></div>' +
        (setupRows.length > 2 ? '<button type="button" class="remove-btn" aria-label="Remove player ' + n + '">×</button>' : '<span class="remove-spacer" aria-hidden="true"></span>') +
        '</fieldset>';
    }).join('');
    el.addPlayer.hidden = setupRows.length >= 4;
  }

  function isDefaultName(name, i) {
    return !name.trim() || name === 'Player ' + (i + 1) || BOT_NAMES.indexOf(name) >= 0;
  }

  el.setupPlayers.addEventListener('input', function (e) {
    var row = e.target.closest('.pl-row');
    if (!row) return;
    var i = Number(row.getAttribute('data-i'));
    if (e.target.classList.contains('name-in')) {
      setupRows[i].name = e.target.value;
      row.querySelector('.pl-num').textContent = (e.target.value.trim().charAt(0) || String(i + 1)).toUpperCase();
    }
  });

  el.setupPlayers.addEventListener('change', function (e) {
    var row = e.target.closest('.pl-row');
    if (!row) return;
    var i = Number(row.getAttribute('data-i'));
    var name = e.target.name || '';
    if (name.indexOf('color') === 0) {
      var c = e.target.value;
      var other = -1;
      setupRows.forEach(function (r, k) { if (k !== i && r.color === c) other = k; });
      if (other >= 0) setupRows[other].color = setupRows[i].color;   // swap so colours stay unique
      setupRows[i].color = c;
      renderSetupRows();
      var again = el.setupPlayers.querySelector('input[name="color' + (i + 1) + '"][value="' + c + '"]');
      if (again) again.focus();
    } else if (name.indexOf('type') === 0) {
      var bot = e.target.value === 'bot';
      if (isDefaultName(setupRows[i].name, i)) setupRows[i].name = bot ? BOT_NAMES[i] : 'Player ' + (i + 1);
      setupRows[i].bot = bot;
      renderSetupRows();
      var t = el.setupPlayers.querySelector('input[name="type' + (i + 1) + '"][value="' + (bot ? 'bot' : 'human') + '"]');
      if (t) t.focus();
    }
  });

  el.setupPlayers.addEventListener('click', function (e) {
    var btn = e.target.closest('.remove-btn');
    if (!btn) return;
    var i = Number(btn.closest('.pl-row').getAttribute('data-i'));
    setupRows.splice(i, 1);
    setupRows.forEach(function (r, k) {
      if (/^Player \d$/.test(r.name)) r.name = 'Player ' + (k + 1);
    });
    renderSetupRows();
    el.addPlayer.focus();
  });

  el.addPlayer.addEventListener('click', function () {
    if (setupRows.length >= 4) return;
    var used = setupRows.map(function (r) { return r.color; });
    var free = COLORS.filter(function (c) { return used.indexOf(c.value) < 0; })[0];
    var i = setupRows.length;
    setupRows.push({ name: 'Player ' + (i + 1), color: free.value, bot: false });
    renderSetupRows();
    var inputs = el.setupPlayers.querySelectorAll('.name-in');
    if (setupRows.length >= 4) el.setupPlayers.querySelectorAll('.name-in')[i].focus();
    else if (inputs[i]) inputs[i].focus();
  });

  function syncTriple() {
    el.optTriple.disabled = !el.optSix.checked;
    el.optTriple.closest('.switch-row').classList.toggle('disabled', !el.optSix.checked);
  }
  el.optSix.addEventListener('change', syncTriple);

  function openSetup() {
    if (el.setup.open) return;
    closeAll();
    var saved = readSavedSetup();
    if (state) {
      setupRows = state.players.map(function (p) { return { name: p.name, color: p.color, bot: p.bot }; });
    } else if (saved) {
      setupRows = saved.players;
    } else {
      setupRows = defaultRows();
    }
    var opts = state ? state.options : (saved && saved.options) || SNL.DEFAULT_OPTIONS;
    el.optExact.checked = opts.exactFinish;
    el.optSix.checked = opts.sixExtra;
    el.optTriple.checked = opts.tripleSix;
    syncTriple();
    var sp = el.setupForm.querySelector('input[name="speed"][value="' + speed + '"]');
    if (sp) sp.checked = true;
    el.setupError.textContent = '';
    renderSetupRows();
    var inProgress = !!state && state.winner === null;
    el.cancelSetup.hidden = !inProgress;
    var savedGame = !state ? SNL.deserialize(load(SAVE_KEY) || '') : null;
    $('resumeBanner').hidden = !savedGame;
    if (savedGame) {
      var lead = savedGame.players.slice().sort(function (a, b) { return b.pos - a.pos; })[0];
      $('resumeInfo').textContent = savedGame.players.length + ' players · turn ' + savedGame.turn + ' · ' + lead.name + ' leads on ' + (lead.pos || 'the start') + '.';
    }
    el.setup.showModal();
    if (savedGame) el.resume.focus();
    else el.setupForm.querySelector('#startBtn').focus();
  }

  el.setupForm.addEventListener('submit', function (e) {
    e.preventDefault();
    Audio.unlock();
    var players = setupRows.map(function (r, i) {
      return { name: (r.name || '').trim().slice(0, 14) || (r.bot ? BOT_NAMES[i] : 'Player ' + (i + 1)), color: r.color, bot: r.bot };
    });
    if (players.length < 2) { el.setupError.textContent = 'Add at least two players.'; return; }
    var spEl = el.setupForm.querySelector('input[name="speed"]:checked');
    speed = spEl ? spEl.value : 'normal';
    store('snl.speed', speed);
    var setup = {
      players: players,
      options: { exactFinish: el.optExact.checked, sixExtra: el.optSix.checked, tripleSix: el.optSix.checked && el.optTriple.checked }
    };
    store(SETUP_KEY, JSON.stringify(setup));
    el.setup.close();
    startGame(setup);
  });

  el.resume.addEventListener('click', function () {
    Audio.unlock();
    var s = SNL.deserialize(load(SAVE_KEY) || '');
    el.setup.close();
    if (s) startGame(null, s);
  });
  el.cancelSetup.addEventListener('click', function () { el.setup.close(); scheduleBot(); });
  el.setup.addEventListener('cancel', function (e) {
    if (!state || state.winner !== null) e.preventDefault();   // nothing to go back to
  });
  el.setup.addEventListener('close', function () { if (state) scheduleBot(); });

  /* ======================= win dialog ======================= */
  function showWin() {
    var w = state.players[state.winner];
    el.winTitle.textContent = w.name + ' wins!';
    el.winTitle.style.setProperty('--tok', w.color);
    el.winSub.textContent = 'Reached square 100 in ' + w.stats.rolls + ' rolls · ' + w.stats.ladders +
      (w.stats.ladders === 1 ? ' ladder climbed · ' : ' ladders climbed · ') + w.stats.snakes + (w.stats.snakes === 1 ? ' snake bite survived' : ' snake bites survived');
    var order = state.players.slice().sort(function (a, b) { return (b.id === state.winner) - (a.id === state.winner) || b.pos - a.pos; });
    el.statsBody.innerHTML = order.map(function (p) {
      return '<tr' + (p.id === state.winner ? ' class="win-row"' : '') + '><th scope="row">' + tokenHTML(p) + ' ' + esc(p.name) + (p.bot ? ' <span class="tag">Bot</span>' : '') + '</th>' +
        '<td>' + (p.pos || 'Start') + '</td><td>' + p.stats.rolls + '</td><td>' + p.stats.ladders + '</td><td>' + p.stats.snakes + '</td><td>' + p.stats.sixes + '</td></tr>';
    }).join('');
    closeAll();
    el.win.showModal();
    Audio.sfx.win();
    confetti(state.players.map(function (p) { return p.color; }));
  }

  var confettiRun = 0;
  function confetti(colors) {
    var cv = el.confetti;
    var run = ++confettiRun;
    if (reduced()) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = window.innerWidth;
    var H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    var c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    var palette = colors.concat(['#fbbf24', '#fde68a', '#34d399', '#ffffff']);
    var parts = [];
    for (var i = 0; i < 190; i++) {
      var fromLeft = i % 2 === 0;
      parts.push({
        x: fromLeft ? -10 : W + 10, y: H * (0.55 + Math.random() * 0.3),
        vx: (fromLeft ? 1 : -1) * (4 + Math.random() * 9), vy: -(9 + Math.random() * 11),
        w: 6 + Math.random() * 7, h: 9 + Math.random() * 9, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        col: palette[i % palette.length], round: Math.random() < 0.3
      });
    }
    var start = performance.now();
    function frame(now) {
      if (run !== confettiRun || !el.win.open) { c.clearRect(0, 0, W, H); return; }
      c.clearRect(0, 0, W, H);
      var alive = false;
      parts.forEach(function (p) {
        p.vy += 0.32; p.vx *= 0.992; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        if (p.y < H + 30) alive = true;
        c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.fillStyle = p.col;
        if (p.round) { c.beginPath(); c.arc(0, 0, p.w / 2, 0, Math.PI * 2); c.fill(); }
        else c.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(p.r * 2)), p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);
        c.restore();
      });
      if (alive && now - start < 7000) requestAnimationFrame(frame); else c.clearRect(0, 0, W, H);
    }
    requestAnimationFrame(frame);
  }

  $('playAgain').addEventListener('click', function () {
    Audio.unlock();
    var setup = { players: state.players.map(function (p) { return { name: p.name, color: p.color, bot: p.bot }; }), options: state.options };
    el.win.close();
    startGame(setup);
  });
  $('winSetup').addEventListener('click', function () { el.win.close(); openSetup(); });

  /* ======================= help, sound, theme ======================= */
  function closeAll() {
    [el.help, el.win].forEach(function (d) { if (d.open) d.close(); });
  }
  function openHelp() { if (el.setup.open || el.win.open) return; el.help.showModal(); $('closeHelp').focus(); }
  $('helpBtn').addEventListener('click', openHelp);
  $('closeHelp').addEventListener('click', function () { el.help.close(); });
  el.help.addEventListener('click', function (e) { if (e.target === el.help) el.help.close(); });
  $('newBtn').addEventListener('click', openSetup);

  function renderSound() {
    var on = !Audio.isMuted();
    el.sound.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.sound.title = (on ? 'Sound on' : 'Sound off') + ' (M)';
  }
  function toggleSound() {
    Audio.unlock();
    Audio.setMuted(!Audio.isMuted());
    renderSound();
    announce(Audio.isMuted() ? 'Sound off' : 'Sound on');
  }
  el.sound.addEventListener('click', toggleSound);

  function renderTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    el.theme.querySelector('.sr-only').textContent = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0b1020' : '#f4efe4');
  }
  function toggleTheme() {
    var t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    store('snl.theme', t);
    renderTheme();
  }
  el.theme.addEventListener('click', toggleTheme);

  el.roll.addEventListener('click', function () { roll(false); });

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    var key = e.key;
    if (key === ' ' || key === 'Enter') {
      if (tag === 'button' || tag === 'a') return;   // native activation handles it
      e.preventDefault();
      roll(false);
    } else if (key === 'n' || key === 'N') { e.preventDefault(); openSetup(); }
    else if (key === 'm' || key === 'M') toggleSound();
    else if (key === 't' || key === 'T') toggleTheme();
    else if (key === 'h' || key === 'H' || key === '?') { e.preventDefault(); openHelp(); }
  });

  /* ======================= boot ======================= */
  el.turnCard = $('turnCard');
  var savedSpeed = load('snl.speed');
  if (SPEEDS[savedSpeed]) speed = savedSpeed;
  paths = Board.render(el.board, CONFIG);
  buildDie();
  renderSound();
  renderTheme();

  var saved = SNL.deserialize(load(SAVE_KEY) || '');
  if (saved) {
    // Show the saved position behind the setup screen.
    state = saved;
    buildTokens();
    renderAll();
    state = null;
  }
  openSetup();
  if (saved) {
    // keep the preview tokens visible until the player chooses
    state = null;
  }
})();
