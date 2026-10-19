/* Unit tests for the game engine. No dependencies: run with `node --test tests/` (Node 18+). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SNL = require('../assets/js/engine.js');
const CONFIG = require('../assets/js/config.js');

const two = (opts, bots) => SNL.createGame({
  players: [{ name: 'Asha', bot: !!(bots && bots[0]) }, { name: 'Bot', bot: !!(bots && bots[1]) }],
  options: opts
}, CONFIG);
const at = (state, idx, pos) => { const s = JSON.parse(JSON.stringify(state)); s.players[idx].pos = pos; s.current = idx; return s; };
const EMPTY = { ladders: {}, snakes: {} };

test('board coordinates: corners and boustrophedon rows', () => {
  assert.deepEqual(SNL.squareToCell(1), { row: 0, col: 0 });
  assert.deepEqual(SNL.squareToCell(10), { row: 0, col: 9 });
  assert.deepEqual(SNL.squareToCell(11), { row: 1, col: 9 });
  assert.deepEqual(SNL.squareToCell(20), { row: 1, col: 0 });
  assert.deepEqual(SNL.squareToCell(21), { row: 2, col: 0 });
  assert.deepEqual(SNL.squareToCell(91), { row: 9, col: 9 });
  assert.deepEqual(SNL.squareToCell(100), { row: 9, col: 0 });
  assert.deepEqual(SNL.squareCenter(1), { x: 50, y: 950 });
  assert.deepEqual(SNL.squareCenter(100), { x: 50, y: 50 });
  assert.deepEqual(SNL.squareCenter(91), { x: 950, y: 50 });
});

test('board coordinates: every square maps to a unique cell and back', () => {
  const seen = new Set();
  for (let n = 1; n <= 100; n++) {
    const c = SNL.squareToCell(n);
    assert.equal(SNL.cellToSquare(c.row, c.col), n);
    seen.add(c.row + ',' + c.col);
    if (n > 1) {
      // consecutive squares are always orthogonal neighbours
      const p = SNL.squareToCell(n - 1);
      assert.equal(Math.abs(p.row - c.row) + Math.abs(p.col - c.col), 1, 'squares ' + (n - 1) + ' and ' + n + ' touch');
    }
  }
  assert.equal(seen.size, 100);
  assert.throws(() => SNL.squareToCell(0), RangeError);
  assert.throws(() => SNL.squareToCell(101), RangeError);
});

test('board config is valid and balanced', () => {
  assert.deepEqual(SNL.validateBoard(CONFIG), []);
  assert.ok(Object.keys(CONFIG.ladders).length >= 8);
  assert.ok(Object.keys(CONFIG.snakes).length >= 8);
  assert.ok(SNL.validateBoard({ ladders: { 10: 5 }, snakes: {} }).length, 'ladder going down is rejected');
  assert.ok(SNL.validateBoard({ ladders: { 10: 20 }, snakes: { 20: 3 } }).length, 'chained jump is rejected');
  assert.ok(SNL.validateBoard({ ladders: {}, snakes: { 100: 3 } }).length, 'snake on 100 is rejected');
});

test('createGame validates players', () => {
  assert.throws(() => SNL.createGame({ players: [{}] }, CONFIG), RangeError);
  assert.throws(() => SNL.createGame({ players: [{}, {}, {}, {}, {}] }, CONFIG), RangeError);
  const g = SNL.createGame({ players: [{}, {}, {}] }, CONFIG);
  assert.equal(g.players.length, 3);
  assert.ok(g.players.every(p => p.pos === 0));
  assert.deepEqual(g.options, SNL.DEFAULT_OPTIONS);
});

test('normal move steps square by square and passes the turn', () => {
  const g = two({ sixExtra: false });
  const { state, result } = SNL.playRoll(g, 2);
  assert.deepEqual(result.steps, [1, 2]);
  assert.equal(state.players[0].pos, 2);
  assert.equal(result.jump, null);
  assert.equal(state.current, 1);
  assert.equal(result.next, 1);
  assert.equal(g.players[0].pos, 0, 'original state is not mutated');
});

test('ladder: landing on the foot climbs to the top', () => {
  const g = at(two(), 0, 1);
  const { state, result } = SNL.playRoll(g, 2);          // 1 + 2 = 3 -> ladder to 22
  assert.deepEqual(result.jump, { type: 'ladder', from: 3, to: 22 });
  assert.equal(state.players[0].pos, 22);
  assert.equal(state.players[0].stats.ladders, 1);
  assert.match(result.text, /Ladder! Climbs to 22/);
});

test('snake: landing on the head slides to the tail', () => {
  const g = at(two(), 0, 95 - 4);
  const { state, result } = SNL.playRoll(g, 4);          // 95 -> 75
  assert.deepEqual(result.jump, { type: 'snake', from: 95, to: 75 });
  assert.equal(state.players[0].pos, 75);
  assert.equal(state.players[0].stats.snakes, 1);
});

test('every ladder and snake in the config fires', () => {
  const jumps = Object.assign({}, CONFIG.ladders, CONFIG.snakes);
  Object.keys(jumps).forEach(k => {
    const from = Number(k);
    const g = at(two({ sixExtra: false }), 0, from - 2);
    const { state } = SNL.playRoll(g, 2);
    assert.equal(state.players[0].pos, jumps[k], 'jump from ' + from);
  });
});

test('exact finish ON: overshooting 100 stays put', () => {
  const g = at(two({ exactFinish: true, sixExtra: false }), 0, 97);
  const r = SNL.playRoll(g, 5);
  assert.equal(r.result.blocked, true);
  assert.equal(r.state.players[0].pos, 97);
  assert.deepEqual(r.result.steps, []);
  assert.equal(r.state.current, 1, 'turn passes');
  const w = SNL.playRoll(g, 3);
  assert.equal(w.result.won, true);
  assert.equal(w.state.winner, 0);
});

test('exact finish OFF: overshooting still wins', () => {
  const g = at(two({ exactFinish: false, sixExtra: false }), 0, 97);
  const r = SNL.playRoll(g, 6);
  assert.equal(r.result.blocked, false);
  assert.equal(r.state.players[0].pos, 100);
  assert.equal(r.state.winner, 0);
  assert.throws(() => SNL.playRoll(r.state, 2), /over/);
});

test('six gives an extra turn when the option is on', () => {
  const on = SNL.playRoll(two({ sixExtra: true }), 6);
  assert.equal(on.result.extraTurn, true);
  assert.equal(on.state.current, 0);
  assert.equal(on.state.streak, 1);
  const off = SNL.playRoll(two({ sixExtra: false }), 6);
  assert.equal(off.result.extraTurn, false);
  assert.equal(off.state.current, 1);
  const five = SNL.playRoll(two({ sixExtra: true }), 5);
  assert.equal(five.state.current, 1);
});

test('three sixes in a row forfeit the turn and undo it', () => {
  const g0 = SNL.createGame({ players: [{}, {}] }, EMPTY);
  let s = at(g0, 0, 10);
  s = SNL.playRoll(s, 6).state;           // 16, roll again
  assert.equal(s.players[0].pos, 16);
  s = SNL.playRoll(s, 6).state;           // 22, roll again
  assert.equal(s.players[0].pos, 22);
  const r = SNL.playRoll(s, 6);           // third six
  assert.equal(r.result.forfeited, true);
  assert.equal(r.state.players[0].pos, 10, 'back to where the turn began');
  assert.equal(r.state.current, 1, 'turn passes');
  assert.equal(r.state.streak, 0);
});

test('triple-six rule OFF: a third six just moves and rolls again', () => {
  let s = at(SNL.createGame({ players: [{}, {}], options: { tripleSix: false } }, EMPTY), 0, 10);
  s = SNL.playRoll(s, 6).state;
  s = SNL.playRoll(s, 6).state;
  const r = SNL.playRoll(s, 6);
  assert.equal(r.result.forfeited, false);
  assert.equal(r.state.players[0].pos, 28);
  assert.equal(r.state.current, 0);
});

test('a non-six between sixes resets the streak', () => {
  let s = at(SNL.createGame({ players: [{}, {}] }, EMPTY), 0, 10);
  s = SNL.playRoll(s, 6).state;           // 16
  s = SNL.playRoll(s, 2).state;           // 18, turn passes
  assert.equal(s.current, 1);
  assert.equal(s.streak, 0);
});

test('bot turns are detected and play automatically', () => {
  const g = two({}, [false, true]);
  assert.equal(SNL.isBotTurn(g), false);
  const after = SNL.playRoll(g, 2).state;
  assert.equal(SNL.isBotTurn(after), true);
  const allBots = SNL.createGame({ players: [{ bot: true }, { bot: true }, { bot: true }] }, CONFIG);
  const done = SNL.autoPlay(allBots, SNL.mulberry32(99));
  assert.notEqual(done.state.winner, null);
  assert.equal(SNL.isBotTurn(done.state), false, 'no bot turn after the game ends');
});

test('full auto-played games always reach a winner on square 100', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const players = 2 + (seed % 3);
    const g = SNL.createGame({ players: Array.from({ length: players }, () => ({ bot: true })), options: { exactFinish: seed % 2 === 0 } }, CONFIG);
    const { state, rolls } = SNL.autoPlay(g, SNL.mulberry32(seed));
    assert.notEqual(state.winner, null, 'seed ' + seed);
    assert.equal(state.players[state.winner].pos, 100);
    assert.ok(state.players.every((p, i) => i === state.winner || p.pos < 100));
    assert.equal(state.moves, rolls);
  }
});

test('dice are fair-ish and always 1 to 6', () => {
  const rng = SNL.mulberry32(2026);
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 60000; i++) {
    const v = SNL.rollDie(rng);
    assert.ok(v >= 1 && v <= 6);
    counts[v - 1]++;
  }
  counts.forEach(c => assert.ok(Math.abs(c - 10000) < 400, 'count ' + c));
});

test('save and resume round-trips the full game', () => {
  let s = SNL.createGame({ players: [{ name: 'A' }, { name: 'B', bot: true }, { name: 'C' }] }, CONFIG);
  const rng = SNL.mulberry32(5);
  for (let i = 0; i < 25; i++) s = SNL.playRoll(s, SNL.rollDie(rng)).state;
  const text = SNL.serialize(s);
  const back = SNL.deserialize(text);
  assert.deepEqual(back, s);
  // continuing from the restored game gives identical results
  assert.deepEqual(SNL.playRoll(back, 4), SNL.playRoll(s, 4));
  assert.equal(SNL.deserialize('not json'), null);
  assert.equal(SNL.deserialize('{"app":"other"}'), null);
  const bad = JSON.parse(text); bad.state.players[0].pos = 150;
  assert.equal(SNL.deserialize(JSON.stringify(bad)), null);
});

test('move log records every roll', () => {
  let s = two({ sixExtra: false });
  s = SNL.playRoll(s, 3).state;
  s = SNL.playRoll(s, 2).state;
  assert.equal(s.log.length, 2);
  assert.equal(s.log[0].player, 0);
  assert.equal(s.log[1].player, 1);
  assert.match(s.log[0].text, /Asha rolled 3/);
});
