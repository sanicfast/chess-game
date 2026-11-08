const board = document.getElementById("chessboard");

const pieceClasses = {
  p: 'black-pawn',  r: 'black-rook',  n: 'black-knight',  b: 'black-bishop',  q: 'black-queen',  k: 'black-king',
  P: 'white-pawn',  R: 'white-rook',  N: 'white-knight',  B: 'white-bishop',  Q: 'white-queen',  K: 'white-king'
};

const initialBoard = [
  ["r","n","b","q","k","b","n","r"],
  ["p","p","p","p","p","p","p","p"],
  ["","","","","","","",""],
  ["","","","","","","",""],
  ["","","","","","","",""],
  ["","","","","","","",""],
  ["P","P","P","P","P","P","P","P"],
  ["R","N","B","Q","K","B","N","R"]
];

// const initialBoard = [
//   ["","","","","","","",""],
//   ["","","","","","","",""],
//   ["","","","","n","N","",""],
//   ["","k","k","k","K","K","K",""],
//   ["","","","","","","",""],
//   ["","","","","","","",""],
//   ["","","","","","","",""],
//   ["","","","","","","",""],
// ];

const BLAST_STEP_DELAY_MS = 1500; // Pause between each card fired by Blast, so effects are visible one at a time.

const cardTypes = [
  { name: "Kingify", effect: useKingifyCard, description: "Turns a random opponent piece into a king. Ends turn.", imagePath: 'assets/kingify-card-icon.png'},
  { name: "Summon Passed Pawn", effect: usePassedPawnCard, description: "Summon a pawn onto the second to last rank. Ends turn.", imagePath: 'assets/passedpawn-card-icon.png'},
  { name: "Rewind", effect: useRewindCard, endsTurn: false, description: "Undo opponent's last action.", imagePath: 'assets/rewind-card-icon.png'},
  { name: "Fun Deleter", effect: useFunDeleterCard, description: "Remove random card from opponent's hand.", imagePath: 'assets/delete-card-icon.png'},
  { name: "Yoink!", effect: useYoinkCard, description: "Steal a random card from opponent's hand. Ends turn.", imagePath: 'assets/steal-card-icon.jpg'},
  { name: "Blast!", effect: useBlastCard, description: "Play all other cards. Ends turn.", imagePath: 'assets/blast-card-icon.jpg'},
  { name: "Summon Duck", effect: useDuckCard, getTargets: getValidDuckPlacementSquares, requiresTarget: true, description: "Place a 🦆 on the board. Ends turn.", imagePath: 'assets/duck-card-icon.jpg'},
  { name: "Summon Pawn Army", effect: usePawnArmyCard, description: "Replenish your rank of pawns. Ends turn.", imagePath: 'assets/summon-pawn-army.jpg'},
  { name: "Twofer", effect: useTwoferCard, endsTurn: false, description: "Make two moves on your turn.", imagePath: 'assets/twofer-card-icon.png'},
  { name: "Rotate", effect: useRotateCard, description: "Rotate board 90 degrees.", imagePath: 'assets/rotate-card-icon.png'},
];
let player1Hand = [];
let player2Hand = [];

let currentBoard = JSON.parse(JSON.stringify(initialBoard)); 
let selectedSquare = null;
let possibleMoves = [];
let isWhiteTurn = true; // Track whose turn it is (true = white, false = black)
let gameOver = false;
let isAnimating = false; // True while a sequenced effect (e.g. Blast) is playing out
let boardFlipped = false; // When true, board renders from Black's perspective
let cardPickups = []; // Array of {row, col, card} — face-down cards on the board waiting to be collected
let turnCounter = 0; // Total turns elapsed
let pendingPlacement = null; // When set, we're in card-targeting mode: { card, index, player, validTargets }

function randomSpawnInterval() {
  return Math.random() < 0.5 ? 6 : 7;
}
let nextCardSpawnAt = randomSpawnInterval(); // Turn number at which the next card pickup spawns
let duckCooldowns = {}; // Maps "row,col" → turns remaining before this duck can move again
const DUCK_COOLDOWN = 2; // Turns a duck must wait after moving before it can move again
let twoferPending = 0; // Extra moves remaining (endTurn skips toggle while > 0)
let twoferCardsBlocked = false; // Block card plays after Twofer until turn actually toggles
let boardColorInverted = false; // When true, light/dark checkerboard colors are swapped (from Rotate)
const MAX_PAWN_ARMY_SUMMONS = 3; // Max pawns Summon Pawn Army can spawn in one play

// Shared draw queue: each pickup gets its card assigned at spawn time for deterministic draws.
let cardQueue = []; // Upcoming card draws (shift from front)
const QUEUE_REFILL_SIZE = 8; // How many cards to add per refill batch
const QUEUE_MIN_LENGTH = 4; // Refill when queue drops below this

function refillQueue() {
  const batch = [...cardTypes].sort(() => Math.random() - 0.5);
  cardQueue.push(...batch.map(c => ({ ...c })));
}

