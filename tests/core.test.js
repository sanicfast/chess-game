'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../game/core.js');

const makeRng = (seed) => { let s = seed >>> 0; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; };
const det = (seed = 1) => ({ rng: makeRng(seed) });
const EMPTY = () => Array.from({ length: 8 }, () => Array(8).fill(''));
const put = (b, r, c, p) => { b[r][c] = p; return b; };
const base = (seed = 1) => C.createInitialState(det(seed));
const withBoard = (board, extra = {}) => Object.assign(base(), { board, history: [], historyIndex: -1 }, extra);

test('CARDS catalog is pure data (serializable, no functions)', () => {
  assert.ok(C.CARDS.length >= 10);
  for (const c of C.CARDS) {
    assert.equal(typeof c.id, 'string');
    assert.equal(typeof c.effect, 'undefined', 'cards must not carry effect functions');
  }
  assert.ok(JSON.stringify(C.CARDS));
});

test('createInitialState is JSON round-trippable', () => {
  const s = base();
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.equal(s.board[0][0], 'r');
  assert.equal(s.board[7][4], 'K');
});

test('move: applies, toggles turn, records pawn double, snapshots', () => {
  const s = base();
  const n = C.applyAction(s, { type: 'move', from: { row: 6, col: 4 }, to: { row: 4, col: 4 } }, det());
  assert.equal(n.board[4][4], 'P');
  assert.equal(n.board[6][4], '');
  assert.equal(n.isWhiteTurn, false, 'turn toggled');
  assert.deepEqual(n.pawnDouble, { row: 4, col: 4 });
  assert.equal(n.history.length, 2, 'initial + after-move snapshots');
});

test('move: illegal move is rejected (no change, no toggle)', () => {
  const b = EMPTY(); put(b, 6, 4, 'P'); put(b, 5, 4, 'P');
  const s = withBoard(b);
  const n = C.applyAction(s, { type: 'move', from: { row: 6, col: 4 }, to: { row: 5, col: 4 } }, det());
  assert.equal(n.isWhiteTurn, true, 'turn not toggled');
  assert.equal(n.board[6][4], 'P');
});

test('move: auto-promotion to queen on the far rank', () => {
  const b = EMPTY(); put(b, 1, 0, 'P'); put(b, 7, 4, 'K'); put(b, 0, 4, 'k');
  const s = withBoard(b);
  const n = C.applyAction(s, { type: 'move', from: { row: 1, col: 0 }, to: { row: 0, col: 0 } }, det());
  assert.equal(n.board[0][0], 'Q', 'white pawn queened');
});

test('move: en passant captures the pawn beside it', () => {
  const b = EMPTY(); put(b, 3, 3, 'P'); put(b, 3, 4, 'p');
  const s = withBoard(b, { pawnDouble: { row: 3, col: 4 } });
  const n = C.applyAction(s, { type: 'move', from: { row: 3, col: 3 }, to: { row: 2, col: 4 } }, det());
  assert.equal(n.board[2][4], 'P');
  assert.equal(n.board[3][4], '', 'captured pawn removed');
});

test('move: king capture crowns the closest remaining enemy piece', () => {
  const b = EMPTY(); put(b, 3, 3, 'R'); put(b, 3, 4, 'k'); put(b, 4, 4, 'p'); put(b, 0, 0, 'p');
  const s = withBoard(b);
  const n = C.applyAction(s, { type: 'move', from: { row: 3, col: 3 }, to: { row: 3, col: 4 } }, det());
  assert.equal(n.board[3][4], 'R', 'rook captured the king square');
  assert.equal(n.board[4][4], 'k', 'closest black pawn crowned to king');
});

test('move: duck teleports and goes on cooldown (ticked to DUCK_COOLDOWN)', () => {
  const b = EMPTY(); put(b, 4, 4, 'D');
  const s = withBoard(b);
  const n = C.applyAction(s, { type: 'move', from: { row: 4, col: 4 }, to: { row: 2, col: 2 } }, det());
  assert.equal(n.board[2][2], 'D');
  assert.equal(n.board[4][4], '');
  assert.equal(n.duckCooldowns['2,2'], 2, 'set to DUCK_COOLDOWN+1 then endTurn tick');
  assert.equal(n.isWhiteTurn, false, 'duck move ends the turn');
});

