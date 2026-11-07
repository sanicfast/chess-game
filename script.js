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
  { name: "Rewind", effect: useRewindCard, description: "Undo opponent's last action.", imagePath: 'assets/rewind-card-icon.png'},
  { name: "Fun Deleter", effect: useFunDeleterCard, description: "Remove random card from opponent's hand.", imagePath: 'assets/delete-card-icon.png'},
  { name: "Yoink!", effect: useYoinkCard, description: "Steal a random card from opponent's hand. Ends turn.", imagePath: 'assets/steal-card-icon.jpg'},
  { name: "Blast!", effect: useBlastCard, description: "Play all other cards. Ends turn.", imagePath: 'assets/blast-card-icon.jpg'},
  { name: "Summon Duck", effect: useDuckCard, getTargets: getValidDuckPlacementSquares, requiresTarget: true, description: "Place a 🦆 on the board. Ends turn.", imagePath: 'assets/duck-card-icon.jpg'},
  { name: "Summon Pawn Army", effect: usePawnArmyCard, description: "Replenish your rank of pawns. Ends turn.", imagePath: 'assets/summon-pawn-army.jpg'},
];
let player1Hand = [];
let player2Hand = [];

let currentBoard = JSON.parse(JSON.stringify(initialBoard)); 
let selectedSquare = null;
let possibleMoves = [];
let isWhiteTurn = true; // Track whose turn it is (true = white, false = black)
let gameOver = false;
let isAnimating = false; // True while a sequenced effect (e.g. Blast) is playing out
let cardPickups = []; // Array of {row, col} — face-down cards on the board waiting to be collected
let turnCounter = 0; // Total turns elapsed; card spawns every CARD_SPAWN_INTERVAL turns
let pendingPlacement = null; // When set, we're in card-targeting mode: { card, index, player, validTargets }

const CARD_SPAWN_INTERVAL = 6; // A card pickup spawns after each player has had 3 turns (6 total moves)
const MAX_PAWN_ARMY_SUMMONS = 3; // Max pawns Summon Pawn Army can spawn in one play

// History for undo/redo
let boardHistory = [];
let turnHistory = [];
let pawnDoubleMoveHistory = [];
let handHistory = []; // each entry: [p1HandCopy, p2HandCopy]
let pickupHistory = []; // each entry: array of {row, col}
let turnCounterHistory = []; // each entry: integer
let historyIndex = -1; // Use -1 to indicate an empty history stack

function createBoard() {
  board.innerHTML = "";
  const turnIndicator = document.getElementById("turn-indicator");
  if (turnIndicator) {
    turnIndicator.textContent = isWhiteTurn ? "White's turn" : "Black's turn";
  }

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = document.createElement("div");
      square.classList.add("square");

      if ((row + col) % 2 === 0) {
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
  pickupHistory.push(cardPickups.map(p => ({ ...p })));
  turnCounterHistory.push(turnCounter);
  historyIndex = boardHistory.length - 1;
}

// Centralized turn-end: called after a move or a card has mutated game state.
// Card effect functions should be pure state mutators — they don't toggle turn,
// save state, or re-render. That's this function's job.
function endTurn(lastPawnDoubleMove = null) {
  isWhiteTurn = !isWhiteTurn;
  selectedSquare = null;
  possibleMoves = [];
  turnCounter++;
  if (turnCounter % CARD_SPAWN_INTERVAL === 0) {
    spawnCardPickup();
  }
  saveState(lastPawnDoubleMove);
  createBoard();

  // True deadlock: the player who's now to move cannot move any piece, holds no
  // cards, and there is no shared duck to teleport. Declare a stalemate (draw).
  if (isActivePlayerDeadlocked()) {
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
      if (currentBoard[r][c] === 'D') return false;
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
  cardPickups.push(pick);
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
            cardPickups.splice(pickupIdx, 1);
            drawCard(isWhiteTurn ? player1Hand : player2Hand);
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
      // Duck can be selected by either player; normal pieces require turn match
      const canSelect = piece === 'D' ||
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
  if (isAnimating) return;
  if (historyIndex > 0) {
    historyIndex--;
    currentBoard = JSON.parse(JSON.stringify(boardHistory[historyIndex]));
    isWhiteTurn = turnHistory[historyIndex];
    // Restore hands — copy again so the live hand doesn't alias history.
    player1Hand = handHistory[historyIndex][0].map(c => ({ ...c }));
    player2Hand = handHistory[historyIndex][1].map(c => ({ ...c }));
    cardPickups = pickupHistory[historyIndex].map(p => ({ ...p }));
    turnCounter = turnCounterHistory[historyIndex];
    selectedSquare = null;
    possibleMoves = [];
    createBoard();
    renderHands();
  }
}

function redoMove() {
  if (isAnimating) return;
  if (historyIndex < boardHistory.length - 1) {
    historyIndex++;
    currentBoard = JSON.parse(JSON.stringify(boardHistory[historyIndex]));
    isWhiteTurn = turnHistory[historyIndex];
    player1Hand = handHistory[historyIndex][0].map(c => ({ ...c }));
    player2Hand = handHistory[historyIndex][1].map(c => ({ ...c }));
    cardPickups = pickupHistory[historyIndex].map(p => ({ ...p }));
    turnCounter = turnCounterHistory[historyIndex];
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
          if (piece) {
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
      if (piece) {
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
  // Restore the board to before the opponent's last action without moving historyIndex.
  // This preserves the original history so that Undo after Rewind un-does the card play.
  if (historyIndex > 0) {
    currentBoard = JSON.parse(JSON.stringify(boardHistory[historyIndex - 1]));
  }
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
  const toPlay = [...hand]; // snapshot — later additions (Yoink steals) don't fire
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
      endTurn();
      renderHands();
    }
  } else {
    console.log("It's not your turn to use a card.");
  }
}


document.getElementById("undo-button").addEventListener("click", undoMove);
document.getElementById("redo-button").addEventListener("click", redoMove);

// DEBUG: Starting cards for development — in production, cards are earned from board pickups only
for (let i = 0; i < 4; i++) {
  drawCard(player1Hand);
  drawCard(player2Hand);
}

// Spawn the first card pickup immediately so there's something to play towards from turn 1
spawnCardPickup();

// Initial state setup
saveState(null);
renderHands();
createBoard();