// History for undo/redo
let boardHistory = [];
let turnHistory = [];
let pawnDoubleMoveHistory = [];
let handHistory = []; // each entry: [p1HandCopy, p2HandCopy]
let pickupHistory = []; // each entry: array of {row, col, card}
let cardQueueHistory = []; // each entry: array copy of cardQueue
let turnCounterHistory = []; // each entry: integer
let nextCardSpawnAtHistory = []; // each entry: integer — the next spawn turn at that point in time
let duckCooldownHistory = []; // each entry: plain object copy of duckCooldowns
let twoferPendingHistory = []; // each entry: integer
let twoferCardsBlockedHistory = []; // each entry: boolean
let boardColorInvertedHistory = []; // each entry: boolean
let historyIndex = -1; // Use -1 to indicate an empty history stack

function createBoard() {
  board.innerHTML = "";
  const turnIndicator = document.getElementById("turn-indicator");
  if (turnIndicator) {
    turnIndicator.textContent = isWhiteTurn ? "White's turn" : "Black's turn";
  }

  for (let vi = 0; vi < 8; vi++) {
    for (let vj = 0; vj < 8; vj++) {
      const row = boardFlipped ? 7 - vi : vi;
      const col = boardFlipped ? 7 - vj : vj;
      const square = document.createElement("div");
      square.classList.add("square");

      const isLight = ((row + col) % 2 === 0) !== boardColorInverted;
      if (isLight) {
        square.classList.add("light");
      } else {
        square.classList.add("dark");
      }

      if (selectedSquare && selectedSquare.row === row && selectedSquare.col === col) {
        square.classList.add("selected");
      }

      const isPossibleMove = possibleMoves.some(move => move.row === row && move.col === col);
      if (isPossibleMove) {
        square.classList.add("possible-move");
      }

      // Highlight valid target squares during card targeting mode
      if (pendingPlacement && pendingPlacement.validTargets.some(p => p.row === row && p.col === col)) {
        square.classList.add("targetable");
      }

      const piece = currentBoard[row][col];
      if (piece) {
        if (piece === 'D') {
          square.classList.add("duck");
          if (duckCooldowns[`${row},${col}`]) {
            square.classList.add("duck-cooldown");
          }
        } else {
          // Find the corresponding CSS class from the new mapping
          const pieceClass = pieceClasses[piece];
          if (pieceClass) {
            square.classList.add(pieceClass);
          }
        }
      } else if (cardPickups.some(p => p.row === row && p.col === col)) {
        // Empty square with a face-down card on it
        square.classList.add("card-pickup");
      }      

      square.dataset.row = row;
      square.dataset.col = col;

      square.addEventListener("click", () => handleSquareClick(row, col));

      board.appendChild(square);
    }
  }
}

function saveState(lastPawnDoubleMove) {
  // If we've undone moves, clear the "future" history before saving a new state
  if (historyIndex < boardHistory.length - 1) {
    boardHistory = boardHistory.slice(0, historyIndex + 1);
    turnHistory = turnHistory.slice(0, historyIndex + 1);
    pawnDoubleMoveHistory = pawnDoubleMoveHistory.slice(0, historyIndex + 1);
    handHistory = handHistory.slice(0, historyIndex + 1);
    pickupHistory = pickupHistory.slice(0, historyIndex + 1);
    turnCounterHistory = turnCounterHistory.slice(0, historyIndex + 1);
    nextCardSpawnAtHistory = nextCardSpawnAtHistory.slice(0, historyIndex + 1);
    duckCooldownHistory = duckCooldownHistory.slice(0, historyIndex + 1);
    cardQueueHistory = cardQueueHistory.slice(0, historyIndex + 1);
    twoferPendingHistory = twoferPendingHistory.slice(0, historyIndex + 1);
    twoferCardsBlockedHistory = twoferCardsBlockedHistory.slice(0, historyIndex + 1);
    boardColorInvertedHistory = boardColorInvertedHistory.slice(0, historyIndex + 1);
  }
  boardHistory.push(JSON.parse(JSON.stringify(currentBoard)));
  turnHistory.push(isWhiteTurn);
  pawnDoubleMoveHistory.push(lastPawnDoubleMove);
  // Shallow-copy each card so future splices/mutations on the live hand don't corrupt history.
  // Can't use JSON round-trip because cards hold a function reference (effect).
  handHistory.push([
    player1Hand.map(c => ({ ...c })),
    player2Hand.map(c => ({ ...c })),
  ]);
  pickupHistory.push(cardPickups.map(p => ({ ...p, card: { ...p.card } })));
  turnCounterHistory.push(turnCounter);
  nextCardSpawnAtHistory.push(nextCardSpawnAt);
  duckCooldownHistory.push({ ...duckCooldowns });
  cardQueueHistory.push([...cardQueue]);
  twoferPendingHistory.push(twoferPending);
  twoferCardsBlockedHistory.push(twoferCardsBlocked);
  boardColorInvertedHistory.push(boardColorInverted);
  historyIndex = boardHistory.length - 1;
}