test('playCard rotate: transform + autoqueen + pickup/duck remap + color flip', () => {
  const b = EMPTY(); put(b, 7, 0, 'K'); put(b, 6, 7, 'P');
  const s = withBoard(b, {
    hands: { player1: [{ id: 'rotate' }], player2: [] },
    cardPickups: [{ row: 0, col: 0, cardId: 'twofer' }],
    duckCooldowns: { '1,2': 2 },
  });
  const n = C.applyAction(s, { type: 'playCard', by: 'player1', cardId: 'rotate' }, det());
  assert.equal(n.board[7][7], 'K', 'a1 -> h1');
  assert.equal(n.board[0][6], 'Q', 'pawn on col7 lands row0 and queenes');
  assert.deepEqual(n.cardPickups[0], { row: 7, col: 0, cardId: 'twofer' }, 'pickup rotated');
  assert.equal(n.duckCooldowns['5,1'], 1, 'duck cooldown remapped, then ticked by the turn-ending endTurn');
  assert.ok(!('1,2' in n.duckCooldowns));
  assert.equal(n.boardColorInverted, true, 'checkerboard inverted');
  assert.equal(n.hands.player1.length, 0, 'card consumed');
});

test('playCard twofer: no toggle + atomic history across two moves', () => {
  let s = base();
  s.hands.player1 = [{ id: 'twofer' }];
  const len0 = s.history.length;
  let n = C.applyAction(s, { type: 'playCard', by: 'player1', cardId: 'twofer' }, det());
  assert.equal(n.twoferPending, 1);
  assert.equal(n.twoferCardsBlocked, true);
  assert.equal(n.isWhiteTurn, true, 'playing twofer does not toggle turn');
  n = C.applyAction(n, { type: 'move', from: { row: 6, col: 4 }, to: { row: 5, col: 4 } }, det()); // first move
  assert.equal(n.isWhiteTurn, true, 'extra move does not toggle');
  assert.equal(n.history.length, len0, 'no snapshot written mid-twofer');
  assert.equal(n.twoferCardsBlocked, true, 'cards still blocked');
  n = C.applyAction(n, { type: 'move', from: { row: 6, col: 3 }, to: { row: 5, col: 3 } }, det()); // second move
  assert.equal(n.isWhiteTurn, false, 'turn toggles on final move');
  assert.equal(n.twoferCardsBlocked, false, 'card block cleared');
  assert.equal(n.history.length, len0 + 1, 'exactly one snapshot for the whole twofer turn');
});

test('playCard rewind: restores the previous snapshot', () => {
  let s = base();
  s = C.applyAction(s, { type: 'move', from: { row: 6, col: 4 }, to: { row: 4, col: 4 } }, det()); // e4
  s.hands.player2 = [{ id: 'rewind' }]; // black to move plays rewind
  const n = C.applyAction(s, { type: 'playCard', by: 'player2', cardId: 'rewind' }, det());
  assert.equal(n.board[4][4], '', 'e4 pawn reverted');
  assert.equal(n.board[6][4], 'P', 'pawn back home');
  assert.equal(n.isWhiteTurn, true, 'back to white to move');
});

test('undo/redo are pure pointer moves over the snapshot history', () => {
  let s = base();
  s = C.applyAction(s, { type: 'move', from: { row: 6, col: 4 }, to: { row: 4, col: 4 } }, det()); // e4
  const afterE4 = C.applyAction(s, { type: 'move', from: { row: 1, col: 4 }, to: { row: 3, col: 4 } }, det()); // e5
  const u = C.applyAction(afterE4, { type: 'undo' });
  assert.equal(u.isWhiteTurn, false, 'undo -> black to move (after e4)');
  assert.equal(u.board[3][4], '', 'e5 undone');
  assert.equal(u.board[4][4], 'P', 'e4 intact');
  const r = C.applyAction(u, { type: 'redo' });
  assert.equal(r.isWhiteTurn, true);
  assert.equal(r.board[3][4], 'p', 'e5 redone');
});

