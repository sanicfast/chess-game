'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadGame, EMPTY } = require('./harness.js');

const at = (r, c) => r + ',' + c;
const keys = (moves) => new Set(moves.map((m) => at(m.row, m.col)));
const has = (moves, r, c) => moves.some((m) => m.row === r && m.col === c);
const put = (b, r, c, p) => { b[r][c] = p; return b; };

test('pawn: single + double from start, blocked when front occupied', () => {
  const G = loadGame();
  let b = EMPTY(); put(b, 6, 4, 'P'); G.setBoard(b);
  const m = G.getPossibleMoves(6, 4, 'P');
  assert.ok(has(m, 5, 4) && has(m, 4, 4), 'white pawn opens with 1 and 2 forward');
  b = EMPTY(); put(b, 6, 4, 'P'); put(b, 5, 4, 'P'); G.setBoard(b);
  const blocked = G.getPossibleMoves(6, 4, 'P');
  assert.ok(!has(blocked, 5, 4) && !has(blocked, 4, 4), 'pawn blocked by piece directly ahead');
});

test('pawn: diagonal capture only on opponent', () => {
  const G = loadGame();
  const b = EMPTY(); put(b, 4, 4, 'P'); put(b, 3, 3, 'p'); put(b, 3, 4, 'p'); G.setBoard(b);
  const m = G.getPossibleMoves(4, 4, 'P');
  assert.ok(has(m, 3, 3), 'captures opponent diagonally');
  assert.ok(!has(m, 3, 4), 'never captures straight ahead (occupied = blocked, not a capture)');
});

test('pawn: en passant driven by pawnDoubleMoveHistory', () => {
  const G = loadGame();
  const b = EMPTY(); put(b, 3, 3, 'P'); put(b, 3, 4, 'p'); G.setBoard(b);
  G.setPdHist([{ row: 3, col: 4 }]); G.setHistIndex(0);
  const m = G.getPossibleMoves(3, 3, 'P');
  assert.ok(m.some((x) => x.enPassant && x.row === 2 && x.col === 4), 'en passant capture available');
  G.setPdHist([null]); G.setHistIndex(0);
  assert.ok(!G.getPossibleMoves(3, 3, 'P').some((x) => x.enPassant), 'no en passant without a prior double move');
});

test('knight: 8 jumps, own piece removes a target', () => {
  const G = loadGame();
  let b = EMPTY(); put(b, 4, 4, 'N'); G.setBoard(b);
  const open = G.getPossibleMoves(4, 4, 'N');
  assert.equal(open.length, 8, 'knight has 8 moves on open board');
  b = EMPTY(); put(b, 4, 4, 'N'); put(b, 6, 5, 'N'); G.setBoard(b);
  assert.ok(!has(G.getPossibleMoves(4, 4, 'N'), 6, 5), 'cannot land on own piece');
});

test('rook: slides, captures first opponent, blocked beyond', () => {
  const G = loadGame();
  let b = EMPTY(); put(b, 4, 4, 'R'); G.setBoard(b);
  const open = G.getPossibleMoves(4, 4, 'R');
  assert.ok(has(open, 4, 7) && has(open, 4, 0) && has(open, 7, 4), 'slides to board edges');
  b = EMPTY(); put(b, 4, 4, 'R'); put(b, 4, 6, 'p'); G.setBoard(b);
  const cap = G.getPossibleMoves(4, 4, 'R');
  assert.ok(has(cap, 4, 5) && has(cap, 4, 6), 'moves up to and captures enemy');
  assert.ok(!has(cap, 4, 7), 'blocked beyond captured piece');
});

test('king: cannot move into an attacked square', () => {
  const G = loadGame();
  let b = EMPTY(); put(b, 7, 4, 'K'); G.setBoard(b);
  assert.ok(has(G.getPossibleMoves(7, 4, 'K'), 6, 4), 'king moves into a safe square');
  b = EMPTY(); put(b, 7, 4, 'K'); put(b, 5, 4, 'r'); G.setBoard(b);
  const m = G.getPossibleMoves(7, 4, 'K');
  assert.ok(!has(m, 6, 4), 'king cannot step into rook-attacked file');
  assert.ok(has(m, 7, 5) && has(m, 6, 3), 'king keeps safe adjacent squares');
});