// Centralized turn-end: called after a move or a card has mutated game state.
// Card effect functions should be pure state mutators — they don't toggle turn,
// save state, or re-render. That's this function's job.
function endTurn(lastPawnDoubleMove = null) {
  // Twofer: grant an extra move by skipping the turn toggle
  let turnToggled = true;
  if (twoferPending > 0) {
    twoferPending--;
    turnToggled = false;
  } else {
    isWhiteTurn = !isWhiteTurn;
    twoferCardsBlocked = false;
  }

  selectedSquare = null;
  possibleMoves = [];
  turnCounter++;

  // Tick down all duck cooldowns
  for (const key of Object.keys(duckCooldowns)) {
    duckCooldowns[key]--;
    if (duckCooldowns[key] <= 0) delete duckCooldowns[key];
  }

  if (turnCounter >= nextCardSpawnAt) {
    spawnCardPickup();
    nextCardSpawnAt = turnCounter + randomSpawnInterval();
  }
  // Only save state when the turn actually ends — Twofer's intermediate
  // moves are part of one atomic turn and should not create history entries.
  if (turnToggled) saveState(lastPawnDoubleMove);
  createBoard();
  renderHands();

  // True deadlock: the player who's now to move cannot move any piece, holds no
  // cards, and there is no shared duck to teleport. Declare a stalemate (draw).
  if (turnToggled && isActivePlayerDeadlocked()) {
    displayStalemate();
  }
}

// The active player (per current isWhiteTurn) is deadlocked when all of these hold:
//  - they hold no cards (a card is always a possible action)
//  - there is no duck on the board (either player could move it)
//  - none of their pieces has any legal move
function isActivePlayerDeadlocked() {
  const hand = isWhiteTurn ? player1Hand : player2Hand;
  if (hand.length > 0) return false;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (currentBoard[r][c] === 'D' && !duckCooldowns[`${r},${c}`]) return false;
    }
  }

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = currentBoard[r][c];
      if (isOwnPiece(piece, isWhiteTurn) && getPossibleMoves(r, c, piece).length > 0) {
        return false;
      }
    }
  }

  return true;
}

// Places a face-down card on a random empty square. No-op if the board is full.
function spawnCardPickup() {
  const emptySquares = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (currentBoard[r][c] === "" && !cardPickups.some(p => p.row === r && p.col === c)) {
        emptySquares.push({ row: r, col: c });
      }
    }
  }
  if (emptySquares.length === 0) return;
  const pick = emptySquares[Math.floor(Math.random() * emptySquares.length)];
  if (cardQueue.length < QUEUE_MIN_LENGTH) refillQueue();
  const card = cardQueue.shift();
  cardPickups.push({ ...pick, card });
}

// Async pause used by sequenced card effects (currently only Blast).
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isOpponent(piece, isWhite) {
  if (piece === 'D') return false; // Duck is neutral — never capturable by either player
  return isWhite !== (piece === piece.toUpperCase());
}

// True if the piece belongs to the given player (uppercase = white, lowercase = black; duck is neutral).
function isOwnPiece(piece, isWhite) {
  if (!piece || piece === 'D') return false;
  return isWhite === (piece === piece.toUpperCase());
}

function getSlidingMoves(row, col, isWhite, directions) {
  const moves = [];
  for (const [dRow, dCol] of directions) {
    for (let i = 1; i < 8; i++) {
      const newRow = row + dRow * i;
      const newCol = col + dCol * i;
      if (newRow < 0 || newRow >= 8 || newCol < 0 || newCol >= 8) break;
      const target = currentBoard[newRow][newCol];
      if (!target) {
        moves.push({ row: newRow, col: newCol });
      } else {
        if (isOpponent(target, isWhite)) moves.push({ row: newRow, col: newCol });
        break;
      }
    }
  }
  return moves;
}

function getStepMoves(row, col, isWhite, offsets) {
  const moves = [];
  for (const [dRow, dCol] of offsets) {
    const newRow = row + dRow;
    const newCol = col + dCol;
    if (newRow < 0 || newRow >= 8 || newCol < 0 || newCol >= 8) continue;
    const target = currentBoard[newRow][newCol];
    if (!target) {
      moves.push({ row: newRow, col: newCol });
    } else {
      if (isOpponent(target, isWhite)) moves.push({ row: newRow, col: newCol });
    }
  }
  return moves;
}

// Duck can teleport to any empty square with no card pickup on it.
function getDuckMoves() {
  const moves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (currentBoard[r][c] === "" && !cardPickups.some(p => p.row === r && p.col === c)) {
        moves.push({ row: r, col: c });
      }
    }
  }
  return moves;
}

// Valid squares for placing a duck via card: empty and no card pickup.
function getValidDuckPlacementSquares() {
  return getDuckMoves();
}

