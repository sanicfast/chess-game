// net.js — zero-dependency multiplayer sync over an append-only action log.
// Peers each reduce the shared log with WackyChessCore, so they converge without a
// server. Turn-ownership gates who may submit. Transport is pluggable:
//   memoryHub()        -> in-process (tests)
//   broadcastTransport -> browser tabs (BroadcastChannel + localStorage fallback, so
//                         it works over http:// and even file://)
//   (liveblocks)       -> cross-device, wired in a later step
(function (root, Core) {
  "use strict";

  function memoryHub() {
    const conns = [];
    return {
      connect() {
        const self = { deliver: null };
        conns.push(self);
        return {
          send(msg) { for (const c of conns) if (c !== self && c.deliver) c.deliver(msg); },
          subscribe(cb) { self.deliver = cb; },
        };
      },
    };
  }

  // Fan a message across every channel the environment offers; the room dedupes by index.
  function broadcastTransport(name) {
    const listeners = [];
    const key = "wackychess-msg:" + name;
    let n = 0;
    const bc = (typeof root.BroadcastChannel !== "undefined") ? new root.BroadcastChannel("bc:" + name) : null;
    if (bc) bc.onmessage = (e) => { for (const f of listeners.slice()) f(e.data); };
    if (typeof root.addEventListener === "function" && typeof root.localStorage !== "undefined") {
      root.addEventListener("storage", (ev) => {
        if (ev.key !== key || !ev.newValue) return;
        try { const d = JSON.parse(ev.newValue); for (const f of listeners.slice()) f(d.msg); } catch (_) {}
      });
    }
    return {
      send(msg) {
        if (bc) { try { bc.postMessage(msg); } catch (_) {} }
        if (typeof root.localStorage !== "undefined") { try { root.localStorage.setItem(key, JSON.stringify({ n: ++n, msg })); } catch (_) {} }
      },
      subscribe(cb) { listeners.push(cb); },
    };
  }

  const randSeed = () => Math.floor(Math.random() * 1e9);
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // opts: { me: 'player1'|'player2', seed?, transport, hands?, seedPickup? }
  function createRoom(opts) {
    const me = opts.me;
    const seed = opts.seed == null ? 1 : opts.seed;
    const conn = opts.transport;
    let actions = [];
    let peerOnline = false;
    let state = Core.createInitialState({ seed, hands: opts.hands, deal: opts.deal, seedPickup: opts.seedPickup });
    let stateStr = JSON.stringify(state);
    const subs = [];
    conn.subscribe(onRemote);

    const emit = () => { for (const f of subs.slice()) f(state); };
    const canAct = () => (state.isWhiteTurn ? me === "player1" : me === "player2");

    function commit(action) {
      const next = Core.applyAction(state, action, {});
      const s = JSON.stringify(next);
      if (s === stateStr) return false; // illegal / no-op — reject, do not append
      actions.push(action); state = next; stateStr = s; return true;
    }
    function submit(action) {
      if (!canAct()) return false;
      if (!commit(action)) return false;
      conn.send({ action, index: actions.length - 1 });
      emit();
      return true;
    }
    function sendSnapshot() { conn.send({ kind: "snapshot", actions: actions.slice(), state, index: actions.length }); }
    // Adopt a peer's fuller authoritative log/state (late join / catch-up).
    function adopt(msg) { actions = clone(msg.actions || []); state = clone(msg.state); stateStr = JSON.stringify(state); emit(); }
    function onRemote(msg) {
      if (!peerOnline && msg) { peerOnline = true; emit(); }
      if (!msg) return;
      if (msg.kind === "hello") { sendSnapshot(); return; }                 // a peer joined → share our game so it catches up
      if (msg.kind === "snapshot") {                                         // catch-up: only adopt a strictly longer log
        if ((msg.actions || []).length > actions.length) adopt(msg);
        return;
      }
      if (msg.index == null) return;                                         // stray
      if (actions.length !== msg.index) return;                              // out-of-order / duplicate (server transport orders this)
      const next = Core.applyAction(state, msg.action, {});
      actions.push(msg.action); state = next; stateStr = JSON.stringify(next);
      emit();
    }

    conn.send({ kind: "hello" }); // announce presence once the room is fully built

    return {
      me,
      state: () => state,
      actions: () => actions.slice(),
      canAct,
      peerOnline: () => peerOnline,
      subscribe(fn) { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; },
      move(from, to) { return submit({ type: "move", from, to, seed: randSeed() }); },
      playCard(cardId, target) { return submit({ type: "playCard", by: me, cardId, target, seed: randSeed() }); },
    };
  }

  const Net = { createRoom, memoryHub, broadcastTransport };
  root.WackyChessNet = Net;
  if (typeof module !== "undefined" && module.exports) module.exports = Net;
})(typeof globalThis !== "undefined" ? globalThis : this,
   (typeof module !== "undefined" && module.exports && typeof require === "function")
     ? require("./game/core.js")
     : (typeof globalThis !== "undefined" ? globalThis.WackyChessCore : undefined));
