// Wacky Chess — view / controller. Authoritative game logic lives in game/core.js
// (WackyChessCore); multiplayer sync lives in net.js (WackyChessNet). This file only
// renders state and turns clicks into actions. No game rules live here.
const C = WackyChessCore;
const boardEl = document.getElementById("chessboard");

const pieceClasses = {
  p: "black-pawn",  r: "black-rook",  n: "black-knight",  b: "black-bishop",  q: "black-queen",  k: "black-king",
  P: "white-pawn",  R: "white-rook",  N: "white-knight",  B: "white-bishop",  Q: "white-queen",  K: "white-king"
};
const BLAST_STEP_DELAY_MS = 1500;

// --- authoritative state + view-only ephemera ---
let state = null;              // serializable GameState
let selectedSquare = null;
let possibleMoves = [];
let pendingPlacement = null;
let boardFlipped = false;
let isAnimating = false;
// --- multiplayer ---
let net = null;               // WackyChessNet room when in net mode, else null
let mySide = null;            // 'player1' | 'player2' when in net mode
let roomCode = null;          // room/channel name in net mode

// --- online (Liveblocks) config -------------------------------------------------
// Paste your Liveblocks project's PUBLIC key (starts with "pk_") here to enable
// cross-device play. While this is the placeholder, "Join" uses the same-browser
// cross-tab transport instead, so local play and tests are unaffected.
// Dashboard note: set the project's default room access to "Public" so guests can enter.
const LIVEBLOCKS_PUBLIC_KEY = "pk_prod_4Vz0AzsTrb_aSiekY-WlgHFJHc1Nf0cAJ-A-dkLXqN4QadXnoy479Cl7MGSwZO-_";

function dispatch(action) { state = C.applyAction(state, action); render(); }
function dispatchMove(from, to) {
  if (net) { net.move(from, to); }
  else { state = C.applyAction(state, { type: "move", from, to }); render(); }
}
function dispatchCard(by, cardId, target) {
  if (net) { net.playCard(cardId, target); }
  else { state = C.applyAction(state, { type: "playCard", by, cardId, target }); render(); }
}

// ---------- rendering ----------
function render() { renderBoard(); renderHands(); renderTurnIndicator(); renderGameOver(); renderYourTurn(); }

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
      const hl = state.highlight || [];
      if (hl.some((m) => m.row === row && m.col === col)) square.classList.add("last-move");

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
  if (t) {
    let label = state.isWhiteTurn ? "White\u2019s turn" : "Black\u2019s turn";
    if (net && mySide) {
      const who = mySide === "player1" ? "You are White" : "You are Black";
      const st = (net.netStatus ? net.netStatus() : (net.peerOnline() ? "connected" : "waiting"));
      const conn = net.peerOnline() ? "opponent connected" : ("[" + (net.transportName || "?") + ": " + st + "] waiting for opponent…");
      label += " | " + who + " | room: " + roomCode + " | " + conn;
    }
    t.textContent = label;
  }
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
  const disabled = state.gameOver || isAnimating || !!net; // no undo/redo in multiplayer
  document.getElementById("undo-button").disabled = disabled;
  document.getElementById("redo-button").disabled = disabled;
}

// Big "YOUR TURN" banner beneath the board — only meaningful in online play (net mode),
// where you control a single color. In local hotseat there is no separate "you", so it stays hidden.
function renderYourTurn() {
  const el = document.getElementById("your-turn");
  if (!el) return;
  const show = !!state && !!net && !state.gameOver && !isAnimating && net.canAct();
  if (show) el.classList.remove("hidden"); else el.classList.add("hidden");
}