function getPossibleMoves(row, col, piece) {
  const moves = [];
  const isWhite = piece === piece.toUpperCase();
  const lastPawnDoubleMove = pawnDoubleMoveHistory[historyIndex];

  // Pawn move logic
  if (piece.toLowerCase() === 'p') {
    const direction = isWhite ? -1 : 1;
    const startRow = isWhite ? 6 : 1;

    // Move one square forward
    const newRow = row + direction;
    if (newRow >= 0 && newRow < 8 && currentBoard[newRow][col] === "") {
      moves.push({ row: newRow, col: col });

      // Move two squares from the starting position
      const twoAhead = newRow + direction;
      if (row === startRow && twoAhead >= 0 && twoAhead < 8 && currentBoard[twoAhead][col] === "") {
        moves.push({ row: twoAhead, col: col });
      }
    }

    // Capture diagonally
    for (const captureCol of [col - 1, col + 1]) {
      if (newRow >= 0 && newRow < 8 && captureCol >= 0 && captureCol < 8) {
        const targetPiece = currentBoard[newRow][captureCol];
        if (targetPiece && isOpponent(targetPiece, isWhite)) {
          moves.push({ row: newRow, col: captureCol });
        }
      }
    }

    // En passant logic
    if (lastPawnDoubleMove) {
      const enPassantRow = isWhite ? 3 : 4;
      const adjacentCol = lastPawnDoubleMove.col;

      if (row === enPassantRow && (col === adjacentCol - 1 || col === adjacentCol + 1)) {
        const movedPiece = currentBoard[lastPawnDoubleMove.row][lastPawnDoubleMove.col];
        if (movedPiece && isOpponent(movedPiece, isWhite)) {
          const captureRow = isWhite ? row - 1 : row + 1;
          moves.push({
            row: captureRow,
            col: adjacentCol,
            enPassant: true
          });
        }
      }
    }
  }

  if (piece.toLowerCase() === 'r') {
    moves.push(...getSlidingMoves(row, col, isWhite, [[-1, 0], [1, 0], [0, -1], [0, 1]]));
  }

  if (piece.toLowerCase() === 'b') {
    moves.push(...getSlidingMoves(row, col, isWhite, [[-1, -1], [-1, 1], [1, -1], [1, 1]]));
  }

  if (piece.toLowerCase() === 'q') {
    moves.push(...getSlidingMoves(row, col, isWhite, [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]));
  }

  if (piece.toLowerCase() === 'k') {
    moves.push(...getStepMoves(row, col, isWhite, [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]));
    // Castling (Simple, we don't care about check or prior moves)
    const kingRow = isWhite ? 7 : 0;
    if (row === kingRow && col === 4) {
      // Kingside
      if (currentBoard[kingRow][5] === "" && currentBoard[kingRow][6] === "" &&
          currentBoard[kingRow][7] === (isWhite ? 'R' : 'r')) {
        moves.push({ row: kingRow, col: 6 });
      }
      // Queenside
      if (currentBoard[kingRow][3] === "" && currentBoard[kingRow][2] === "" && currentBoard[kingRow][1] === "" &&
          currentBoard[kingRow][0] === (isWhite ? 'R' : 'r')) {
        moves.push({ row: kingRow, col: 2 });
      }
    }
  }

  if (piece.toLowerCase() === 'n') {
    moves.push(...getStepMoves(row, col, isWhite, [[2, 1], [2, -1], [1, 2], [1, -2], [-2, 1], [-2, -1], [-1, 2], [-1, -2]]));
  }

  return moves;
}

function handleSquareClick(row, col) {
  if (gameOver || isAnimating) return;

  // Card targeting mode: clicking a valid target places the card
  if (pendingPlacement) {
    const isValid = pendingPlacement.validTargets.some(p => p.row === row && p.col === col);
    if (isValid) {
      const { card, index, player } = pendingPlacement;
      const hand = player === "player1" ? player1Hand : player2Hand;
      hand.splice(index, 1);
      pendingPlacement = null;
      card.effect(row, col);
      endTurn();
      renderHands();
    } else {
      // Clicking an invalid square cancels targeting
      pendingPlacement = null;
      createBoard();
    }
    return;
  }

  const piece = currentBoard[row][col];

  if (selectedSquare) {
    // Duck can be moved by either player; normal pieces require turn match
    const canAct = selectedSquare.piece === 'D' ||
      (isWhiteTurn && selectedSquare.piece === selectedSquare.piece.toUpperCase()) ||
      (!isWhiteTurn && selectedSquare.piece === selectedSquare.piece.toLowerCase());
    if (canAct) {
      const isValidMove = possibleMoves.some(move => move.row === row && move.col === col);
      if (isValidMove) {
        let lastPawnDoubleMove = null;
        // En passant capture logic
        if (selectedSquare.piece.toLowerCase() === 'p' && col !== selectedSquare.col && !currentBoard[row][col]) {
          const direction = selectedSquare.piece === selectedSquare.piece.toUpperCase() ? 1 : -1;
          currentBoard[row + direction][col] = "";
        }


        // Are we capturing a king?
        const capturedPiece = currentBoard[row][col];
        if (capturedPiece && capturedPiece.toLowerCase() === 'k') {
            console.log("King captured! Crowning a new king...");
            handleKingCapture(row, col, isWhiteTurn);
        }

        // Promotion -- Auto promote to queen
        if (selectedSquare.piece.toLowerCase() === 'p') {
            const promotionRow = selectedSquare.piece === 'P' ? 0 : 7;
            if (row === promotionRow) {
                selectedSquare.piece = selectedSquare.piece === 'P' ? 'Q' : 'q';
            }
        }

        // Move the piece. It no longer is where it was.
        currentBoard[row][col] = selectedSquare.piece;
        currentBoard[selectedSquare.row][selectedSquare.col] = "";

        // Set cooldown when a duck moves (+1 because endTurn will immediately decrement it)
        if (selectedSquare.piece === 'D') {
          delete duckCooldowns[`${selectedSquare.row},${selectedSquare.col}`];
          duckCooldowns[`${row},${col}`] = DUCK_COOLDOWN + 1;
        }

        // Castling -- Move the rook as well
        if (selectedSquare.piece.toLowerCase() === 'k' && 
            (Math.abs(col - selectedSquare.col) === 2) && selectedSquare.col ===4) {
          const rookStartCol = col === 6 ? 7 : 0;
          const rookEndCol = col === 6 ? 5 : 3;
          currentBoard[row][rookEndCol] = currentBoard[row][rookStartCol];
          currentBoard[row][rookStartCol] = "";
        }

        const isPawnDoubleMove = (selectedSquare.piece.toLowerCase() === 'p') && (Math.abs(row - selectedSquare.row) === 2);
        if (isPawnDoubleMove) {
            lastPawnDoubleMove = { row: row, col: col };
        }

        // Collect face-down card pickup if landing on one (duck can NOT collect)
        if (selectedSquare.piece !== 'D') {
          const pickupIdx = cardPickups.findIndex(p => p.row === row && p.col === col);
          if (pickupIdx >= 0) {
            const pickup = cardPickups[pickupIdx];
            cardPickups.splice(pickupIdx, 1);
            const hand = isWhiteTurn ? player1Hand : player2Hand;
            if (hand.length < 9) hand.push({ ...pickup.card });
            console.log(`${isWhiteTurn ? 'White' : 'Black'} collected a card!`);
          }
        }

        endTurn(lastPawnDoubleMove);
        return;
      }
    }
    selectedSquare = null;
    possibleMoves = [];
  } else {
    if (piece) {
      // Duck can be selected by either player if not on cooldown; normal pieces require turn match
      const duckReady = piece !== 'D' || !duckCooldowns[`${row},${col}`];
      const canSelect = (piece === 'D' && duckReady) ||
        (isWhiteTurn && piece === piece.toUpperCase()) ||
        (!isWhiteTurn && piece === piece.toLowerCase());
      if (canSelect) {
        selectedSquare = { row, col, piece };
        if (piece === 'D') {
          possibleMoves = getDuckMoves();
        } else {
          possibleMoves = getPossibleMoves(row, col, piece);
        }
      }
    }
  }
  
  createBoard();
}