test('isSquareAttacked: pawn diagonals, rook ray + blockers, duck never', () => {
  const G = loadGame();
  let b = EMPTY(); put(b, 4, 4, 'P'); G.setBoard(b);
  assert.ok(G.isSquareAttacked(3, 3, true) && G.isSquareAttacked(3, 5, true), 'white pawn attacks diagonals');
  assert.ok(!G.isSquareAttacked(3, 4, true), 'pawn does not attack straight ahead');
  b = EMPTY(); put(b, 0, 0, 'r'); G.setBoard(b);
  assert.ok(G.isSquareAttacked(0, 3, false), 'open rook ray attacks');
  put(G.getBoard(), 0, 2, 'b'); // own black bishop blocks the ray
  assert.ok(G.isSquareAttacked(0, 1, false) && !G.isSquareAttacked(0, 3, false), 'own piece blocks the ray');
  b = EMPTY(); put(b, 4, 4, 'D'); G.setBoard(b);
  assert.ok(!G.isSquareAttacked(4, 5, true) && !G.isSquareAttacked(4, 5, false), 'duck never attacks');
});

test('duck: teleports to every empty square except pickups', () => {
  const G = loadGame();
  const b = EMPTY(); put(b, 4, 4, 'D'); G.setBoard(b); G.setPickups([]);
  assert.equal(G.getDuckMoves().length, 63, 'all empty squares are duck targets');
  G.setPickups([{ row: 0, col: 0 }]);
  assert.equal(G.getDuckMoves().length, 62, 'pickup square excluded');
});

test('rotate: transform, auto-queen, color flip', () => {
  const G = loadGame();
  const find = (t) => { const b = G.getBoard(); for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (b[r][c] === t) return at(r, c); return null; };
  let b = EMPTY(); put(b, 7, 0, 'K'); put(b, 6, 7, 'P'); G.setBoard(b); G.setPickups([]); G.setDuckCd({}); G.setFlip(false);
  G.useRotateCard();
  assert.equal(find('K'), at(7, 7), 'king a1 -> h1');
  assert.equal(find('Q'), at(0, 6), 'white pawn h2 -> g8 auto-quened');
  assert.equal(find('P'), null, 'no pawn left at old spot');
  assert.equal(G.getFlip(), true, 'board color flipped');
  b = EMPTY(); put(b, 1, 0, 'p'); G.setBoard(b); G.setPickups([]); G.setDuckCd({});
  G.useRotateCard();
  assert.equal(find('q'), at(7, 1), 'black pawn -> black queen q on rank 1');
});

test('duck cooldown ticks down and expires each endTurn', () => {
  const G = loadGame();
  G.setTwoferPending(0); G.setTwoferBlocked(false); G.setWhiteTurn(true);
  G.setDuckCd({ '3,3': 2 }); G.endTurn(null);
  assert.equal(G.getDuckCd()['3,3'], 1, 'cooldown decremented');
  G.endTurn(null);
  assert.ok(!('3,3' in G.getDuckCd()), 'cooldown removed at zero');
});

test('twofer: grants an extra move without toggling turn or saving history', () => {
  const G = loadGame();
  G.setAnimating(false); G.setWhiteTurn(true); G.setTwoferPending(0); G.setTwoferBlocked(false);
  const len0 = G.getHistLen();
  G.useTwoferCard();
  assert.equal(G.getTwoferPending(), 1, 'twofer sets one pending extra move');
  assert.equal(G.getTwoferBlocked(), true, 'cards blocked after twofer');
  G.endTurn(null); // first move consumes the extra; turn must NOT toggle or save
  assert.equal(G.getWhiteTurn(), true, 'turn not toggled during twofer extra move');
  assert.equal(G.getHistLen(), len0, 'no history entry written mid-twofer');
  assert.equal(G.getTwoferBlocked(), true, 'cards still blocked until turn fully ends');
  G.endTurn(null); // second (real) move ends the turn
  assert.equal(G.getWhiteTurn(), false, 'turn toggles on the final move');
  assert.equal(G.getTwoferBlocked(), false, 'card block cleared once turn ends');
  assert.equal(G.getHistLen(), len0 + 1, 'exactly one history entry for the whole twofer turn');
});

test('undo/redo restores full state snapshots', () => {
  const G = loadGame();
  G.setTwoferBlocked(false);
  let b = EMPTY(); put(b, 7, 4, 'K'); G.setBoard(b); G.saveState(null);
  b = EMPTY(); put(b, 0, 0, 'K'); G.setBoard(b); G.saveState(null);
  G.undoMove();
  assert.equal(G.getBoard()[7][4], 'K', 'undo reverts to previous snapshot');
  G.redoMove();
  assert.equal(G.getBoard()[0][0], 'K', 'redo reapplies the later snapshot');
});

test('spawnCardPickup assigns the queued card to the new pickup', () => {
  const G = loadGame();
  G.setBoard(EMPTY()); G.setPickups([]);
  G.setQueue([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }]);
  G.spawnCardPickup();
  const p = G.getPickups();
  assert.equal(p.length, 1, 'one pickup placed');
  assert.equal(p[0].card.name, 'A', 'pickup carries the front-of-queue card');
  assert.equal(G.getQueue()[0].name, 'B', 'queue advanced past the drawn card');
});
