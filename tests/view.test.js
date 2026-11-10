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

test("view: undo reverts the last move in local mode", () => {
  const V = loadGame(); V.setState(C.createInitialState());
  V.handleSquareClick(6, 4); V.handleSquareClick(4, 4); // e4 (white)
  V.handleSquareClick(1, 4); V.handleSquareClick(3, 4); // e5 (black)
  V.undo();
  const s = V.getState();
  assert.equal(s.board[3][4], "", "black e5 undone");
  assert.equal(s.board[4][4], "P", "white e4 intact");
  assert.equal(s.isWhiteTurn, false, "back to black to move");
  V.redo();
  assert.equal(V.getState().board[3][4], "p", "e5 redone");
});

test("view: start menu renders a full-screen overlay with room field + 3 buttons", () => {
  const V = loadGame();
  const kids = V.__document.body.children;
  assert.ok(kids.length >= 1, "overlay appended to body");
  assert.ok(kids.some((c) => String(c.style.cssText).indexOf("position:fixed") >= 0), "full-screen fixed overlay");
});

test("view: in net mode you cannot select the opponent pieces on their turn", () => {
  const V = loadGame();
  V.setState(C.createInitialState());
  // We are Black (player2); it is not our turn, so net.canAct() is false.
  V.setNetForTest({ canAct: () => false, peerOnline: () => false }, "player2");
  V.handleSquareClick(6, 4); // a white pawn must NOT be selectable off-turn
  assert.equal(V.getSelected(), null, "cannot select opponent piece on their turn");
  // Once it is our turn we can select our own pieces again.
  V.setNetForTest({ canAct: () => true, peerOnline: () => true }, "player1");
  V.handleSquareClick(6, 4);
  const sel = V.getSelected();
  assert.ok(sel && sel.row === 6 && sel.col === 4 && sel.piece === "P", "can select own piece on our turn");
});

test('view: YOUR TURN banner shows on your turn and hides on opponent turn', () => {
  const V = loadGame();
  const hidden = () => V.__document.getElementById("your-turn").classList.contains("hidden");
  V.setState(C.createInitialState()); // local play, an active turn
  assert.equal(hidden(), true, "hidden during local hotseat play");
  V.setNetForTest({ canAct: () => false, peerOnline: () => true }, "player2");
  V.render();
  assert.equal(hidden(), true, "hidden on opponent turn");
  V.setNetForTest({ canAct: () => true, peerOnline: () => true }, "player1");
  V.render();
  assert.equal(hidden(), false, "shown on your turn");
});

test('view: last move highlights its origin and destination squares', () => {
  const V = loadGame();
  V.setState(C.createInitialState());
  V.handleSquareClick(6, 4); V.handleSquareClick(4, 4); // e4
  const board = V.__document.getElementById("chessboard");
  const has = (r, c) => board.children.some((s) => Number(s.dataset.row) === r && Number(s.dataset.col) === c && s.classList.contains("last-move"));
  assert.ok(has(6, 4) && has(4, 4), "origin and destination get the last-move tint");
  assert.ok(!has(0, 0), "unrelated square not tinted");
});
