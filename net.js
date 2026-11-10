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
      if (!peerOnline && msg) { peerOnline = true; stopHelloRetry(); emit(); }
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

    // Announce presence. Transports that connect asynchronously (e.g. Liveblocks) expose
    // onReady(); for those we (re)announce until a peer answers, because their events are
    // ephemeral — a hello sent before we connect, or before the peer joined, would be lost.
    // Default transports (no onReady) just send the single hello below, unchanged.
    let helloTimer = null;
    function announce() { conn.send({ kind: "hello" }); }
    function stopHelloRetry() { if (helloTimer) { clearInterval(helloTimer); helloTimer = null; } }
    function startHelloRetry() {
      if (helloTimer || typeof conn.onReady !== "function") return;
      let ticks = 0;
      helloTimer = setInterval(() => {
        if (peerOnline || ++ticks > 300) { stopHelloRetry(); return; } // ~6 min cap
        announce();
      }, 1200);
    }
    announce(); // announce presence once the room is fully built
    if (typeof conn.onReady === "function") conn.onReady(() => { announce(); startHelloRetry(); });

    return {
      me,
      state: () => state,
      actions: () => actions.slice(),
      canAct,
      peerOnline: () => peerOnline,
      subscribe(fn) { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; },
      move(from, to) { return submit({ type: "move", from, to, seed: randSeed() }); },
      playCard(cardId, target) { return submit({ type: "playCard", by: me, cardId, target, seed: randSeed() }); },
      transportName: conn.name || "local",
      netStatus: () => (typeof conn.status === "function" ? conn.status() : (peerOnline ? "connected" : "waiting")),
      onNetStatus(cb) { if (typeof conn.onStatus === "function") conn.onStatus(cb); },
    };
  }

  // Cross-device transport over Liveblocks. Loads the client from a pinned ESM CDN at
  // runtime so the project stays bundler-free. Returns a transport synchronously; sends
  // made before the room is joined are buffered and flushed once connected, and onReady
  // (used by createRoom) fires when the connection is live. Requires a Liveblocks public
  // key and rooms set to Public access in the project dashboard.
  function liveblocksTransport(opts) {
    const { roomId, publicApiKey } = opts;
    const moduleUrl = opts.moduleUrl || "https://esm.sh/@liveblocks/client@3.25.0";
    const LB_DEBUG = !!(root && root.__WC_NET_DEBUG); // set window.__WC_NET_DEBUG = true to see step logs
    const log = LB_DEBUG
      ? (...a) => { try { console.log("[WackyChess/LB]", ...a); } catch (_) {} }
      : () => {};
    const listeners = [];
    const readyCbs = [];
    const statusCbs = [];
    const outbox = [];
    let room = null;
    let connected = false;
    let status = "connecting";

    const setStatus = (s, err) => { status = s; log("status →", s, err || ""); for (const f of statusCbs.slice()) { try { f(s, err); } catch (_) {} } };
    const deliver = (msg) => { for (const f of listeners.slice()) f(msg); };
    const post = (msg) => { try { room.broadcastEvent({ __wc: "wackychess", data: msg }); } catch (e) { log("broadcastEvent failed:", e); } };

    async function connect() {
      try {
        log("start. room:", roomId, "key:", publicApiKey ? publicApiKey.slice(0, 7) + "…" : "(none)");
        if (!publicApiKey) { setStatus("error:no key"); return; }
        log("importing module…");
        const mod = await import(/* webpackIgnore: true */ moduleUrl);
        log("module loaded. createClient:", typeof mod.createClient);
        if (typeof mod.createClient !== "function") { setStatus("error:no createClient export"); return; }
        const client = mod.createClient({ publicApiKey });
        log("client methods:", ["enterRoom", "getRoom", "events", "getSyncStatus"].map((k) => k + ":" + typeof client[k]).join("  "));
        if (typeof client.enterRoom !== "function") { setStatus("error: no client.enterRoom"); return; }
        log("entering room…");
        const entered = await client.enterRoom(roomId);
        room = (entered && entered.room) ? entered.room : entered; // handle { room, leave } or room
        log("entered. room:", !!room, "broadcastEvent:", room && typeof room.broadcastEvent, "subscribe:", room && typeof room.subscribe);
        if (!room || typeof room.broadcastEvent !== "function" || typeof room.subscribe !== "function") {
          log("room own keys:", room ? (Object.keys(room).join(", ") || "(none)") : room);
          try { log("room proto keys:", Object.getOwnPropertyNames(Object.getPrototypeOf(room) || {}).join(", ")); } catch (_) {}
          setStatus("error:unexpected room API");
          return;
        }
        room.subscribe("event", (payload) => {
          const ev = payload && payload.event ? payload.event : payload;
          if (ev && ev.__wc === "wackychess") { const d = ev.data; log("recv:", d && (d.kind || (d.action && d.action.type))); deliver(d); }
        });
        // Fire ready once (flush buffered sends + tell createRoom to (re)announce). Liveblocks
        // queues storage ops until connected and createRoom re-announces hello on a timer, so a
        // late/absent status signal is tolerated — the 2.5s fallback guarantees we still proceed.
        let readied = false;
        function markReady() {
          if (readied) return;
          readied = true;
          connected = true;
          setStatus("connected");
          log("ready. flushing outbox:", outbox.length);
          while (outbox.length) post(outbox.shift());
          for (const f of readyCbs.slice()) { try { f(); } catch (e) { log("onReady cb error:", e); } }
        }
        if (typeof client.getSyncStatus === "function") { const s = client.getSyncStatus(); log("getSyncStatus:", s); if (s === "connected") markReady(); }
        if (client.events && typeof client.events.subscribe === "function") {
          client.events.subscribe((s) => { log("liveblocks status:", s); if (s === "connected") markReady(); });
        }
        setTimeout(markReady, 2500);
      } catch (e) {
        log("CONNECT FAILED:", e);
        try { console.error("[WackyChess/LB] connect failed:", e); } catch (_) {}
        setStatus("error: " + ((e && (e.message || e.name)) || e), e);
      }
    }
    connect();

    return {
      name: "liveblocks",
      status: () => status,
      onStatus(cb) { statusCbs.push(cb); cb(status); },
      send(msg) { if (connected && room) post(msg); else { log("buffer (not ready):", msg && (msg.kind || (msg.action && msg.action.type))); outbox.push(msg); } },
      subscribe(cb) { listeners.push(cb); },
      onReady(cb) { if (connected) cb(); else readyCbs.push(cb); },
    };
  }

  // App-level presence/seat occupancy layered on ANY {send, subscribe} transport. Each
  // connection heartbeats { token, seat }; a color is "taken" while another live connection
  // claims it. Needs no server, works over Liveblocks / cross-tab / memoryHub, and ignores
  // all non-presence traffic so it can safely share a transport with createRoom.
  function createPresence(conn, opts) {
    opts = opts || {};
    const hbMs = opts.heartbeatMs || 1500;
    const timeoutMs = opts.timeoutMs || 4500;
    const now = opts.now || function () { return Date.now(); };
    const token = opts.token || (now().toString(36) + Math.random().toString(36).slice(2, 8));
    const peers = Object.create(null);   // token -> { seat, ts }
    const cbs = [];
    let seat = null;
    let hb = null, prune = null;

    function seats() {
      const t = now(); const r = { white: false, black: false };
      for (const k in peers) {
        if (k === token) continue;
        const p = peers[k];
        if (t - p.ts > timeoutMs) continue;
        if (p.seat === "white") r.white = true; else if (p.seat === "black") r.black = true;
      }
      return r;
    }
    function holderOf(which) {  // another live token claiming `which`, or null
      const t = now();
      for (const k in peers) { if (k !== token && peers[k].seat === which && t - peers[k].ts <= timeoutMs) return k; }
      return null;
    }
    let lastSig = "";
    const emit = () => { const s = seats(); lastSig = JSON.stringify(s); for (const f of cbs.slice()) { try { f(s); } catch (_) {} } };
    const maybeEmit = () => { if (JSON.stringify(seats()) !== lastSig) emit(); };
    const announce = () => { try { conn.send({ kind: "presence", token, seat }); } catch (_) {} };
    // Lowest token wins a contested seat; a higher token yields it back to null. Deterministic
    // total order, so two simultaneous claims always converge without any arbiter.
    function resolveConflict() {
      if (!seat) return;
      const h = holderOf(seat);
      if (h && h < token) seat = null;
    }
    conn.subscribe(onMsg);
    function onMsg(msg) {
      if (!msg) return;
      if (msg.kind === "presence" && msg.token && msg.token !== token) {
        peers[msg.token] = { seat: msg.seat || null, ts: now() };
        resolveConflict();
        maybeEmit();
      } else if (msg.kind === "presence-leave" && msg.token && peers[msg.token]) {
        delete peers[msg.token]; maybeEmit();
      }
    }
    function startTimers() { stopTimers(); announce(); hb = setInterval(announce, hbMs); prune = setInterval(maybeEmit, Math.max(500, timeoutMs >> 1)); }
    function stopTimers() { if (hb) clearInterval(hb); if (prune) clearInterval(prune); hb = prune = null; }

    return {
      token: token,
      seat: function () { return seat; },
      seats: seats,
      isTaken: function (which) { return !!holderOf(which); },
      setSeat: function (s) { seat = s; resolveConflict(); announce(); emit(); return seat; },
      onChange: function (f) { cbs.push(f); return function () { const i = cbs.indexOf(f); if (i >= 0) cbs.splice(i, 1); }; },
      start: startTimers,
      stop: function () { stopTimers(); try { conn.send({ kind: "presence-leave", token }); } catch (_) {} },
      _announce: announce,   // test hooks (no timers)
      _recv: onMsg,
    };
  }

  const Net = { createRoom, memoryHub, broadcastTransport, liveblocksTransport, createPresence };
  root.WackyChessNet = Net;
  if (typeof module !== "undefined" && module.exports) module.exports = Net;
})(typeof globalThis !== "undefined" ? globalThis : this,
   (typeof module !== "undefined" && module.exports && typeof require === "function")
     ? require("./game/core.js")
     : (typeof globalThis !== "undefined" ? globalThis.WackyChessCore : undefined));
