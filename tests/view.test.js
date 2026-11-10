const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('./harness.js');
const C = require('../game/core.js');

test('view: selecting + clicking a legal square dispatches a move', () => {
  const V = loadGame(); V.setState(C.createInitialState());
  V.handleSquareClick(6, 4); V.handleSquareClick(4, 4);
  const s = V.getState();
  assert.equal(s.board[4][4], 'P');
  assert.equal(s.board[6][4], '');
  assert.equal(s.isWhiteTurn, false);
});

test('view: cannot select an opponent piece out of turn', () => {
  const V = loadGame(); V.setState(C.createInitialState());
  V.handleSquareClick(1, 4);
  assert.equal(V.getSelected(), null);
});

test('view: playing a hand card dispatches playCard (rotate)', () => {
  const V = loadGame(); V.setState(C.createInitialState({ hands: { player1: [{ id: 'rotate' }], player2: [] } }));
  V.handleCardClick(0, 'player1');
  const s = V.getState();
  assert.equal(s.boardColorInverted, true);
  assert.equal(s.hands.player1.length, 0);
  assert.equal(s.isWhiteTurn, false);
});

test('view: duck card enters targeting then places on click', () => {
  const V = loadGame(); V.setState(C.createInitialState({ hands: { player1: [{ id: 'duck' }], player2: [] } }));
  V.handleCardClick(0, 'player1');
  assert.ok(V.getPending(), 'enters targeting');
  V.handleSquareClick(4, 4);
  const s = V.getState();
  assert.equal(s.board[4][4], 'D');
  assert.equal(s.hands.player1.length, 0);
  assert.equal(s.isWhiteTurn, false);
});

test('view: twofer blocks further card plays until the turn ends', () => {
  const V = loadGame(); V.setState(C.createInitialState({ hands: { player1: [{ id: 'twofer' }, { id: 'rotate' }], player2: [] } }));
  V.handleCardClick(0, 'player1'); // twofer (consumed)
  assert.equal(V.getState().twoferCardsBlocked, true);
  V.handleCardClick(0, 'player1'); // rotate is now index 0 but must be blocked
  assert.equal(V.getState().boardColorInverted, false, 'rotate not played while blocked');
});
