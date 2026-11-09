'use strict';
// Zero-dependency test harness. Loads the REAL script.js inside a vm with a
// minimal DOM stub so its top-level auto-init runs, then appends a shim that
// exports the rules functions and LIVE getters/setters for every state slice
// (the game reassigns many `let` globals, so we expose them as closures).
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function makeEl() {
  const el = {
    _cls: new Set(), dataset: {}, style: { setProperty() {} }, children: [],
    disabled: false, textContent: '', id: '', src: '', onclick: null,
    classList: {
      add(...c) { c.forEach((x) => el._cls.add(x)); },
      remove(...c) { c.forEach((x) => el._cls.delete(x)); },
      contains(c) { return el._cls.has(c); },
      toggle(c) { if (el._cls.has(c)) { el._cls.delete(c); } else { el._cls.add(c); } },
    },
    appendChild(ch) { el.children.push(ch); return ch; },
    removeChild() {}, addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    querySelectorAll() { return []; }, closest() { return null; },
    click() {}, focus() {}, remove() {},
  };
  Object.defineProperty(el, 'innerHTML', { get() { return ''; }, set() { el.children.length = 0; } });
  Object.defineProperty(el, 'className', {
    get() { return [...el._cls].join(' '); },
    set(v) { el._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  return el;
}

function makeDocument() {
  const reg = {};
  return {
    getElementById(id) { return reg[id] || (reg[id] = makeEl()); },
    createElement() { return makeEl(); },
    addEventListener() {}, removeEventListener() {},
    body: makeEl(), documentElement: makeEl(),
  };
}

const SHIM = `
;globalThis.__G = {
  getPossibleMoves, isSquareAttacked, useRotateCard, useTwoferCard, spawnCardPickup,
  endTurn, saveState, undoMove, redoMove, isActivePlayerDeadlocked, isOpponent, isOwnPiece, getDuckMoves,
  getBoard: () => currentBoard, setBoard: (v) => { currentBoard = v; },
  getPickups: () => cardPickups, setPickups: (v) => { cardPickups = v; },
  getQueue: () => cardQueue, setQueue: (v) => { cardQueue = v; },
  getDuckCd: () => duckCooldowns, setDuckCd: (v) => { duckCooldowns = v; },
  getFlip: () => boardColorInverted, setFlip: (v) => { boardColorInverted = v; },
  getTurnCounter: () => turnCounter, setTurnCounter: (v) => { turnCounter = v; },
  getNextSpawn: () => nextCardSpawnAt, setNextSpawn: (v) => { nextCardSpawnAt = v; },
  getTwoferPending: () => twoferPending, setTwoferPending: (v) => { twoferPending = v; },
  getTwoferBlocked: () => twoferCardsBlocked, setTwoferBlocked: (v) => { twoferCardsBlocked = v; },
  getWhiteTurn: () => isWhiteTurn, setWhiteTurn: (v) => { isWhiteTurn = v; },
  getPdHist: () => pawnDoubleMoveHistory, setPdHist: (v) => { pawnDoubleMoveHistory = v; },
  getHistIndex: () => historyIndex, setHistIndex: (v) => { historyIndex = v; },
  getAnimating: () => isAnimating, setAnimating: (v) => { isAnimating = v; },
  getHistLen: () => boardHistory.length,
};`;

function loadGame() {
  const sandbox = {
    console, document: makeDocument(),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    addEventListener() {}, removeEventListener() {}, location: { reload() {} },
    Image: class { constructor() { return makeEl(); } },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  const coreSrc = fs.readFileSync(path.join(__dirname, '..', 'game', 'core.js'), 'utf8');
  const src = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
  // Load the pure core first so script.js can delegate to globalThis.DuckChessCore,
  // then the view/controller (script.js), then the export shim.
  vm.runInContext(coreSrc, ctx, { filename: 'game/core.js' });
  vm.runInContext(src + SHIM, ctx, { filename: 'script.js' });
  if (!sandbox.__G) throw new Error('shim failed to attach __G');
  return sandbox.__G;
}

const EMPTY = () => Array.from({ length: 8 }, () => Array(8).fill(''));

module.exports = { loadGame, EMPTY };
