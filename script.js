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

const cardTypes = [
  { name: "Kingify", effect: useKingifyCard, description: "Turns a random opponent piece into a king. Ends turn.", imagePath: 'assets/kingify-card-icon.png'},
  { name: "Summon Passed Pawn", effect: usePassedPawnCard, description: "Summon a pawn onto the second to last rank. Ends turn.", imagePath: 'assets/passedpawn-card-icon.png'},
  { name: "Rewind", effect: useRewindCard, description: "Undo opponent's last action.", imagePath: 'assets/rewind-card-icon.png'},
  { name: "Fun Deleter", effect: useFunDeleterCard, description: "Remove random card from opponent's hand.", imagePath: 'assets/delete-card-icon.png'},
  { name: "Yoink!", effect: useYoinkCard, description: "Steal a random card from opponent's hand. Ends turn.", imagePath: 'assets/steal-card-icon.png'},
  { name: "Blast!", effect: useBlastCard, description: "Play all other cards. Ends turn.", imagePath: 'assets/blast-card-icon.png'},
];
let player1Hand = [];
let player2Hand = [];

let currentBoard = JSON.parse(JSON.stringify(initialBoard)); 
let selectedSquare = null;
let possibleMoves = [];
let isWhiteTurn = true; // Track whose turn it is (true = white, false = black)

