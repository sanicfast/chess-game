// Duck Chess — pure game core. NO DOM, NO globals required.
// Runs in the browser (attaches globalThis.DuckChessCore) and in Node (module.exports).
// All state is plain JSON (numbers/strings/arrays/objects) so it can be serialized,
// stored, and synced for online play. Randomness is injected via an `rng` argument
// (defaults to Math.random) so the engine can be made deterministic for replay/sync.
(function (root) {
  'use strict';

  const DUCK_COOLDOWN = 2;
  const QUEUE_REFILL_SIZE = 8;
  const QUEUE_MIN_LENGTH = 4;

  const initialBoard = [
    ['r','n','b','q','k','b','n','r'],
    ['p','p','p','p','p','p','p','p'],
    ['','','','','','','',''],
    ['','','','','','','',''],
    ['','','','','','','',''],
    ['','','','','','','',''],
    ['P','P','P','P','P','P','P','P'],
    ['R','N','B','Q','K','B','N','R'],
  ];

  // Serializable card catalog — data only (no effect functions). Behavior lives in
  // the reducer, keyed by id. This is what makes hands/queue/pickups sync-safe JSON.
  const CARDS = [
    { id: 'kingify',      name: 'Kingify',            description: "Turns a random opponent piece into a king. Ends turn.", imagePath: 'assets/kingify-card-icon.png', endsTurn: true,  requiresTarget: false },
    { id: 'passedpawn',   name: 'Summon Passed Pawn', description: 'Summon a pawn onto the second to last rank. Ends turn.', imagePath: 'assets/passedpawn-card-icon.png', endsTurn: true, requiresTarget: false },
    { id: 'rewind',       name: 'Rewind',             description: "Undo opponent's last action.", imagePath: 'assets/rewind-card-icon.png', endsTurn: false, requiresTarget: false },
    { id: 'fundeleter',   name: 'Fun Deleter',        description: "Remove random card from opponent's hand.", imagePath: 'assets/delete-card-icon.png', endsTurn: true, requiresTarget: false },
    { id: 'yoink',        name: 'Yoink!',             description: "Steal a random card from opponent's hand. Ends turn.", imagePath: 'assets/steal-card-icon.jpg', endsTurn: true, requiresTarget: false },
    { id: 'blast',        name: 'Blast!',             description: 'Play all other cards. Ends turn.', imagePath: 'assets/blast-card-icon.jpg', endsTurn: true, requiresTarget: false },
    { id: 'duck',         name: 'Summon Duck',        description: 'Place a \ud83e\udd86 on the board. Ends turn.', imagePath: 'assets/duck-card-icon.jpg', endsTurn: true, requiresTarget: true },
    { id: 'pawnarmy',     name: 'Summon Pawn Army',   description: 'Replenish your rank of pawns. Ends turn.', imagePath: 'assets/summon-pawn-army.jpg', endsTurn: true, requiresTarget: false },
    { id: 'twofer',       name: 'Twofer',             description: 'Make two moves on your turn.', imagePath: 'assets/twofer-card-icon.jpg', endsTurn: false, requiresTarget: false },
    { id: 'rotate',       name: 'Rotate',             description: 'Rotate board 90 degrees.', imagePath: 'assets/rotate-card-icon.jpg', endsTurn: true, requiresTarget: false },
  ];
  const cardById = (id) => CARDS.find((c) => c.id === id);

  // ---- helpers ----
  const inBounds = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  function isOpponent(piece, isWhite) {
    if (piece === 'D') return false;
    return isWhite !== (piece === piece.toUpperCase());
  }
  function isOwnPiece(piece, isWhite) {
    if (!piece || piece === 'D') return false;
    return isWhite === (piece === piece.toUpperCase());
  }

  function isSquareAttacked(board, row, col, byWhite) {
    const ownerIsWhite = (p) => (p === p.toUpperCase());
    const belongsTo = (p) => p && p !== 'D' && ownerIsWhite(p) === byWhite;
    const pawnRow = byWhite ? row + 1 : row - 1;
    if (pawnRow >= 0 && pawnRow < 8) {
      for (const dc of [-1, 1]) {
        const pc = col + dc;
        if (pc >= 0 && pc < 8 && board[pawnRow][pc] && board[pawnRow][pc].toLowerCase() === 'p' && belongsTo(board[pawnRow][pc])) return true;
      }
    }
    for (const [dr, dc] of [[2,1],[2,-1],[1,2],[1,-2],[-2,1],[-2,-1],[-1,2],[-1,-2]]) {
      const r = row + dr, c = col + dc;
      if (inBounds(r, c) && board[r][c] && board[r][c].toLowerCase() === 'n' && belongsTo(board[r][c])) return true;
    }
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const r = row + dr, c = col + dc;
      if (inBounds(r, c) && board[r][c] && board[r][c].toLowerCase() === 'k' && belongsTo(board[r][c])) return true;
    }
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      for (let i = 1; i < 8; i++) {
        const r = row + dr * i, c = col + dc * i;
        if (!inBounds(r, c)) break;
        const p = board[r][c];
        if (p) { const pt = p.toLowerCase(); if (belongsTo(p) && (pt === 'r' || pt === 'q')) return true; break; }
      }
    }
    for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      for (let i = 1; i < 8; i++) {
        const r = row + dr * i, c = col + dc * i;
        if (!inBounds(r, c)) break;
        const p = board[r][c];
        if (p) { const pt = p.toLowerCase(); if (belongsTo(p) && (pt === 'b' || pt === 'q')) return true; break; }
      }
    }
    return false;
  }

  function getSlidingMoves(board, row, col, isWhite, directions) {
    const moves = [];
    for (const [dRow, dCol] of directions) {
      for (let i = 1; i < 8; i++) {
        const nr = row + dRow * i, nc = col + dCol * i;
        if (!inBounds(nr, nc)) break;
        const target = board[nr][nc];
        if (!target) { moves.push({ row: nr, col: nc }); }
        else { if (isOpponent(target, isWhite)) moves.push({ row: nr, col: nc }); break; }
      }
    }
    return moves;
  }

  function getStepMoves(board, row, col, isWhite, offsets) {
    const moves = [];
    for (const [dRow, dCol] of offsets) {
      const nr = row + dRow, nc = col + dCol;
      if (!inBounds(nr, nc)) continue;
      const target = board[nr][nc];
      if (!target) moves.push({ row: nr, col: nc });
      else if (isOpponent(target, isWhite)) moves.push({ row: nr, col: nc });
    }
    return moves;
  }

  function getDuckMoves(board, cardPickups) {
    const moves = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (board[r][c] === '' && !cardPickups.some((p) => p.row === r && p.col === c)) moves.push({ row: r, col: c });
    }
    return moves;
  }

  function getPossibleMoves(board, row, col, piece, lastPawnDoubleMove) {
    const moves = [];
    const isWhite = piece === piece.toUpperCase();
    if (piece.toLowerCase() === 'p') {
      const direction = isWhite ? -1 : 1;
      const startRow = isWhite ? 6 : 1;
      const nr = row + direction;
      if (nr >= 0 && nr < 8 && board[nr][col] === '') {
        moves.push({ row: nr, col });
        const twoAhead = nr + direction;
        if (row === startRow && twoAhead >= 0 && twoAhead < 8 && board[twoAhead][col] === '') moves.push({ row: twoAhead, col });
      }
      for (const captureCol of [col - 1, col + 1]) {
        if (nr >= 0 && nr < 8 && captureCol >= 0 && captureCol < 8) {
          const tp = board[nr][captureCol];
          if (tp && isOpponent(tp, isWhite)) moves.push({ row: nr, col: captureCol });
        }
      }
      if (lastPawnDoubleMove) {
        const enPassantRow = isWhite ? 3 : 4;
        const adjacentCol = lastPawnDoubleMove.col;
        if (row === enPassantRow && (col === adjacentCol - 1 || col === adjacentCol + 1)) {
          const movedPiece = board[lastPawnDoubleMove.row][lastPawnDoubleMove.col];
          if (movedPiece && isOpponent(movedPiece, isWhite)) {
            moves.push({ row: isWhite ? row - 1 : row + 1, col: adjacentCol, enPassant: true });
          }
        }
      }
    }
    if (piece.toLowerCase() === 'r') moves.push(...getSlidingMoves(board, row, col, isWhite, [[-1,0],[1,0],[0,-1],[0,1]]));
    if (piece.toLowerCase() === 'b') moves.push(...getSlidingMoves(board, row, col, isWhite, [[-1,-1],[-1,1],[1,-1],[1,1]]));
    if (piece.toLowerCase() === 'q') moves.push(...getSlidingMoves(board, row, col, isWhite, [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]));
    if (piece.toLowerCase() === 'k') {
      const enemyIsWhite = !isWhite;
      const safe = (r, c) => !isSquareAttacked(board, r, c, enemyIsWhite);
      for (const m of getStepMoves(board, row, col, isWhite, [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]])) if (safe(m.row, m.col)) moves.push(m);
      const kingRow = isWhite ? 7 : 0;
      if (row === kingRow && col === 4) {
        if (safe(kingRow,4)&&safe(kingRow,5)&&safe(kingRow,6)&&board[kingRow][5]===''&&board[kingRow][6]===''&&board[kingRow][7]===(isWhite?'R':'r')) moves.push({ row: kingRow, col: 6 });
        if (safe(kingRow,4)&&safe(kingRow,3)&&safe(kingRow,2)&&board[kingRow][3]===''&&board[kingRow][2]===''&&board[kingRow][1]===''&&board[kingRow][0]===(isWhite?'R':'r')) moves.push({ row: kingRow, col: 2 });
      }
    }
    if (piece.toLowerCase() === 'n') moves.push(...getStepMoves(board, row, col, isWhite, [[2,1],[2,-1],[1,2],[1,-2],[-2,1],[-2,-1],[-1,2],[-1,-2]]));
    return moves;
  }

  function rotateState(s) {
    const rotated = Array.from({ length: 8 }, () => Array(8).fill(''));
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) rotated[7 - c][r] = s.board[r][c];
    for (let c = 0; c < 8; c++) { if (rotated[0][c] === 'P') rotated[0][c] = 'Q'; if (rotated[7][c] === 'p') rotated[7][c] = 'q'; }
    const next = clone(s);
    next.board = rotated;
    next.cardPickups = s.cardPickups.map((p) => ({ ...p, row: 7 - p.col, col: p.row }));
    const rc = {};
    for (const key of Object.keys(s.duckCooldowns)) { const [r, c] = key.split(',').map(Number); rc[(7 - c) + ',' + r] = s.duckCooldowns[key]; }
    next.duckCooldowns = rc;
    next.boardColorInverted = !s.boardColorInverted;
    return next;
  }

  // ---- serializable GameState + pure reducer (part 1: state plumbing) ----
  const randomSpawnInterval = (rng) => (rng() < 0.5 ? 6 : 7);
  function snapshotOf(s) {
    return {
      board: clone(s.board), isWhiteTurn: s.isWhiteTurn, turnCounter: s.turnCounter,
      gameOver: s.gameOver, cardPickups: clone(s.cardPickups), cardQueue: clone(s.cardQueue),
      hands: clone(s.hands), duckCooldowns: clone(s.duckCooldowns),
      boardColorInverted: s.boardColorInverted, twoferPending: s.twoferPending,
      twoferCardsBlocked: s.twoferCardsBlocked, nextCardSpawnAt: s.nextCardSpawnAt,
      pawnDouble: s.pawnDouble ? clone(s.pawnDouble) : null,
    };
  }
  function restoreFromSnapshot(s, snap) {
    s.board = clone(snap.board); s.isWhiteTurn = snap.isWhiteTurn; s.turnCounter = snap.turnCounter;
    s.gameOver = snap.gameOver; s.cardPickups = clone(snap.cardPickups); s.cardQueue = clone(snap.cardQueue);
    s.hands = clone(snap.hands); s.duckCooldowns = clone(snap.duckCooldowns);
    s.boardColorInverted = snap.boardColorInverted; s.twoferPending = snap.twoferPending;
    s.twoferCardsBlocked = snap.twoferCardsBlocked; s.nextCardSpawnAt = snap.nextCardSpawnAt;
    s.pawnDouble = snap.pawnDouble ? clone(snap.pawnDouble) : null;
  }
  function pushSnapshot(s) {
    if (s.historyIndex < s.history.length - 1) s.history = s.history.slice(0, s.historyIndex + 1);
    s.history.push(snapshotOf(s));
    s.historyIndex = s.history.length - 1;
  }
  function refillQueue(s, rng) {
    const batch = CARDS.slice().sort(() => rng() - 0.5);
    for (const c of batch) s.cardQueue.push({ id: c.id });
  }
  function spawnPickup(s, rng) {
    const empty = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (s.board[r][c] === '' && !s.cardPickups.some((p) => p.row === r && p.col === c)) empty.push({ row: r, col: c });
    }
    if (empty.length === 0) return;
    const pick = empty[Math.floor(rng() * empty.length)];
    if (s.cardQueue.length < QUEUE_MIN_LENGTH) refillQueue(s, rng);
    const card = s.cardQueue.shift();
    s.cardPickups.push({ row: pick.row, col: pick.col, cardId: card.id });
  }
  function endTurnCore(s, rng) {
    let turnToggled = true;
    if (s.twoferPending > 0) { s.twoferPending--; turnToggled = false; }
    else { s.isWhiteTurn = !s.isWhiteTurn; s.twoferCardsBlocked = false; }
    s.turnCounter++;
    for (const key of Object.keys(s.duckCooldowns)) { s.duckCooldowns[key]--; if (s.duckCooldowns[key] <= 0) delete s.duckCooldowns[key]; }
    if (s.turnCounter >= s.nextCardSpawnAt) { spawnPickup(s, rng); s.nextCardSpawnAt = s.turnCounter + randomSpawnInterval(rng); }
    if (turnToggled) pushSnapshot(s);
    return turnToggled;
  }
  function crownClosestKing(board, kingRow, kingCol, moverIsWhite) {
    board[kingRow][kingCol] = '';
    const loserIsWhiteKingCaptured = !moverIsWhite;
    const candidates = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p !== 'D' && (loserIsWhiteKingCaptured === (p === p.toUpperCase())) && p.toLowerCase() !== 'k') candidates.push({ row: r, col: c });
    }
    if (candidates.length === 0) return;
    let best = null, minD = Infinity;
    for (const cand of candidates) { const d = (cand.row - kingRow) ** 2 + (cand.col - kingCol) ** 2; if (d < minD) { minD = d; best = cand; } }
    board[best.row][best.col] = loserIsWhiteKingCaptured ? 'K' : 'k';
  }
  function createInitialState(opts = {}) {
    const rng = opts.rng || Math.random;
    const s = {
      board: clone(initialBoard), isWhiteTurn: true, turnCounter: 0, gameOver: false,
      cardPickups: [], cardQueue: [], hands: { player1: [], player2: [] },
      duckCooldowns: {}, boardColorInverted: false, twoferPending: 0, twoferCardsBlocked: false,
      pawnDouble: null, nextCardSpawnAt: randomSpawnInterval(rng),
      history: [], historyIndex: -1,
    };
    pushSnapshot(s); // history[0] = starting position, so the first move is undoable
    return s;
  }

  function removeCard(s, by, cardId) { const h = s.hands[by]; const i = h.findIndex((c) => c.id === cardId); if (i >= 0) h.splice(i, 1); }

  function applyMove(s, action, rng) {
    const { from, to } = action;
    const piece = s.board[from.row][from.col];
    if (!piece) return s;
    let legal;
    if (piece === 'D') {
      legal = !s.duckCooldowns[from.row + ',' + from.col] && s.board[to.row][to.col] === '' && !s.cardPickups.some((p) => p.row === to.row && p.col === to.col);
    } else {
      legal = getPossibleMoves(s.board, from.row, from.col, piece, s.pawnDouble).some((m) => m.row === to.row && m.col === to.col);
    }
    if (!legal) return s;
    // En passant: pawn moving diagonally onto an empty square captures the pawn beside it.
    if (piece.toLowerCase() === 'p' && to.col !== from.col && s.board[to.row][to.col] === '') {
      s.board[to.row + (piece === 'P' ? 1 : -1)][to.col] = '';
    }
    const captured = s.board[to.row][to.col];
    if (captured && captured.toLowerCase() === 'k') crownClosestKing(s.board, to.row, to.col, s.isWhiteTurn);
    let moving = piece;
    if (piece.toLowerCase() === 'p' && to.row === (piece === 'P' ? 0 : 7)) moving = piece === 'P' ? 'Q' : 'q';
    s.board[to.row][to.col] = moving;
    s.board[from.row][from.col] = '';
    if (piece === 'D') { delete s.duckCooldowns[from.row + ',' + from.col]; s.duckCooldowns[to.row + ',' + to.col] = DUCK_COOLDOWN + 1; }
    if (piece.toLowerCase() === 'k' && Math.abs(to.col - from.col) === 2 && from.col === 4) {
      const rookStartCol = to.col === 6 ? 7 : 0, rookEndCol = to.col === 6 ? 5 : 3;
      s.board[to.row][rookEndCol] = s.board[to.row][rookStartCol];
      s.board[to.row][rookStartCol] = '';
    }
    s.pawnDouble = (piece.toLowerCase() === 'p' && Math.abs(to.row - from.row) === 2) ? { row: to.row, col: to.col } : null;
    if (piece !== 'D') {
      const idx = s.cardPickups.findIndex((p) => p.row === to.row && p.col === to.col);
      if (idx >= 0) { const pk = s.cardPickups[idx]; s.cardPickups.splice(idx, 1); const hand = s.hands[s.isWhiteTurn ? 'player1' : 'player2']; if (hand.length < 9) hand.push({ id: pk.cardId }); }
    }
    endTurnCore(s, rng);
    return s;
  }

  function playCard(s, action, rng) {
    const { by, cardId, target } = action;
    if (!s.hands[by].some((c) => c.id === cardId)) return s;
    removeCard(s, by, cardId);
    const def = cardById(cardId);
    s.pawnDouble = null;
    if (cardId === 'rotate') {
      const r = rotateState(s);
      s.board = r.board; s.cardPickups = r.cardPickups; s.duckCooldowns = r.duckCooldowns; s.boardColorInverted = r.boardColorInverted;
    } else if (cardId === 'duck') {
      if (target) s.board[target.row][target.col] = 'D';
    } else if (cardId === 'twofer') {
      s.twoferPending = 1; s.twoferCardsBlocked = true;
    } else if (cardId === 'rewind') {
      if (s.historyIndex > 0) restoreFromSnapshot(s, s.history[s.historyIndex - 1]);
      removeCard(s, by, 'rewind'); // restoring hands may have re-added the played card
    } else {
      return s; // kingify, passedpawn, fundeleter, yoink, blast, pawnarmy — migrated in Step 2.
    }
    if (def && def.endsTurn) endTurnCore(s, rng);
    else if (cardId !== 'twofer') pushSnapshot(s); // endsTurn:false cards (e.g. rewind) still record a snapshot
    return s;
  }

  // applyAction(state, action, {rng}) -> NEW state. Never mutates the input.
  function applyAction(state, action, opts = {}) {
    const rng = opts.rng || Math.random;
    const s = clone(state);
    if (s.gameOver && action.type !== 'undo' && action.type !== 'redo') return s;
    switch (action.type) {
      case 'move': return applyMove(s, action, rng);
      case 'playCard': return playCard(s, action, rng);
      case 'undo':
        if (s.twoferCardsBlocked) return s;
        if (s.historyIndex > 0) { s.historyIndex--; restoreFromSnapshot(s, s.history[s.historyIndex]); }
        return s;
      case 'redo':
        if (s.twoferCardsBlocked) return s;
        if (s.historyIndex < s.history.length - 1) { s.historyIndex++; restoreFromSnapshot(s, s.history[s.historyIndex]); }
        return s;
      default: return s;
    }
  }

  const Core = {
    CARDS, cardById, initialBoard, DUCK_COOLDOWN, inBounds, isOpponent, isOwnPiece,
    isSquareAttacked, getSlidingMoves, getStepMoves, getDuckMoves, getPossibleMoves, rotateState,
    createInitialState, applyAction,
  };
  root.DuckChessCore = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