// ---------- interaction ----------
function handleSquareClick(row, col) {
  if (!state || state.gameOver || isAnimating) return;

  if (pendingPlacement) {
    const isValid = pendingPlacement.validTargets.some((p) => p.row === row && p.col === col);
    if (isValid) {
      const by = pendingPlacement.by; const cardId = pendingPlacement.cardId;
      pendingPlacement = null; selectedSquare = null; possibleMoves = [];
      dispatchCard(by, cardId, { row, col });
    } else { pendingPlacement = null; render(); }
    return;
  }

  const piece = state.board[row][col];
  const myTurn = !net || net.canAct(); // in net mode you may only act on your own turn
  if (selectedSquare) {
    const canAct = selectedSquare.piece === "D" ||
      (state.isWhiteTurn && selectedSquare.piece === selectedSquare.piece.toUpperCase()) ||
      (!state.isWhiteTurn && selectedSquare.piece === selectedSquare.piece.toLowerCase());
    if (myTurn && canAct && possibleMoves.some((m) => m.row === row && m.col === col)) {
      const from = { row: selectedSquare.row, col: selectedSquare.col };
      selectedSquare = null; possibleMoves = [];
      dispatchMove(from, { row, col });
      return;
    }
    selectedSquare = null; possibleMoves = [];
  } else if (piece) {
    const duckReady = piece !== "D" || !state.duckCooldowns[row + "," + col];
    const canSelect = myTurn && ((piece === "D" && duckReady) ||
      (state.isWhiteTurn && piece === piece.toUpperCase()) ||
      (!state.isWhiteTurn && piece === piece.toLowerCase()));
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
  if (!state || state.gameOver || isAnimating) return;
  if (state.twoferCardsBlocked) return;
  if (pendingPlacement) { pendingPlacement = null; render(); }

  const by = player === "player1" ? "player1" : "player2";
  if (net && by !== mySide) return; // in net mode you may only play your own side\u2019s cards
  if ((by === "player1") !== state.isWhiteTurn) { console.log("It\u2019s not your turn to use a card."); return; }

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

  if (ref.id === "blast") { if (net) { dispatchCard(by, "blast"); } else { runBlast(by); } return; }
  selectedSquare = null; possibleMoves = [];
  dispatchCard(by, ref.id);
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

function undo() { if (state && !net && !isAnimating) dispatch({ type: "undo" }); }
function redo() { if (state && !net && !isAnimating) dispatch({ type: "redo" }); }

// ---------- start menu: local or cross-tab multiplayer ----------
function hashSeed(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function randomRoomCode() { const A = "abcdefghjkmnpqrstuvwxyz23456789"; let s = ""; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)]; return "wacky-" + s; }
function roomCodeFromUrl() { try { const r = new URLSearchParams(location.search).get("room"); return r ? r.trim().slice(0, 64) : null; } catch (_) { return null; } }

// --- lobby: connect to a room and show which colors are already claimed ---
let lobby = null;   // { code, conn, presence } while the start menu is watching a room
function makeTransport(code) {
  const channelName = "wacky-chess:" + code;
  const useLiveblocks = !!LIVEBLOCKS_PUBLIC_KEY && LIVEBLOCKS_PUBLIC_KEY !== "REPLACE_WITH_YOUR_PK_KEY" && typeof window !== "undefined";
  return useLiveblocks
    ? WackyChessNet.liveblocksTransport({ roomId: channelName, publicApiKey: LIVEBLOCKS_PUBLIC_KEY })
    : WackyChessNet.broadcastTransport(channelName);
}
function openLobby(code, refresh) {
  closeLobby();
  if (typeof WackyChessNet === "undefined") return; // not in the browser / tests
  let conn, presence;
  try { conn = makeTransport(code); presence = WackyChessNet.createPresence(conn, { heartbeatMs: 800, timeoutMs: 2600 }); } catch (_) { return; }
  presence.onChange(() => { if (lobby) refresh(); });
  presence.start();
  lobby = { code, conn, presence };
  if (refresh) refresh();
}
function closeLobby() { if (lobby && lobby.presence) { try { lobby.presence.stop(); } catch (_) {} } lobby = null; }
function joinSide(color, closeOverlay, refresh) {
  if (!lobby || !lobby.presence) return;
  const seat = color === "player1" ? "white" : "black";   // presence uses white/black; engine uses player1/player2
  if (lobby.presence.isTaken(seat)) { refresh(); return; }
  const got = lobby.presence.setSeat(seat);
  if (got !== seat) { refresh(); return; }   // a lower-token peer claimed it simultaneously → yield
  const conn = lobby.conn, code = lobby.code;
  lobby = null;                                // keep conn + presence alive so we stay occupied during play
  closeOverlay();
  startNet(color, code, conn);
}

function startLocal() {
  closeLobby();
  net = null; mySide = null;
  boardFlipped = false;
  state = C.createInitialState({ deal: 3, seedPickup: true });
  render();
}

function startNet(side, channel, conn) {
  mySide = side; roomCode = channel;
  try { if (typeof history !== "undefined" && history.replaceState && typeof location !== "undefined") history.replaceState(null, "", location.pathname + "?room=" + encodeURIComponent(channel)); } catch (_) {}
  boardFlipped = (side === "player2"); // Black starts with the board flipped to their side
  const seed = hashSeed(channel);
  net = WackyChessNet.createRoom({ me: side, seed, deal: 3, transport: conn || makeTransport(channel), seedPickup: true });
  state = net.state();
  net.subscribe((s) => { state = s; render(); });
  if (net.onNetStatus) net.onNetStatus(() => renderTurnIndicator());
  render();
}

function buildStartOverlay() {
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.88);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,sans-serif;gap:12px;z-index:50;";
  const title = document.createElement("h2"); title.textContent = "Wacky Chess"; title.style.margin = "0"; ov.appendChild(title);
  const online = !!LIVEBLOCKS_PUBLIC_KEY && LIVEBLOCKS_PUBLIC_KEY !== "REPLACE_WITH_YOUR_PK_KEY";
  const hint = document.createElement("div"); hint.textContent = online ? "Local hotseat, or open the same room link on any two devices to play online." : "Local hotseat, or open two browser tabs and Join the same room to play across them."; hint.style.cssText = "opacity:.8;margin-bottom:6px;text-align:center;max-width:360px;"; ov.appendChild(hint);
  const defaultCode = roomCodeFromUrl() || randomRoomCode();
  const room = document.createElement("input"); room.value = defaultCode; room.spellcheck = false; room.addEventListener("focus", () => room.select()); room.style.cssText = "padding:6px 10px;font-size:16px;border-radius:6px;border:none;text-align:center;font-family:ui-monospace,monospace;"; ov.appendChild(room);
  const mk = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "menu-btn"; b.textContent = label; b.style.cssText = "padding:8px 16px;font-size:16px;border-radius:6px;border:none;"; b.addEventListener("click", fn); ov.appendChild(b); return b; };
  let whiteBtn, blackBtn;
  function refresh() {
    if (!whiteBtn || !blackBtn) return;
    const s = (lobby && lobby.presence) ? lobby.presence.seats() : { white: false, black: false };
    whiteBtn.disabled = s.white; blackBtn.disabled = s.black;
    whiteBtn.textContent = "Join as White" + (s.white ? "  (taken)" : "");
    blackBtn.textContent = "Join as Black" + (s.black ? "  (taken)" : "");
  }
  const removeOverlay = () => ov.remove();
  mk("Play Locally", () => { closeLobby(); removeOverlay(); startLocal(); });
  whiteBtn = mk("Join as White", () => joinSide("player1", removeOverlay, refresh));
  blackBtn = mk("Join as Black", () => joinSide("player2", removeOverlay, refresh));
  const note = document.createElement("div"); note.textContent = "Choose your color and share the room code or the link after joining."; note.style.cssText = "opacity:.7;margin-top:2px;text-align:center;max-width:360px;font-size:14px;"; ov.appendChild(note);
  document.body.appendChild(ov);
  refresh();
  openLobby(defaultCode, refresh);   // no-op in tests (no WackyChessNet); connects in the browser
  let deb = null;
  room.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(() => openLobby(room.value.trim() || defaultCode, refresh), 300); });
}

// ---------- wiring + init ----------
document.getElementById("undo-button").addEventListener("click", undo);
document.getElementById("redo-button").addEventListener("click", redo);
document.getElementById("flip-button").addEventListener("click", () => { if (!state) return; boardFlipped = !boardFlipped; render(); });

buildStartOverlay();