function undoMove() {
  if (isAnimating || twoferCardsBlocked) return;
  if (historyIndex > 0) {
    historyIndex--;
    currentBoard = JSON.parse(JSON.stringify(boardHistory[historyIndex]));
    isWhiteTurn = turnHistory[historyIndex];
    // Restore hands — copy again so the live hand doesn't alias history.
    player1Hand = handHistory[historyIndex][0].map(c => ({ ...c }));
    player2Hand = handHistory[historyIndex][1].map(c => ({ ...c }));
    cardPickups = pickupHistory[historyIndex].map(p => ({ ...p, card: { ...p.card } }));
    turnCounter = turnCounterHistory[historyIndex];
    nextCardSpawnAt = nextCardSpawnAtHistory[historyIndex];
    duckCooldowns = { ...duckCooldownHistory[historyIndex] };
    cardQueue = [...cardQueueHistory[historyIndex]];
    twoferPending = twoferPendingHistory[historyIndex];
    twoferCardsBlocked = twoferCardsBlockedHistory[historyIndex];
    boardColorInverted = boardColorInvertedHistory[historyIndex];
    selectedSquare = null;
    possibleMoves = [];
    createBoard();
    renderHands();
  }
}

function redoMove() {
  if (isAnimating || twoferCardsBlocked) return;
  if (historyIndex < boardHistory.length - 1) {
    historyIndex++;
    currentBoard = JSON.parse(JSON.stringify(boardHistory[historyIndex]));
    isWhiteTurn = turnHistory[historyIndex];
    player1Hand = handHistory[historyIndex][0].map(c => ({ ...c }));
    player2Hand = handHistory[historyIndex][1].map(c => ({ ...c }));
    cardPickups = pickupHistory[historyIndex].map(p => ({ ...p, card: { ...p.card } }));
    turnCounter = turnCounterHistory[historyIndex];
    nextCardSpawnAt = nextCardSpawnAtHistory[historyIndex];
    duckCooldowns = { ...duckCooldownHistory[historyIndex] };
    cardQueue = [...cardQueueHistory[historyIndex]];
    twoferPending = twoferPendingHistory[historyIndex];
    twoferCardsBlocked = twoferCardsBlockedHistory[historyIndex];
    boardColorInverted = boardColorInvertedHistory[historyIndex];
    selectedSquare = null;
    possibleMoves = [];
    createBoard();
    renderHands();
  }
}

