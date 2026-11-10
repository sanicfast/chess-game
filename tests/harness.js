// Zero-dependency test harness for the VIEW (script.js). Loads the pure core, then
// script.js, into a vm with a minimal DOM stub, and appends a shim exposing the
// view's dispatch surface so tests can drive it without a browser.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function makeEl() {
  const el = {
    _cls: new Set(), dataset: {}, style: { setProperty() {} }, children: [],
    disabled: false, textContent: '', id: '', src: '', alt: '', onclick: null,
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
  Object.defineProperty(el, 'className', { get() { return [...el._cls].join(' '); }, set(v) { el._cls = new Set(String(v).split(/\s+/).filter(Boolean)); } });
  return el;
}
function makeDocument() {
  const reg = {};
  return { getElementById(id) { return reg[id] || (reg[id] = makeEl()); }, createElement() { return makeEl(); }, addEventListener() {}, removeEventListener() {}, body: makeEl(), documentElement: makeEl() };
}

const SHIM = `
;globalThis.__V = {
  getState: () => state,
  setState: (v) => { state = v; selectedSquare = null; possibleMoves = []; pendingPlacement = null; render(); },
  handleSquareClick, handleCardClick, render,
  getSelected: () => selectedSquare,
  getPending: () => pendingPlacement,
  getFlipped: () => boardFlipped,
  C: DuckChessCore,
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
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'game', 'core.js'), 'utf8'), ctx, { filename: 'game/core.js' });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8') + SHIM, ctx, { filename: 'script.js' });
  if (!sandbox.__V) throw new Error('shim failed to attach __V');
  return sandbox.__V;
}

module.exports = { loadGame };
