// Duck Chess — view / controller. The authoritative game lives in game/core.js
// (DuckChessCore). This file only renders state, turns DOM events into actions, and
// dispatches them through DuckChessCore.applyAction. No game rules live here.
const C = DuckChessCore;
const boardEl = document.getElementById("chessboard");

const pieceClasses = {
  p: "black-pawn",  r: "black-rook",  n: "black-knight",  b: "black-bishop",  q: "black-queen",  k: "black-king",
  P: "white-pawn",  R: "white-rook",  N: "white-knight",  B: "white-bishop",  Q: "white-queen",  K: "white-king"
};
const BLAST_STEP_DELAY_MS = 1500; // Pause between each Blast sub-card so effects are visible.

// --- authoritative state (from the core) + view-only ephemera ---
let state = null;              // serializable GameState owned by the core
let selectedSquare = null;     // {row,col,piece} UI selection, not game state
let possibleMoves = [];        // legal moves for the selection, recomputed for render
let pendingPlacement = null;   // card-targeting mode: { cardId, by, index, validTargets }
let boardFlipped = false;      // render perspective only
let isAnimating = false;       // true while Blast frames play

function dispatch(action) { state = C.applyAction(state, action); render(); }

// ---------- rendering ----------
function render() { renderBoard(); renderHands(); renderTurnIndicator(); renderGameOver(); }

function renderBoard() {
  boardEl.innerHTML = "";
  for (let vi = 0; vi < 8; vi++) {
    for (let vj = 0; vj < 8; vj++) {
      const row = boardFlipped ? 7 - vi : vi;
      const col = boardFlipped ? 7 - vj : vj;
      const square = document.createElement("div");
      square.classList.add("square");
      square.classList.add((((row + col) % 2 === 0) !== state.boardColorInverted) ? "light" : "dark");
      if (selectedSquare && selectedSquare.row === row && selectedSquare.col === col) square.classList.add("selected");
      if (possibleMoves.some((m) => m.row === row && m.col === col)) square.classList.add("possible-move");
      if (pendingPlacement && pendingPlacement.validTargets.some((p) => p.row === row && p.col === col)) square.classList.add("targetable");

      const piece = state.board[row][col];
      if (piece) {
        if (piece === "D") {
          square.classList.add("duck");
          if (state.duckCooldowns[row + "," + col]) square.classList.add("duck-cooldown");
        } else if (pieceClasses[piece]) {
          square.classList.add(pieceClasses[piece]);
        }
      } else if (state.cardPickups.some((p) => p.row === row && p.col === col)) {
        square.classList.add("card-pickup");
      }

      square.dataset.row = row;
      square.dataset.col = col;
      square.addEventListener("click", () => handleSquareClick(row, col));
      boardEl.appendChild(square);
    }
  }
}

function renderHands() {
  renderHandInto("player1-hand", state.hands.player1, "player1");
  renderHandInto("player2-hand", state.hands.player2, "player2");
}
function renderHandInto(elId, hand, player) {
  const el = document.getElementById(elId);
  el.innerHTML = "";
  hand.forEach((ref, index) => {
    const def = C.cardById(ref.id);
    if (def) el.appendChild(createCardElement(def, index, player));
  });
}

function createCardElement(cardDef, index, player) {
  const cardElement = document.createElement("div");
  cardElement.classList.add("card");
  cardElement.dataset.index = index;
  cardElement.dataset.player = player;

  const cardImage = document.createElement("img");
  cardImage.src = cardDef.imagePath;
  cardImage.alt = "Card Background";
  cardImage.classList.add("card-image");
  cardElement.appendChild(cardImage);

  const cardName = document.createElement("span");
  cardName.classList.add("card-name");
  cardName.textContent = cardDef.name;
  cardElement.appendChild(cardName);

  const tooltip = document.createElement("span");
  tooltip.classList.add("tooltiptext");
  tooltip.textContent = cardDef.description;
  cardElement.appendChild(tooltip);

  cardElement.addEventListener("click", () => handleCardClick(index, player));
  return cardElement;
}

function renderTurnIndicator() {
  const t = document.getElementById("turn-indicator");
  if (t) t.textContent = state.isWhiteTurn ? "White" + String.fromCharCode(39) + "s turn" : "Black" + String.fromCharCode(39) + "s turn";
}