test('applyAction never mutates its input', () => {
  const s = base();
  const before = JSON.stringify(s);
  C.applyAction(s, { type: 'move', from: { row: 6, col: 4 }, to: { row: 4, col: 4 } }, det());
  assert.equal(JSON.stringify(s), before, 'input state unchanged');
  assert.equal(s.board[6][4], 'P');
});

test('same rng seed replays deterministically', () => {
  const run = () => {
    let s = C.createInitialState(det(42));
    s = C.applyAction(s, { type: 'move', from: { row: 6, col: 4 }, to: { row: 4, col: 4 } }, det(42));
    s = C.applyAction(s, { type: 'move', from: { row: 1, col: 0 }, to: { row: 2, col: 0 } }, det(42));
    return JSON.stringify(s);
  };
  assert.equal(run(), run());
});

// ---- Step 2: migrated cards, ownership, blast, determinism, game over ----
const countRow = (board, r, ch) => board[r].filter((x) => x === ch).length;

test('playCard kingify: crowns chosen opponent piece (deterministic via choice)', () => {
  const b = EMPTY(); put(b, 1, 1, 'p'); put(b, 2, 2, 'r');
  const s = withBoard(b, { hands: { player1: [{ id: 'kingify' }], player2: [] } });
  const n = C.applyAction(s, { type: 'playCard', by: 'player1', cardId: 'kingify', choice: 0 }, det());
  assert.equal(n.board[1][1], 'k', 'first opponent piece crowned');
  assert.equal(n.board[2][2], 'r');
  assert.equal(n.hands.player1.length, 0);
  assert.equal(n.isWhiteTurn, false, 'ends turn');
});

test('playCard passedpawn: spawns mover pawn on the 2nd-to-last rank', () => {
  const s = withBoard(EMPTY(), { hands: { player1: [{ id: 'passedpawn' }], player2: [] } });
  const n = C.applyAction(s, { type: 'playCard', by: 'player1', cardId: 'passedpawn', choice: 3 }, det());
  assert.equal(n.board[1][3], 'P');
});

test('playCard pawnarmy: fills up to MAX_PAWN_ARMY_SUMMONS home-rank squares', () => {
  const s = withBoard(EMPTY(), { hands: { player1: [{ id: 'pawnarmy' }], player2: [] } });
  const n = C.applyAction(s, { type: 'playCard', by: 'player1', cardId: 'pawnarmy', choices: [0, 1, 2, 3, 4] }, det());
  assert.equal(countRow(n.board, 6, 'P'), C.MAX_PAWN_ARMY_SUMMONS, 'exactly 3 pawns');
});

test('playCard funDeleter: removes a chosen card from the opponent hand', () => {
  const s = withBoard(EMPTY(), { hands: { player1: [{ id: 'fundeleter' }], player2: [{ id: 'rotate' }, { id: 'duck' }] } });
  const n = C.applyAction(s, { type: 'playCard', by: 'player1', cardId: 'fundeleter', choice: 0 }, det());
  assert.equal(n.hands.player2.length, 1);
  assert.equal(n.hands.player2[0].id, 'duck', 'index-0 card removed');
});

test('playCard yoink: steals a chosen opponent card into the mover hand', () => {
  const s = withBoard(EMPTY(), { hands: { player1: [{ id: 'yoink' }], player2: [{ id: 'rotate' }, { id: 'twofer' }] } });
  const n = C.applyAction(s, { type: 'playCard', by: 'player1', cardId: 'yoink', choice: 1 }, det());
  assert.deepEqual(n.hands.player1, [{ id: 'twofer' }]);
  assert.equal(n.hands.player2.length, 1);
});

