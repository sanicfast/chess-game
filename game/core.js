// Wacky Chess — pure game core. NO DOM, NO globals required.
// Runs in the browser (attaches globalThis.WackyChessCore) and in Node (module.exports).
// All state is plain JSON (numbers/strings/arrays/objects) so it can be serialized,
// stored, and synced for online play. Randomness is injected via an `rng` argument
// (defaults to Math.random) so the engine can be made deterministic for replay/sync.
(function (root) {
  'use strict';

  const DUCK_COOLDOWN = 2;
  const QUEUE_REFILL_SIZE = 8;
  const QUEUE_MIN_LENGTH = 4;
  const MAX_PAWN_ARMY_SUMMONS = 3;

  // Deterministic PRNG (mulberry32). Used when an action carries a numeric `seed`,
  // so a card's random choice is reproducible on every client/server — required for
  // online sync. When no seed is present we fall back to the ambient rng.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const derng = (action, fallback) => (action && Number.isInteger(action.seed) ? mulberry32(action.seed) : fallback);
  const pickIndex = (len, choice, rng) => (Number.isInteger(choice) && choice >= 0 && choice < len ? choice : Math.floor(rng() * len));

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
    next.highlight = []; // rotation invalidates the previous move's coordinates
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
      winner: s.winner, draw: s.draw,
      pawnDouble: s.pawnDouble ? clone(s.pawnDouble) : null,
      highlight: clone(s.highlight || []),
    };
  }
  function restoreFromSnapshot(s, snap) {
    s.board = clone(snap.board); s.isWhiteTurn = snap.isWhiteTurn; s.turnCounter = snap.turnCounter;
    s.gameOver = snap.gameOver; s.cardPickups = clone(snap.cardPickups); s.cardQueue = clone(snap.cardQueue);
    s.hands = clone(snap.hands); s.duckCooldowns = clone(snap.duckCooldowns);
    s.boardColorInverted = snap.boardColorInverted; s.twoferPending = snap.twoferPending;
    s.twoferCardsBlocked = snap.twoferCardsBlocked; s.nextCardSpawnAt = snap.nextCardSpawnAt;
    s.winner = snap.winner; s.draw = snap.draw;
    s.pawnDouble = snap.pawnDouble ? clone(snap.pawnDouble) : null;
    s.highlight = clone(snap.highlight || []);
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
    if (turnToggled && !s.gameOver && isActivePlayerDeadlockedCore(s)) { s.gameOver = true; s.draw = true; }
    if (turnToggled) pushSnapshot(s);
    return turnToggled;
  }

  // The side to move is deadlocked when they hold no cards, there is no ready duck,
  // and none of their pieces has a legal move — a stalemate draw.
  function isActivePlayerDeadlockedCore(s) {
    const hand = s.hands[s.isWhiteTurn ? 'player1' : 'player2'];
    if (hand.length > 0) return false;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (s.board[r][c] === 'D' && !s.duckCooldowns[r + ',' + c]) return false;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const piece = s.board[r][c]; if (isOwnPiece(piece, s.isWhiteTurn) && getPossibleMoves(s.board, r, c, piece, s.pawnDouble).length > 0) return false; }
    return true;
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
  // opts: { rng?, seed?, board?, hands?, deal?, seedPickup? } — hands must be JSON ({player1:[{id}],player2:[{id}]});
  // deal: number of random cards to deal each player at start (uses the seeded rng → identical for online peers).
  function createInitialState(opts = {}) {
    const rng = opts.seed != null ? mulberry32(opts.seed) : (opts.rng || Math.random);
    const s = {
      board: opts.board ? clone(opts.board) : clone(initialBoard), isWhiteTurn: true, turnCounter: 0, gameOver: false, winner: null, draw: false,
      cardPickups: [], cardQueue: [],
      hands: opts.hands ? clone(opts.hands) : { player1: [], player2: [] },
      duckCooldowns: {}, boardColorInverted: false, twoferPending: 0, twoferCardsBlocked: false,
      pawnDouble: null, highlight: [], nextCardSpawnAt: randomSpawnInterval(rng),
      history: [], historyIndex: -1,
    };
    if (opts.deal > 0) {
      const deal = (p) => { for (let i = 0; i < opts.deal; i++) s.hands[p].push({ id: CARDS[Math.floor(rng() * CARDS.length)].id }); };
      deal('player1'); deal('player2');
    }
    if (opts.seedPickup) spawnPickup(s, rng);
    pushSnapshot(s); // history[0] = starting position, so the first move is undoable
    return s;
  }

  function removeCard(s, by, cardId) { const h = s.hands[by]; const i = h.findIndex((c) => c.id === cardId); if (i >= 0) h.splice(i, 1); }

  function applyMove(s, action, rng) {
    const { from, to } = action;
    const piece = s.board[from.row][from.col];
    if (!piece) return s;
    // Only the player on turn may move their own pieces (the duck is neutral/communal).
    if (piece !== 'D' && !isOwnPiece(piece, s.isWhiteTurn)) return s;
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
    // Capturing a king can end the game if the loser is left with zero pieces.
    if (captured && captured.toLowerCase() === 'k') {
      const loserWhite = !s.isWhiteTurn; let loserPieces = 0;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const p = s.board[r][c]; if (p && p !== 'D' && (p === p.toUpperCase()) === loserWhite) loserPieces++; }
      if (loserPieces === 0) { s.gameOver = true; s.winner = s.isWhiteTurn ? 'White' : 'Black'; }
    }
    s.highlight = [{ row: from.row, col: from.col }, { row: to.row, col: to.col }];
    endTurnCore(s, rng);
    return s;
  }

  // Applies a single card's effect to s (no turn-end, no snapshot). ctx:
  // { target?, choice?, choices?, boardOnly? }. Random picks honor action-carried
  // choices when present (deterministic for online), else fall back to rng.
  function applyCardEffect(s, by, cardId, ctx, rng) {
    const moverWhite = by === 'player1';
    const oppBy = moverWhite ? 'player2' : 'player1';
    s.highlight = []; // a card play resets the board highlight; board-changing effects below set it
    if (cardId === 'rotate') {
      const r = rotateState(s);
      s.board = r.board; s.cardPickups = r.cardPickups; s.duckCooldowns = r.duckCooldowns; s.boardColorInverted = r.boardColorInverted;
    } else if (cardId === 'duck') {
      let t = ctx.target;
      if (!t) { const opts2 = getDuckMoves(s.board, s.cardPickups); if (opts2.length) t = opts2[Math.floor(rng() * opts2.length)]; }
      if (t) { s.board[t.row][t.col] = 'D'; s.highlight = [{ row: t.row, col: t.col }]; }
    } else if (cardId === 'twofer') {
      s.twoferPending = 1; s.twoferCardsBlocked = true;
    } else if (cardId === 'rewind') {
      if (s.historyIndex > 0) {
        if (ctx.boardOnly) s.board = clone(s.history[s.historyIndex - 1].board);
        else { restoreFromSnapshot(s, s.history[s.historyIndex - 1]); removeCard(s, by, 'rewind'); }
      }
    } else if (cardId === 'kingify') {
      const opp = [];
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const p = s.board[r][c]; if (p && p !== 'D' && (p === p.toUpperCase()) === !moverWhite && p.toLowerCase() !== 'k') opp.push({ row: r, col: c }); }
      if (opp.length) { const pick = opp[pickIndex(opp.length, ctx.choice, rng)]; s.board[pick.row][pick.col] = moverWhite ? 'k' : 'K'; s.highlight = [{ row: pick.row, col: pick.col }]; }
    } else if (cardId === 'passedpawn') {
      const row = moverWhite ? 1 : 6; const empty = []; for (let i = 0; i < 8; i++) if (s.board[row][i] === '') empty.push(i);
      if (empty.length) { const col = empty[pickIndex(empty.length, ctx.choice, rng)]; s.board[row][col] = moverWhite ? 'P' : 'p'; s.highlight = [{ row, col }]; }
    } else if (cardId === 'pawnarmy') {
      const row = moverWhite ? 6 : 1; const pawn = moverWhite ? 'P' : 'p'; const cols = []; for (let i = 0; i < 8; i++) if (s.board[row][i] === '') cols.push(i);
      const chs = Array.isArray(ctx.choices) ? ctx.choices : null; const count = Math.min(cols.length, MAX_PAWN_ARMY_SUMMONS); const placed = [];
      for (let i = 0; i < count; i++) { const pi = (chs && Number.isInteger(chs[i]) && chs[i] >= 0 && chs[i] < cols.length) ? chs[i] : Math.floor(rng() * cols.length); const col = cols[pi]; s.board[row][col] = pawn; cols.splice(pi, 1); placed.push({ row, col }); }
      s.highlight = placed;
    } else if (cardId === 'fundeleter') {
      const opp = s.hands[oppBy]; if (opp.length) opp.splice(pickIndex(opp.length, ctx.choice, rng), 1);
    } else if (cardId === 'yoink') {
      const opp = s.hands[oppBy]; const mine = s.hands[by]; if (opp.length) { const idx = pickIndex(opp.length, ctx.choice, rng); const stolen = opp.splice(idx, 1)[0]; if (mine.length < 9) mine.push(stolen); }
    }
  }

  // Blast orchestration (mutates working s in place, returns animation frames).
  // Rewinds are hoisted to fire first (board-only restore so they don't clobber the
  // blast's own board mutations); nested Blasts are left in hand (neither fired nor
  // consumed, matching observable behavior); Twofer inside Blast is a no-op but is
  // consumed; a hand snapshot means cards gained mid-Blast (Yoink) don't fire.
  function blastPlan(s, by, rng) {
    const snapshot = s.hands[by].slice();
    const rewinds = snapshot.filter((c) => c.id === 'rewind');
    const others = snapshot.filter((c) => c.id !== 'rewind' && c.id !== 'blast');
    const frames = [];
    for (const card of [...rewinds, ...others]) {
      if (card.id !== 'twofer') applyCardEffect(s, by, card.id, { boardOnly: card.id === 'rewind' }, rng);
      removeCard(s, by, card.id);
      frames.push(snapshotOf(s));
    }
    return frames;
  }

  function playCard(s, action, rng) {
    const { by, cardId } = action;
    if (s.hands[by] == null) return s;
    if ((by === 'player1') !== s.isWhiteTurn) return s; // not this player's turn
    if (!s.hands[by].some((c) => c.id === cardId)) return s;
    removeCard(s, by, cardId);
    const def = cardById(cardId);
    s.pawnDouble = null;
    if (cardId === 'blast') { blastPlan(s, by, rng); endTurnCore(s, rng); return s; }
    applyCardEffect(s, by, cardId, { target: action.target, choice: action.choice, choices: action.choices }, rng);
    if (def && def.endsTurn) endTurnCore(s, rng);
    else if (cardId !== 'twofer') pushSnapshot(s);
    return s;
  }

  // UI helper: ordered animation frames for a Blast (does not mutate the input).
  // The final frame is the post-turn-end state; the view plays them with delays.
  function blastFrames(state, action, opts = {}) {
    const rng = derng(action, opts.rng || Math.random);
    const s = clone(state);
    if (s.gameOver || s.hands[action.by] == null) return [];
    if ((action.by === 'player1') !== s.isWhiteTurn) return [];
    if (!s.hands[action.by].some((c) => c.id === 'blast')) return [];
    removeCard(s, action.by, 'blast'); s.pawnDouble = null;
    const frames = blastPlan(s, action.by, rng);
    endTurnCore(s, rng);
    frames.push(snapshotOf(s));
    return frames;
  }

  // applyAction(state, action, {rng}) -> NEW state. Never mutates the input.
  function applyAction(state, action, opts = {}) {
    const fallbackRng = opts.rng || Math.random;
    const s = clone(state);
    if (s.gameOver && action.type !== 'undo' && action.type !== 'redo') return s;
    switch (action.type) {
      case 'move': return applyMove(s, action, derng(action, fallbackRng));
      case 'playCard': return playCard(s, action, derng(action, fallbackRng));
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

  // Rebuild a game purely from an action log — the basis for online replay/sync.
  // actions: array of actions (or {actor, action} entries). opts: { seed? | rng?, hands?, seedPickup? }.
  function replay(actions, opts = {}) {
    const rng = opts.seed != null ? mulberry32(opts.seed) : (opts.rng || Math.random);
    let s = createInitialState({ rng, hands: opts.hands, deal: opts.deal, seedPickup: opts.seedPickup });
    for (const entry of actions) {
      const action = (entry && entry.action) ? entry.action : entry;
      s = applyAction(s, action, { rng });
    }
    return s;
  }

  const Core = {
    CARDS, cardById, initialBoard, DUCK_COOLDOWN, MAX_PAWN_ARMY_SUMMONS, inBounds, isOpponent, isOwnPiece,
    isSquareAttacked, getSlidingMoves, getStepMoves, getDuckMoves, getPossibleMoves, rotateState,
    isActivePlayerDeadlocked: isActivePlayerDeadlockedCore,
    createInitialState, applyAction, replay, blastFrames,
  };
  root.WackyChessCore = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
