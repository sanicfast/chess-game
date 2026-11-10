const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../game/core.js');

const EMPTY = () => Array.from({ length: 8 }, () => Array(8).fill(''));
const put = (b, r, c, p) => { b[r][c] = p; return b; };
const has = (ms, r, c) => ms.some((m) => m.row === r && m.col === c);

test('pawn: single + double from start, blocked when front occupied', () => {
  let b = EMPTY(); put(b, 6, 4, 'P');
  assert.ok(has(C.getPossibleMoves(b, 6, 4, 'P', null), 5, 4) && has(C.getPossibleMoves(b, 6, 4, 'P', null), 4, 4));
  b = EMPTY(); put(b, 6, 4, 'P'); put(b, 5, 4, 'P');
  const m = C.getPossibleMoves(b, 6, 4, 'P', null);
  assert.ok(!has(m, 5, 4) && !has(m, 4, 4));
});

test('pawn: diagonal capture only, never straight', () => {
  const b = EMPTY(); put(b, 4, 4, 'P'); put(b, 3, 3, 'p'); put(b, 3, 4, 'p');
  const m = C.getPossibleMoves(b, 4, 4, 'P', null);
  assert.ok(has(m, 3, 3));
  assert.ok(!has(m, 3, 4));
});

test('knight: 8 jumps; own piece removes a target', () => {
  let b = EMPTY(); put(b, 4, 4, 'N');
  assert.equal(C.getPossibleMoves(b, 4, 4, 'N', null).length, 8);
  b = EMPTY(); put(b, 4, 4, 'N'); put(b, 6, 5, 'N');
  assert.ok(!has(C.getPossibleMoves(b, 4, 4, 'N', null), 6, 5));
});

test('rook: slides, captures first opponent, blocked beyond', () => {
  let b = EMPTY(); put(b, 4, 4, 'R');
  const open = C.getPossibleMoves(b, 4, 4, 'R', null);
  assert.ok(has(open, 4, 7) && has(open, 4, 0) && has(open, 7, 4));
  b = EMPTY(); put(b, 4, 4, 'R'); put(b, 4, 6, 'p');
  const cap = C.getPossibleMoves(b, 4, 4, 'R', null);
  assert.ok(has(cap, 4, 5) && has(cap, 4, 6) && !has(cap, 4, 7));
});

test('king: cannot move into an attacked square', () => {
  let b = EMPTY(); put(b, 7, 4, 'K');
  assert.ok(has(C.getPossibleMoves(b, 7, 4, 'K', null), 6, 4));
  b = EMPTY(); put(b, 7, 4, 'K'); put(b, 5, 4, 'r');
  const m = C.getPossibleMoves(b, 7, 4, 'K', null);
  assert.ok(!has(m, 6, 4) && has(m, 7, 5) && has(m, 6, 3));
});

test('isSquareAttacked: pawn diagonals only', () => {
  const b = EMPTY(); put(b, 4, 4, 'P');
  assert.ok(C.isSquareAttacked(b, 3, 3, true) && C.isSquareAttacked(b, 3, 5, true));
  assert.ok(!C.isSquareAttacked(b, 3, 4, true));
});

test('isSquareAttacked: rook ray with own blocker', () => {
  const b = EMPTY(); put(b, 0, 0, 'r');
  assert.ok(C.isSquareAttacked(b, 0, 3, false));
  put(b, 0, 2, 'b');
  assert.ok(C.isSquareAttacked(b, 0, 1, false) && !C.isSquareAttacked(b, 0, 3, false));
});

test('isSquareAttacked: duck never attacks', () => {
  const b = EMPTY(); put(b, 4, 4, 'D');
  assert.ok(!C.isSquareAttacked(b, 4, 5, true) && !C.isSquareAttacked(b, 4, 5, false));
});

test('duck: teleports to every empty square except pickups', () => {
  const b = EMPTY(); put(b, 4, 4, 'D');
  assert.equal(C.getDuckMoves(b, []).length, 63);
  assert.equal(C.getDuckMoves(b, [{ row: 0, col: 0 }]).length, 62);
});