function handleKingCapture(kingRow, kingCol, activeTurn) {

  // Kill the king
  currentBoard[kingRow][kingCol]=''

  // Find all pieces of the player who lost their king
  const isWhiteKingCaptured = !activeTurn;
  let enemyPiecesRemaining = 0
  const playerPieces = [];  
  for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
          const piece = currentBoard[r][c];
          if (piece && piece !== 'D') {
              const isWhitePiece = piece === piece.toUpperCase();
              // Find pieces of the player who lost their king
              if (isWhiteKingCaptured === isWhitePiece ) {
                enemyPiecesRemaining=enemyPiecesRemaining+1;
                if (piece.toLowerCase() !== 'k') {
                  playerPieces.push({ row: r, col: c, piece });
                }
              }
          }
      }
  }
  console.log("Player pieces available for crowning:", playerPieces, 'Pieces total:', enemyPiecesRemaining);
  

  if (playerPieces.length > 0) {
      let pieceToCrown;
      let minDistance = Infinity;
      
      // Find the closest piece to the captured king
      for (const piece of playerPieces) {
          const distance = Math.sqrt(Math.pow(piece.row -  kingRow, 2) + Math.pow(piece.col - kingCol, 2));
          if (distance < minDistance) {
              minDistance = distance;
              pieceToCrown = piece;
          }
      }
      console.log("Crowning piece at:", pieceToCrown);

      // Crown the closest piece to a king
      const newKingPiece = isWhiteKingCaptured ? 'K' : 'k';
      currentBoard[pieceToCrown.row][pieceToCrown.col] = newKingPiece;
  }
  else if (enemyPiecesRemaining>0) {
    console.log('No non king pieces left to crown...')
  }
  else {
    console.log("No pieces available to crown. GAME OVER!");
    displayWinner(activeTurn ? "White" : "Black");
  }
}
function displayWinner(winner) {
  gameOver = true;
  const gameOverMessage = document.getElementById("game-over-message");
  gameOverMessage.innerHTML = `Game Over!<br>${winner} wins!`;  
  gameOverMessage.classList.remove("hidden"); 
  document.getElementById("undo-button").disabled = true;
  document.getElementById("redo-button").disabled = true; 
}

function displayStalemate() {
  gameOver = true;
  const gameOverMessage = document.getElementById("game-over-message");
  gameOverMessage.innerHTML = `Stalemate!<br>Draw.`;
  gameOverMessage.classList.remove("hidden");
  document.getElementById("undo-button").disabled = true;
  document.getElementById("redo-button").disabled = true;
}

function useKingifyCard() {
  // Determine which player is the opponent
  const opponentIsWhite = !isWhiteTurn;
  const opponentPieces = [];

  // Iterate through the board to find all opponent's non-king pieces
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = currentBoard[r][c];
      if (piece && piece !== 'D') {
        // Check if the piece belongs to the opponent and is not a king
        if (opponentIsWhite === (piece === piece.toUpperCase()) && piece.toLowerCase() !== 'k') {
          opponentPieces.push({ row: r, col: c });
        }
      }
    }
  }

  // If there are opponent pieces to choose from
  if (opponentPieces.length > 0) {
    // Select a random piece from the array
    const randomIndex = Math.floor(Math.random() * opponentPieces.length);
    const pieceToCrown = opponentPieces[randomIndex];

    // Get the new king's character based on the opponent's color
    const newKingPiece = opponentIsWhite ? 'K' : 'k';

    // Update the board
    currentBoard[pieceToCrown.row][pieceToCrown.col] = newKingPiece;
  } else {
    console.log("No valid opponent pieces to crown.");
  }
}

function usePassedPawnCard() {
  const pawnSpawnRow = isWhiteTurn ? 1 : 6;
  const emptySpaces = [];
  // look for empty spots in the second to last rank
  for (let i = 0; i < 8; i++) {
    if (currentBoard[pawnSpawnRow][i] === '') {
      emptySpaces.push(i);
    }
  }

  if (emptySpaces.length > 0) {
    const randomIndex = Math.floor(Math.random() * emptySpaces.length);
    currentBoard[pawnSpawnRow][emptySpaces[randomIndex]] = isWhiteTurn ? 'P' : 'p';
  } else {
    console.log("No empty spaces to spawn a pawn.");
  }
}

// Refills the player's home pawn rank (row 6 for white, row 1 for black) with
// pawns on a random subset of empty squares, up to MAX_PAWN_ARMY_SUMMONS per play.
// Tooltip advertises "replenish your rank" but only a fraction actually appears.
function usePawnArmyCard() {
  const homeRank = isWhiteTurn ? 6 : 1;
  const pawn = isWhiteTurn ? 'P' : 'p';

  const emptyCols = [];
  for (let c = 0; c < 8; c++) {
    if (currentBoard[homeRank][c] === "") emptyCols.push(c);
  }

  // Randomly pick up to MAX_PAWN_ARMY_SUMMONS of the empty squares.
  const summonCount = Math.min(emptyCols.length, MAX_PAWN_ARMY_SUMMONS);
  for (let i = 0; i < summonCount; i++) {
    const pick = Math.floor(Math.random() * emptyCols.length);
    currentBoard[homeRank][emptyCols[pick]] = pawn;
    emptyCols.splice(pick, 1);
  }

  console.log(summonCount > 0
    ? `${isWhiteTurn ? 'White' : 'Black'} summons a pawn army! ${summonCount} pawn(s) appear.`
    : "Pawn rank already full — no pawns summoned.");
}

function useRewindCard() {
  // Restore all state to before the opponent's last action without moving historyIndex.
  // This preserves the original history so that Undo after Rewind un-does the card play.
  if (historyIndex > 0) {
    const i = historyIndex - 1;
    currentBoard = JSON.parse(JSON.stringify(boardHistory[i]));

    // When inside Blast (isAnimating), only rewind the board — Blast's loop manages
    // hands/pickups itself, and restoring them would corrupt the iteration.
    if (!isAnimating) {
      player1Hand = handHistory[i][0].map(c => ({ ...c }));
      player2Hand = handHistory[i][1].map(c => ({ ...c }));
      cardPickups = pickupHistory[i].map(p => ({ ...p, card: { ...p.card } }));
      turnCounter = turnCounterHistory[i];
      nextCardSpawnAt = nextCardSpawnAtHistory[i];
      duckCooldowns = { ...duckCooldownHistory[i] };
      cardQueue = [...cardQueueHistory[i]];
      twoferPending = twoferPendingHistory[i];
      twoferCardsBlocked = twoferCardsBlockedHistory[i];
      boardColorInverted = boardColorInvertedHistory[i];

      // Re-consume the Rewind card: handleCardClick spliced it before calling this,
      // but restoring hands from history put it back. Remove it again.
      const hand = isWhiteTurn ? player1Hand : player2Hand;
      const rewindIdx = hand.findIndex(c => c.name === "Rewind");
      if (rewindIdx >= 0) hand.splice(rewindIdx, 1);
    }
  }
}