function renderGameOver() {
  const msg = document.getElementById("game-over-message");
  if (state.gameOver) {
    msg.innerHTML = state.draw ? "Stalemate!<br>Draw." : "Game Over!<br>" + state.winner + " wins!";
    msg.classList.remove("hidden");
  } else {
    msg.innerHTML = "";
    msg.classList.add("hidden");
  }
  const disabled = state.gameOver || isAnimating;
  document.getElementById("undo-button").disabled = disabled;
  document.getElementById("redo-button").disabled = disabled;
}

// ---------- interaction ----------
function handleSquareClick(row, col) {
  if (state.gameOver || isAnimating) return;

  if (pendingPlacement) {
    const isValid = pendingPlacement.validTargets.some((p) => p.row === row && p.col === col);
    if (isValid) {
      const by = pendingPlacement.by; const cardId = pendingPlacement.cardId;
      pendingPlacement = null; selectedSquare = null; possibleMoves = [];
      state = C.applyAction(state, { type: "playCard", by, cardId, target: { row, col } });
      render();
    } else { pendingPlacement = null; render(); }
    return;
  }

  const piece = state.board[row][col];
  if (selectedSquare) {
    const canAct = selectedSquare.piece === "D" ||
      (state.isWhiteTurn && selectedSquare.piece === selectedSquare.piece.toUpperCase()) ||
      (!state.isWhiteTurn && selectedSquare.piece === selectedSquare.piece.toLowerCase());
    if (canAct && possibleMoves.some((m) => m.row === row && m.col === col)) {
      const from = { row: selectedSquare.row, col: selectedSquare.col };
      selectedSquare = null; possibleMoves = [];
      state = C.applyAction(state, { type: "move", from, to: { row, col } });
      render();
      return;
    }
    selectedSquare = null; possibleMoves = [];
  } else if (piece) {
    const duckReady = piece !== "D" || !state.duckCooldowns[row + "," + col];
    const canSelect = (piece === "D" && duckReady) ||
      (state.isWhiteTurn && piece === piece.toUpperCase()) ||
      (!state.isWhiteTurn && piece === piece.toLowerCase());
    if (canSelect) {
      selectedSquare = { row, col, piece };
      possibleMoves = piece === "D"
        ? C.getDuckMoves(state.board, state.cardPickups)
        : C.getPossibleMoves(state.board, row, col, piece, state.pawnDouble);
    }
  }
  render();
}

function handleCardClick(index, player) {
  if (state.gameOver || isAnimating) return;
  if (state.twoferCardsBlocked) return;
  if (pendingPlacement) { pendingPlacement = null; render(); }

  const by = player === "player1" ? "player1" : "player2";
  if ((by === "player1") !== state.isWhiteTurn) { console.log("It" + String.fromCharCode(39) + "s not your turn to use a card."); return; }

  const ref = state.hands[by][index];
  if (!ref) return;
  const def = C.cardById(ref.id);
  if (!def) return;

  if (def.requiresTarget) {
    const validTargets = C.getDuckMoves(state.board, state.cardPickups);
    if (validTargets.length === 0) { console.log("No valid squares for this card."); return; }
    selectedSquare = null; possibleMoves = [];
    pendingPlacement = { cardId: ref.id, by, index, validTargets };
    render();
    return;
  }

  if (ref.id === "blast") { runBlast(by); return; }
  selectedSquare = null; possibleMoves = [];
  state = C.applyAction(state, { type: "playCard", by, cardId: ref.id });
  render();
}

function runBlast(by) {
  const frames = C.blastFrames(state, { type: "playCard", by, cardId: "blast" });
  if (!frames.length) return;
  selectedSquare = null; possibleMoves = []; pendingPlacement = null;
  isAnimating = true; renderGameOver();
  let i = 0;
  const step = () => {
    if (i < frames.length) { state = frames[i]; i++; render(); setTimeout(step, BLAST_STEP_DELAY_MS); }
    else { isAnimating = false; render(); }
  };
  step();
}

function undo() { if (!isAnimating) dispatch({ type: "undo" }); }
function redo() { if (!isAnimating) dispatch({ type: "redo" }); }

// ---------- wiring + init ----------
document.getElementById("undo-button").addEventListener("click", undo);
document.getElementById("redo-button").addEventListener("click", redo);
document.getElementById("flip-button").addEventListener("click", () => { boardFlipped = !boardFlipped; render(); });

// DEBUG: starting cards for development — in production, cards are earned from board pickups only.
const debugCards = (n) => Array.from({ length: n }, () => ({ id: C.CARDS[Math.floor(Math.random() * C.CARDS.length)].id }));
state = C.createInitialState({ hands: { player1: debugCards(4), player2: debugCards(4) }, seedPickup: true });
render();
