/* ==========================================================================
   Game engine: pure rules with no DOM access, so it can be unit tested in
   Node (see tests/engine.test.js) and reused by the browser UI.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SNL = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SIZE = 10;
  var LAST = 100;
  var CELL = 100;            // SVG units per square
  var SAVE_VERSION = 1;

  var DEFAULT_OPTIONS = { exactFinish: true, sixExtra: true, tripleSix: true };

  /* ---------- board geometry (boustrophedon: rows snake left/right) ---------- */

  // Square number (1..100) -> { row, col }, row 0 is the bottom row, col 0 the left.
  function squareToCell(n) {
    if (typeof n !== 'number' || n % 1 !== 0 || n < 1 || n > LAST) {
      throw new RangeError('Square must be an integer from 1 to ' + LAST + ', got ' + n);
    }
    var row = Math.floor((n - 1) / SIZE);
    var i = (n - 1) % SIZE;
    var col = row % 2 === 0 ? i : SIZE - 1 - i;
    return { row: row, col: col };
  }

  // { row, col } -> square number. Inverse of squareToCell.
  function cellToSquare(row, col) {
    if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) throw new RangeError('Cell out of range');
    var i = row % 2 === 0 ? col : SIZE - 1 - col;
    return row * SIZE + i + 1;
  }

  // Centre of a square in SVG coordinates (0..1000, y grows downwards).
  function squareCenter(n) {
    var c = squareToCell(n);
    return { x: c.col * CELL + CELL / 2, y: (SIZE - 1 - c.row) * CELL + CELL / 2 };
  }

  /* ---------- board validation ---------- */

  function validateBoard(board) {
    var errors = [];
    var starts = {};
    var ends = {};
    function check(map, kind) {
      Object.keys(map || {}).forEach(function (k) {
        var from = Number(k);
        var to = map[k];
        if (from < 2 || from > LAST - 1) errors.push(kind + ' at ' + from + ' must start between 2 and ' + (LAST - 1));
        if (to < 1 || to > LAST) errors.push(kind + ' at ' + from + ' ends off the board');
        if (kind === 'Ladder' && !(to > from)) errors.push('Ladder at ' + from + ' must go up');
        if (kind === 'Snake' && !(to < from)) errors.push('Snake at ' + from + ' must go down');
        if (starts[from]) errors.push('Square ' + from + ' has two starts');
        starts[from] = true;
        ends[to] = true;
      });
    }
    check(board.ladders, 'Ladder');
    check(board.snakes, 'Snake');
    Object.keys(ends).forEach(function (e) {
      if (starts[e]) errors.push('Square ' + e + ' is both an end and a start (chained jump)');
    });
    return errors;
  }

  /* ---------- randomness ---------- */

  // Small seeded PRNG for reproducible tests and replays.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rollDie(rng) {
    var r = (rng || Math.random)();
    return Math.min(6, Math.floor(r * 6) + 1);
  }

  /* ---------- game state ---------- */

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function createGame(setup, board) {
    if (!setup || !Array.isArray(setup.players)) throw new Error('setup.players is required');
    var n = setup.players.length;
    if (n < 2 || n > 4) throw new RangeError('Snakes and Ladders needs 2 to 4 players');
    board = board || {};
    var b = { ladders: clone(board.ladders || {}), snakes: clone(board.snakes || {}) };
    var errs = validateBoard(b);
    if (errs.length) throw new Error('Invalid board: ' + errs.join('; '));
    var opts = {};
    Object.keys(DEFAULT_OPTIONS).forEach(function (k) {
      opts[k] = setup.options && typeof setup.options[k] === 'boolean' ? setup.options[k] : DEFAULT_OPTIONS[k];
    });
    return {
      version: SAVE_VERSION,
      board: b,
      options: opts,
      players: setup.players.map(function (p, i) {
        return {
          id: i,
          name: String(p.name || 'Player ' + (i + 1)).slice(0, 16),
          color: p.color || '#ef4444',
          bot: !!p.bot,
          pos: 0,
          stats: { rolls: 0, sixes: 0, ladders: 0, snakes: 0 }
        };
      }),
      current: 0,
      streak: 0,        // consecutive sixes in the current turn
      turnStart: 0,     // where the current player stood when the turn began
      turn: 1,
      moves: 0,
      winner: null,
      log: []
    };
  }

  function describe(r) {
    var t;
    if (r.forfeited) {
      return r.name + ' rolled a third 6 in a row. Turn forfeited, back to ' + where(r.to) + '.';
    }
    if (r.blocked) {
      return r.name + ' rolled ' + r.roll + ' but needs exactly ' + (LAST - r.from) + ' to finish. Stays on ' + r.from + '.';
    }
    var landed = r.steps.length ? r.steps[r.steps.length - 1] : r.from;
    t = r.name + ' rolled ' + r.roll + ' and moved from ' + where(r.from) + ' to ' + landed + '.';
    if (r.jump && r.jump.type === 'ladder') t += ' Ladder! Climbs to ' + r.jump.to + '.';
    if (r.jump && r.jump.type === 'snake') t += ' Snake! Slides down to ' + r.jump.to + '.';
    if (r.won) t += ' ' + r.name + ' wins!';
    else if (r.extraTurn) t += ' Rolled a 6, so ' + r.name + ' rolls again.';
    return t;
  }
  function where(n) { return n === 0 ? 'the start' : 'square ' + n; }

  // Apply one die roll for the current player. Never mutates `state`.
  // Returns { state: newState, result: what happened (used for animation) }.
  function playRoll(state, roll) {
    if (state.winner !== null) throw new Error('The game is already over');
    if (typeof roll !== 'number' || roll % 1 !== 0 || roll < 1 || roll > 6) throw new RangeError('Roll must be 1 to 6');
    var s = clone(state);
    var o = s.options;
    var idx = s.current;
    var p = s.players[idx];
    var r = {
      player: idx, name: p.name, roll: roll, from: p.pos, to: p.pos, steps: [],
      jump: null, blocked: false, forfeited: false, extraTurn: false, won: false, next: idx
    };
    if (s.streak === 0) s.turnStart = p.pos;
    p.stats.rolls++;
    if (roll === 6) p.stats.sixes++;

    if (roll === 6 && o.sixExtra && o.tripleSix && s.streak === 2) {
      // Third six in a row: the whole turn is cancelled.
      r.forfeited = true;
      p.pos = s.turnStart;
      r.to = p.pos;
    } else {
      var target = p.pos + roll;
      if (target > LAST) {
        if (o.exactFinish) r.blocked = true;
        else target = LAST;
      }
      if (!r.blocked) {
        for (var k = p.pos + 1; k <= target; k++) r.steps.push(k);
        p.pos = target;
        if (s.board.ladders[target]) {
          r.jump = { type: 'ladder', from: target, to: s.board.ladders[target] };
          p.stats.ladders++;
        } else if (s.board.snakes[target]) {
          r.jump = { type: 'snake', from: target, to: s.board.snakes[target] };
          p.stats.snakes++;
        }
        if (r.jump) p.pos = r.jump.to;
        r.to = p.pos;
        if (p.pos === LAST) { r.won = true; s.winner = idx; }
      }
    }

    if (!r.won && !r.forfeited && roll === 6 && o.sixExtra) {
      r.extraTurn = true;
      s.streak++;
    } else {
      s.streak = 0;
      if (!r.won) {
        s.current = (idx + 1) % s.players.length;
        s.turn++;
      }
    }
    r.next = s.current;
    s.moves++;
    r.text = describe(r);
    s.log.push({ n: s.moves, player: idx, roll: roll, from: r.from, to: r.to,
      jump: r.jump ? r.jump.type : null, blocked: r.blocked, forfeited: r.forfeited,
      won: r.won, extra: r.extraTurn, text: r.text });
    if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
    return { state: s, result: r };
  }

  function isBotTurn(state) {
    return state.winner === null && !!state.players[state.current].bot;
  }

  // Play automatically until someone wins (used by tests and the demo).
  function autoPlay(state, rng, maxRolls) {
    var s = state;
    var limit = maxRolls || 20000;
    var count = 0;
    while (s.winner === null && count < limit) {
      s = playRoll(s, rollDie(rng)).state;
      count++;
    }
    return { state: s, rolls: count };
  }

  /* ---------- save / resume ---------- */

  function serialize(state) {
    return JSON.stringify({ app: 'snakes-and-ladders', version: SAVE_VERSION, savedAt: Date.now(), state: state });
  }

  function deserialize(text) {
    try {
      var d = JSON.parse(text);
      if (!d || d.app !== 'snakes-and-ladders' || d.version !== SAVE_VERSION) return null;
      var s = d.state;
      if (!s || !Array.isArray(s.players) || s.players.length < 2 || s.players.length > 4) return null;
      if (typeof s.current !== 'number' || s.current < 0 || s.current >= s.players.length) return null;
      for (var i = 0; i < s.players.length; i++) {
        var pos = s.players[i].pos;
        if (typeof pos !== 'number' || pos < 0 || pos > LAST) return null;
      }
      if (validateBoard(s.board || {}).length) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  return {
    SIZE: SIZE, LAST: LAST, CELL: CELL, DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    squareToCell: squareToCell, cellToSquare: cellToSquare, squareCenter: squareCenter,
    validateBoard: validateBoard, mulberry32: mulberry32, rollDie: rollDie,
    createGame: createGame, playRoll: playRoll, isBotTurn: isBotTurn, autoPlay: autoPlay,
    describe: describe, serialize: serialize, deserialize: deserialize
  };
});