function useTwoferCard() {
  // Inside Blast, grant no extra move (Blast already plays all cards at once)
  if (isAnimating) return;
  twoferPending = 1;
  twoferCardsBlocked = true;
}

function useRotateCard() {
  // Rotate the whole board 90° counter-clockwise: source (r,c) -> destination (7-c, r).
  // a1->h1->h8->a8, b1->h2, e4->e5, etc.
  const rotated = Array.from({ length: 8 }, () => Array(8).fill(""));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      rotated[7 - c][r] = currentBoard[r][c];
    }
  }

  // A pawn carried onto the opponent's back rank auto-promotes to a queen of its own color.
  // White 'P' reaches rank 8 (row 0) -> 'Q'; black 'p' reaches rank 1 (row 7) -> 'q'.
  for (let c = 0; c < 8; c++) {
    if (rotated[0][c] === 'P') rotated[0][c] = 'Q';
    if (rotated[7][c] === 'p') rotated[7][c] = 'q';
  }

  currentBoard = rotated;

  // Card pickups sit on the turning board, so rotate their positions too.
  cardPickups = cardPickups.map(p => ({ ...p, row: 7 - p.col, col: p.row }));

  // Duck cooldowns are keyed by position — remap them so a duck mid-cooldown stays on cooldown.
  const rotatedCooldowns = {};
  for (const key of Object.keys(duckCooldowns)) {
    const [r, c] = key.split(',').map(Number);
    rotatedCooldowns[`${7 - c},${r}`] = duckCooldowns[key];
  }
  duckCooldowns = rotatedCooldowns;

  // A 90° rotation flips the color parity of every square; invert the checkerboard
  // so each piece visually stays on the same color it started on.
  boardColorInverted = !boardColorInverted;
}

function useFunDeleterCard() {
  const opponentHand = isWhiteTurn ? player2Hand : player1Hand;

  if (opponentHand.length > 0) {
    const randomIndex = Math.floor(Math.random() * opponentHand.length);
    const removedCard = opponentHand.splice(randomIndex, 1)[0];
    console.log(`Fun Deleter removed "${removedCard.name}" from opponent's hand.`);
  } else {
    console.log("Opponent has no cards to delete.");
  }
}

function useYoinkCard() {
  const currentHand = isWhiteTurn ? player1Hand : player2Hand;
  const opponentHand = isWhiteTurn ? player2Hand : player1Hand;

  if (opponentHand.length > 0) {
    const randomIndex = Math.floor(Math.random() * opponentHand.length);
    const stolenCard = opponentHand.splice(randomIndex, 1)[0];
    currentHand.push(stolenCard);
    console.log(`Yoink! Stole "${stolenCard.name}" from opponent.`);
  } else {
    console.log("Opponent has no cards to steal.");
  }
}

function useDuckCard(row, col) {
  currentBoard[row][col] = 'D';
  console.log("🦆 has been placed!");
}

// Blast's actual behavior (tooltip says just "Play all other cards. Ends turn." to keep it mysterious):
// - Plays every card currently in the player's hand, in left-to-right hand order.
// - Blast itself was already spliced out of hand by handleCardClick before this runs.
// - Every card played (including any other Blasts) is consumed.
// - Other Blasts are CONSUMED but their effect is NOT fired — this is deliberate:
//   nested Blast firing would compound (2 Blasts = double, 3 = triple, ... geometric growth).
//   So [Blast, Blast] play = nothing happens except both are consumed.
// - Snapshot at start: cards gained mid-Blast (e.g., via Yoink stealing) stay in hand
//   for future turns — they don't fire in this Blast.
// - Because endTurn is NOT called between sub-cards, historyIndex stays put, so
//   Rewind inside a Blast correctly rewinds the OPPONENT's last move, not the
//   previous sub-card's mutation. Multiple Rewinds in one Blast are idempotent.
// - Each sub-card plays one at a time with a visible pause so the player can watch
//   the board change and the card disappear from hand.
async function useBlastCard() {
  isAnimating = true;
  document.getElementById("undo-button").disabled = true;
  document.getElementById("redo-button").disabled = true;
  const hand = isWhiteTurn ? player1Hand : player2Hand;
  // Hoist Rewinds to fire before any other Blast sub-card. Rewind restores currentBoard
  // from boardHistory, so running it after a board-mutating card (duck, passed pawn,
  // pawn army) would wipe out that card's placement. Rewinds are idempotent — running
  // more than one in a row just re-restores the same snapshot.
  const snapshot = [...hand]; // snapshot — later additions (Yoink steals) don't fire
  const rewinds = snapshot.filter(c => c.effect === useRewindCard);
  const others = snapshot.filter(c => c.effect !== useRewindCard && c.effect !== useBlastCard);
  const toPlay = [...rewinds, ...others];
  for (const card of toPlay) {
    if (card.effect !== useBlastCard) {
      if (card.requiresTarget && card.getTargets) {
        // Auto-target: pick a random valid square
        const targets = card.getTargets();
        if (targets.length > 0) {
          const pick = targets[Math.floor(Math.random() * targets.length)];
          await card.effect(pick.row, pick.col);
        }
      } else {
        await card.effect();
      }
    }
    const i = hand.indexOf(card);
    if (i >= 0) hand.splice(i, 1);
    // Show this card's effect resolved before moving on to the next.
    createBoard();
    renderHands();
    await sleep(BLAST_STEP_DELAY_MS);
  }
  isAnimating = false;
  // Re-enable buttons unless the game ended during the animation
  if (!gameOver) {
    document.getElementById("undo-button").disabled = false;
    document.getElementById("redo-button").disabled = false;
  }
}