// New variables for history
let boardHistory = [];
let turnHistory = [];
let pawnDoubleMoveHistory = [];
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

      const piece = currentBoard[row][col];
      if (piece) {
        // Find the corresponding CSS class from the new mapping
        const pieceClass = pieceClasses[piece];
        if (pieceClass) {
          square.classList.add(pieceClass);
        }
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
  }
  boardHistory.push(JSON.parse(JSON.stringify(currentBoard)));
  turnHistory.push(isWhiteTurn);
  pawnDoubleMoveHistory.push(lastPawnDoubleMove);
  historyIndex = boardHistory.length - 1;
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
    }

    // Move two squares from the starting position
    if (row === startRow && currentBoard[newRow][col] === "" && currentBoard[newRow + direction][col] === "") {
      moves.push({ row: newRow + direction, col: col });
    }

    // Capture diagonally
    const captureCols = [col - 1, col + 1];
    for (const captureCol of captureCols) {
      if (captureCol >= 0 && captureCol < 8) {
        const targetPiece = currentBoard[newRow][captureCol];
        if (targetPiece && (isWhite !== (targetPiece === targetPiece.toUpperCase()))) {
          moves.push({ row: newRow, col: captureCol });
        }
      }
    }

    // En passant logic
    if (lastPawnDoubleMove) {
      const isWhitePawn = piece === 'P';
      const enPassantRow = isWhitePawn ? 3 : 4;
      const adjacentCol = lastPawnDoubleMove.col;
      
      if (row === enPassantRow && (col === adjacentCol - 1 || col === adjacentCol + 1)) {
        const movedPiece = currentBoard[lastPawnDoubleMove.row][lastPawnDoubleMove.col];
        if (movedPiece && (isWhite !== (movedPiece === movedPiece.toUpperCase()))) {
          const captureRow = isWhitePawn ? row - 1 : row + 1;
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
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dRow, dCol] of directions) {
      for (let i = 1; i < 8; i++) {
        const newRow = row + dRow * i;
        const newCol = col + dCol * i;

        if (newRow < 0 || newRow >= 8 || newCol < 0 || newCol >= 8) break;

        const targetPiece = currentBoard[newRow][newCol];
        if (!targetPiece) {
          moves.push({ row: newRow, col: newCol });
        } else {
          if (isWhite !== (targetPiece === targetPiece.toUpperCase())) {
            moves.push({ row: newRow, col: newCol });
          }
          break;
        }
      }
    }
  }

  if (piece.toLowerCase() === 'b') {
    const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [dRow, dCol] of directions) {
      for (let i = 1; i < 8; i++) {
        const newRow = row + dRow * i;
        const newCol = col + dCol * i;

        if (newRow < 0 || newRow >= 8 || newCol < 0 || newCol >= 8) break;

        const targetPiece = currentBoard[newRow][newCol];
        if (!targetPiece) {
          moves.push({ row: newRow, col: newCol });
        } else {
          if (isWhite !== (targetPiece === targetPiece.toUpperCase())) {
            moves.push({ row: newRow, col: newCol });
          }
          break;
        }
      }
    }
  }

  if (piece.toLowerCase() === 'q') {
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [dRow, dCol] of directions) {
      for (let i = 1; i < 8; i++) {
        const newRow = row + dRow * i;
        const newCol = col + dCol * i;

        if (newRow < 0 || newRow >= 8 || newCol < 0 || newCol >= 8) break;

        const targetPiece = currentBoard[newRow][newCol];
        if (!targetPiece) {
          moves.push({ row: newRow, col: newCol });
        } else {
          if (isWhite !== (targetPiece === targetPiece.toUpperCase())) {
            moves.push({ row: newRow, col: newCol });
          }
          break;
        }
      }
    }
  }

  if (piece.toLowerCase() === 'k') {
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [dRow, dCol] of directions) {
      for (let i = 1; i < 2; i++) {
        const newRow = row + dRow * i;
        const newCol = col + dCol * i;

        if (newRow < 0 || newRow >= 8 || newCol < 0 || newCol >= 8) break;

        const targetPiece = currentBoard[newRow][newCol];
        if (!targetPiece) {
          moves.push({ row: newRow, col: newCol });
        } else {
          if (isWhite !== (targetPiece === targetPiece.toUpperCase())) {
            moves.push({ row: newRow, col: newCol });
          }
          break;
        }
      }
    }
    // Castling (Simple, we don't care about check or prior moves)
    const kingRow = isWhite ? 7 : 0;
    if (row === kingRow && col === 4) {
      // Kingside
      if (currentBoard[kingRow][5] === "" && currentBoard[kingRow][6] === "" && 
          ((isWhite && currentBoard[kingRow][7] === 'R') || (!isWhite && currentBoard[kingRow][7] === 'r'))) {
        moves.push({ row: kingRow, col: 6 });
      }
      // Queenside
      if (currentBoard[kingRow][3] === "" && currentBoard[kingRow][2] === "" && currentBoard[kingRow][1] === "" &&
          ((isWhite && currentBoard[kingRow][0] === 'R') || (!isWhite && currentBoard[kingRow][0] === 'r'))) {
        moves.push({ row: kingRow, col: 2 });
      }
    }
  }

  if (piece.toLowerCase() === 'n') {
    const directions = [[2, 1], [2, -1], [1, 2], [1, -2], [-2, 1], [-2, -1], [-1, 2], [-1, -2]];
    for (const [dRow, dCol] of directions) {
      for (let i = 1; i < 2; i++) {
        const newRow = row + dRow * i;
        const newCol = col + dCol * i;

        if (newRow < 0 || newRow >= 8 || newCol < 0 || newCol >= 8) break;

        const targetPiece = currentBoard[newRow][newCol];
        if (!targetPiece) {
          moves.push({ row: newRow, col: newCol });
        } else {
          if (isWhite !== (targetPiece === targetPiece.toUpperCase())) {
            moves.push({ row: newRow, col: newCol });
          }
          break;
        }
      }
    }
  }

  return moves;
}

function handleSquareClick(row, col) {
  const piece = currentBoard[row][col];

  if (selectedSquare) {
    if ((isWhiteTurn && selectedSquare.piece === selectedSquare.piece.toUpperCase()) || (!isWhiteTurn && selectedSquare.piece === selectedSquare.piece.toLowerCase())) {
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

  isWhiteTurn = !isWhiteTurn;
        saveState(lastPawnDoubleMove);
      }
    }
    selectedSquare = null;
    possibleMoves = [];
  } else {
    if (piece) {
      if ((isWhiteTurn && piece === piece.toUpperCase()) || (!isWhiteTurn && piece === piece.toLowerCase())) {
        selectedSquare = { row, col, piece };
        possibleMoves = getPossibleMoves(row, col, piece);
      }
    }
  }
  
  createBoard();
}