test('playCard rejects a card played out of turn', () => {
  const s = withBoard(EMPTY(), { hands: { player1: [], player2: [{ id: 'rotate' }] } });
  const n = C.applyAction(s, { type: 'playCard', by: 'player2', cardId: 'rotate' }, det());
  assert.equal(n.isWhiteTurn, true, 'turn unchanged');
  assert.equal(n.hands.player2.length, 1, 'card not consumed');
  assert.equal(n.boardColorInverted, false, 'effect not applied');
});

test('blast: consumes other cards, passespawn fires, twofer is a no-op', () => {
  const s = withBoard(EMPTY(), { hands: { player1: [{ id: 'twofer' }, { id: 'passedpawn' }, { id: 'blast' }], player2: [] } });
  const n = C.applyAction(s, { type: 'playCard', by: 'player1', cardId: 'blast' }, det());
  assert.equal(n.hands.player1.length, 0, 'all blast sub-cards consumed');
  assert.equal(n.twoferPending, 0, 'twofer inside blast does not grant an extra move');
  assert.ok(countRow(n.board, 1, 'P') === 1, 'passedpawn still fired');
  assert.equal(n.isWhiteTurn, false, 'blast ends the turn once');
});

test('blast: rewinds are hoisted before board-mutating cards', () => {
  let s = base(); // initial snapshot at history[0]
  s = C.applyAction(s, { type: 'move', from: { row: 6, col: 4 }, to: { row: 4, col: 4 } }, det()); // e4 -> history[1]
  // Black to move plays a blast whose rewind restores the pre-e4 board, then passedpawn spawns.
  s.hands.player2 = [{ id: 'passedpawn' }, { id: 'rewind' }, { id: 'blast' }];
  const n = C.applyAction(s, { type: 'playCard', by: 'player2', cardId: 'blast' }, det());
  assert.equal(n.board[6][4], 'P', 'rewind restored e2 pawn (e4 undone)');
  assert.ok(countRow(n.board, 1, 'p') >= 1, 'passedpawn fired AFTER the hoisted rewind and survived');
});

test('blastFrames: returns intermediate frames + final, without mutating input', () => {
  const s = withBoard(EMPTY(), { hands: { player1: [{ id: 'passedpawn' }, { id: 'blast' }], player2: [] } });
  const before = JSON.stringify(s);
  const frames = C.blastFrames(s, { type: 'playCard', by: 'player1', cardId: 'blast' }, det());
  assert.ok(frames.length >= 2, 'at least one sub-card frame + final');
  assert.equal(frames[frames.length - 1].isWhiteTurn, false, 'final frame is post-turn-end');
  assert.equal(JSON.stringify(s), before, 'blastFrames does not mutate input');
});

test('same seed on a random card replays identically', () => {
  const mk = () => withBoard(EMPTY(), { hands: { player1: [{ id: 'passedpawn' }], player2: [] } });
  const a = C.applyAction(mk(), { type: 'playCard', by: 'player1', cardId: 'passedpawn', seed: 123 });
  const b = C.applyAction(mk(), { type: 'playCard', by: 'player1', cardId: 'passedpawn', seed: 123 });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('capturing the last enemy piece ends the game', () => {
  const b = EMPTY(); put(b, 7, 4, 'K'); put(b, 3, 3, 'Q'); put(b, 3, 4, 'k');
  const s = withBoard(b);
  const n = C.applyAction(s, { type: 'move', from: { row: 3, col: 3 }, to: { row: 3, col: 4 } }, det());
  assert.equal(n.gameOver, true);
  assert.equal(n.winner, 'White');
});

test('a side with no cards/pieces/duck is stalemated on their turn', () => {
  const b = EMPTY(); put(b, 7, 4, 'K'); put(b, 6, 0, 'P'); // black has nothing
  const s = withBoard(b);
  const n = C.applyAction(s, { type: 'move', from: { row: 6, col: 0 }, to: { row: 5, col: 0 } }, det());
  assert.equal(n.isWhiteTurn, false, 'now black to move');
  assert.equal(n.draw, true, 'black is deadlocked -> stalemate');
  assert.equal(n.gameOver, true);
});