function drawCard(playerHand) {
  // Check if the player's hand has fewer than 9 cards
  if (playerHand.length < 9) {
    const randomIndex = Math.floor(Math.random() * cardTypes.length);
    playerHand.push({ ...cardTypes[randomIndex] });
    renderHands(); 
  } else {
    console.log("Hand is full, cannot draw more cards.");
  }
}

function renderHands() {
  const p1HandElement = document.getElementById("player1-hand");
  const p2HandElement = document.getElementById("player2-hand");

  // Clear existing cards
  p1HandElement.innerHTML = '';
  p2HandElement.innerHTML = '';

  // Render Player 1's hand
  player1Hand.forEach((card, index) => {
    const cardElement = createCardElement(card, index, "player1");
    p1HandElement.appendChild(cardElement);
  });

  // Render Player 2's hand
  player2Hand.forEach((card, index) => {
    const cardElement = createCardElement(card, index, "player2");
    p2HandElement.appendChild(cardElement);
  });
}

function createCardElement(card, index, player) {
  const cardElement = document.createElement("div");
  cardElement.classList.add("card");
  cardElement.dataset.index = index;
  cardElement.dataset.player = player;

  // Create and append the image element for the card background
  const cardImage = document.createElement("img");
  cardImage.src = card.imagePath;
  cardImage.alt = 'Card Background';
  cardImage.classList.add("card-image");
  cardElement.appendChild(cardImage);

  // Create and append the card name text
  const cardName = document.createElement("span");
  cardName.classList.add("card-name");
  cardName.textContent = card.name;
  cardElement.appendChild(cardName);

  // Add the tooltip element
  const tooltipElement = document.createElement("span");
  tooltipElement.classList.add("tooltiptext");
  tooltipElement.textContent = card.description;
  cardElement.appendChild(tooltipElement);

  // Add click handler
  cardElement.addEventListener("click", () => handleCardClick(index, player));
  
  return cardElement;
}

async function handleCardClick(index, player) {
  if (gameOver || isAnimating) return;
  if (twoferCardsBlocked) return; // Twofer locks card plays until the turn fully ends

  // If currently in targeting mode, cancel it (clicking a card while armed dismisses)
  if (pendingPlacement) {
    pendingPlacement = null;
    createBoard();
  }

  // Determine which player is clicking
  const isPlayer1Click = player === "player1";

  // Check if it's the correct player's turn
  if ((isPlayer1Click && isWhiteTurn) || (!isPlayer1Click && !isWhiteTurn)) {
    const hand = isPlayer1Click ? player1Hand : player2Hand;
    const card = hand[index];

    if (card) {
      if (card.requiresTarget) {
        // Enter targeting mode — card is NOT consumed until player picks a square
        const validTargets = card.getTargets();
        if (validTargets.length === 0) {
          console.log("No valid squares for this card.");
          return;
        }
        pendingPlacement = { card, index, player, validTargets };
        createBoard();
        return;
      }

      // Remove the card BEFORE running its effect so that Blast's iteration sees
      // the hand without itself, and doesn't need to filter its own instance out.
      hand.splice(index, 1);
      renderHands();

      // Card effects are pure state mutators. Only async if it wants to sequence
      // over time (currently Blast); others resolve immediately.
      await card.effect();

      // Centralized turn end handles toggle + save + board render.
      // Cards with endsTurn: false let the player still make a move this turn.
      if (card.endsTurn === false) {
        if (!twoferPending) saveState(); // Defer save for Twofer — turn not finished yet
        createBoard();
      } else {
        endTurn();
      }
      renderHands();
    }
  } else {
    console.log("It's not your turn to use a card.");
  }
}


document.getElementById("undo-button").addEventListener("click", undoMove);
document.getElementById("redo-button").addEventListener("click", redoMove);
document.getElementById("flip-button").addEventListener("click", () => {
  boardFlipped = !boardFlipped;
  createBoard();
});

// DEBUG: Starting cards for development — in production, cards are earned from board pickups only
for (let i = 0; i < 4; i++) {
  drawCard(player1Hand);
  drawCard(player2Hand);
}

// Seed the shared draw queue and spawn the first card pickup
refillQueue();
spawnCardPickup();

// Initial state setup
saveState(null);
renderHands();
createBoard();