function undoMove() {
  if (historyIndex > 0) {
    historyIndex--;
    currentBoard = JSON.parse(JSON.stringify(boardHistory[historyIndex]));
  isWhiteTurn = turnHistory[historyIndex];
    selectedSquare = null;
    possibleMoves = [];
    createBoard();
  }
}

function redoMove() {
  if (historyIndex < boardHistory.length - 1) {
    historyIndex++;
    currentBoard = JSON.parse(JSON.stringify(boardHistory[historyIndex]));
  isWhiteTurn = turnHistory[historyIndex];
    selectedSquare = null;
    possibleMoves = [];
    createBoard();
  }
}

function handleKingCapture(kingRow, kingCol, isWhiteTurn) {

  // Kill the king
  currentBoard[kingRow][kingCol]=''

  // Find all pieces of the player who lost their king
  const isWhiteKingCaptured = !isWhiteTurn;
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
    displayWinner(isWhiteTurn ? "White" : "Black");
  }
}
function displayWinner(winner) {
  const gameOverMessage = document.getElementById("game-over-message");
  gameOverMessage.innerHTML = `Game Over!<br>${winner} wins!`;  
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
        const isWhitePiece = piece === piece.toUpperCase();
        // Check if the piece belongs to the opponent and is not a king
        if (opponentIsWhite === isWhitePiece && piece.toLowerCase() !== 'k') {
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

    // Save the new state and redraw the board
    saveState(null);
    createBoard();
    
    // Switch the turn to the other player as the card action ends the turn
    createBoard();
  } else {
    console.log("No valid opponent pieces to crown.");
  }
  isWhiteTurn = !isWhiteTurn;

}
function usePassedPawnCard() {
  const pawnSpawnRow = isWhiteTurn ? 1 : 6;
  const emptySpaces=[];
  // look for empty spots in the second to last rank
  for (let i = 0; i<8; i++) {
    if (currentBoard[pawnSpawnRow][i]==='') {
      emptySpaces.push(i);
    }
  }
  console.log('Places to put a pawn on the back rank:',emptySpaces);

  const randomIndex = Math.floor(Math.random() * emptySpaces.length);
  currentBoard[pawnSpawnRow][emptySpaces[randomIndex]]= isWhiteTurn ? 'P' : 'p';

  isWhiteTurn = !isWhiteTurn;
}

function useRewindCard() {
  undoMove()
  isWhiteTurn = !isWhiteTurn;
}

function useFunDeleterCard() {

}

function useYoinkCard() {

  isWhiteTurn = !isWhiteTurn;
}

function useBlastCard() {

  isWhiteTurn = !isWhiteTurn;
}

function drawCard(playerHand) {
  // Check if the player's hand has fewer than 9 cards
  if (playerHand.length < 9) {
    const randomIndex = Math.floor(Math.random() * cardTypes.length);
    const newCard = cardTypes[randomIndex];
    playerHand.push(newCard);
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

function handleCardClick(index, player) {
  // Determine which player is clicking
  const isPlayer1Click = player === "player1";

  // Check if it's the correct player's turn
  if ((isPlayer1Click && isWhiteTurn) || (!isPlayer1Click && !isWhiteTurn)) {
    const hand = isPlayer1Click ? player1Hand : player2Hand;
    const card = hand[index];

    if (card) {
      // Execute the card's effect function
      card.effect();

      // Remove the card from the hand
      hand.splice(index, 1);

      // Save the state after the card action
      saveState(null); 

      // Redraw the hands to reflect the change
      renderHands();
      createBoard(); // Update the board and turn indicator
    }
  } else {
    console.log("It's not your turn to use a card.");
  }
}


document.getElementById("undo-button").addEventListener("click", undoMove);
document.getElementById("redo-button").addEventListener("click", redoMove);

// ** Add these lines to give each player a card at the start **
// player1Hand.push(cardTypes[0]); 
// player2Hand.push(cardTypes[0]); 

for (let row = 0; row <4; row++){
  drawCard(player1Hand); 
  drawCard(player2Hand);
}

// Initial state setup
saveState(null);
renderHands();
createBoard();