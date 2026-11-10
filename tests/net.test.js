const { test } = require('node:test');
const assert = require('node:assert/strict');
const Net = require('../net.js');

function pair(seed) {
  const hub = Net.memoryHub();
  const p1 = Net.createRoom({ me: 'player1', seed, transport: hub.connect() });
  const p2 = Net.createRoom({ me: 'player2', seed, transport: hub.connect() });
  return { p1, p2 };
}

test('net: both peers converge after a move', () => {
  const { p1, p2 } = pair(7);
  assert.ok(p1.canAct());
  assert.ok(!p2.canAct());
  assert.ok(p1.move({ row: 6, col: 4 }, { row: 4, col: 4 }));
  assert.equal(p2.state().board[4][4], 'P', 'peer saw the move');
  assert.equal(JSON.stringify(p1.state()), JSON.stringify(p2.state()));
  assert.equal(p1.state().isWhiteTurn, false);
});

test('net: out-of-turn submission is rejected and not broadcast', () => {
  const { p1, p2 } = pair(7);
  assert.equal(p2.move({ row: 1, col: 4 }, { row: 3, col: 4 }), false);
  assert.equal(p2.state().board[3][4], '');
  assert.equal(JSON.stringify(p1.state()), JSON.stringify(p2.state()));
});

test('net: alternating moves keep both peers byte-identical', () => {
  const { p1, p2 } = pair(3);
  p1.move({ row: 6, col: 4 }, { row: 4, col: 4 }); // e4
  p2.move({ row: 1, col: 4 }, { row: 3, col: 4 }); // e5
  p1.move({ row: 7, col: 6 }, { row: 5, col: 5 }); // Nf3
  assert.equal(JSON.stringify(p1.state()), JSON.stringify(p2.state()));
  assert.equal(p1.state().board[5][5], 'N');
});

test('net: peers detect each other (presence)', () => {
  const hub = Net.memoryHub();
  const p1 = Net.createRoom({ me: 'player1', seed: 5, transport: hub.connect() });
  assert.equal(p1.peerOnline(), false, 'no opponent yet');
  Net.createRoom({ me: 'player2', seed: 5, transport: hub.connect() });
  assert.equal(p1.peerOnline(), true, 'p1 saw p2 join');
});

test('net: a late-joining peer catches up to the in-progress game', () => {
  const hub = Net.memoryHub();
  const p1 = Net.createRoom({ me: 'player1', seed: 4, transport: hub.connect() });
  p1.move({ row: 6, col: 4 }, { row: 4, col: 4 }); // e4 played before black joins
  const p2 = Net.createRoom({ me: 'player2', seed: 4, transport: hub.connect() });
  assert.equal(p2.state().board[4][4], 'P', 'late joiner received the earlier move');
  assert.equal(JSON.stringify(p2.state()), JSON.stringify(p1.state()), "states match after catch-up");
  assert.ok(p2.canAct(), "now it is the joiner (black) turn to move");
  p2.move({ row: 1, col: 4 }, { row: 3, col: 4 }); // e5; sync continues
  assert.equal(JSON.stringify(p1.state()), JSON.stringify(p2.state()));
});
