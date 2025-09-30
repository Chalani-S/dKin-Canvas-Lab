// server.js — Express + sessions + SQLite + Yjs WS + full API + auth-gated rooms
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import crypto from "node:crypto";

import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { z } from "zod";

import { WebSocketServer } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync.js";
import * as awarenessProtocol from "y-protocols/awareness.js";
import * as encoding from "lib0/encoding.js";
import * as decoding from "lib0/decoding.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// --------------------------------------------------
// Middleware
// --------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: "change-me-in-prod",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" }
  })
);

// --------------------------------------------------
// SQLite (drawings)
// --------------------------------------------------
const db = new Database(path.join(__dirname, "drawings.sqlite"));
db.exec(`
CREATE TABLE IF NOT EXISTS drawings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

// --------------------------------------------------
// Auth (demo)
// --------------------------------------------------
const users = new Map(); // username -> { username, hash }
const requireAuth = (req, res, next) =>
  req.session.user ? next() : res.status(401).json({ error: "Auth required" });
const safe = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --------------------------------------------------
// Validation
// --------------------------------------------------
const DrawingSchema = z.object({
  title: z.string().min(1),
  size: z.object({ w: z.number().positive(), h: z.number().positive() }),
  background: z.string(),
  strokes: z.array(z.any())
});

// --------------------------------------------------
// Pages (rooms are gated)
// --------------------------------------------------
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.get("/room/:roomId", (req, res) => {
  if (!req.session.user) {
    const id = encodeURIComponent(req.params.roomId);
    return res.redirect(302, `/?room=${id}&needLogin=1`);
  }
  res.sendFile(path.join(__dirname, "public", "room.html"));
});

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/docs", (_req, res) =>
  res.json({
    about: "Canvas JSON format & API endpoints",
    routes: [
      "GET /, GET /room/:id (auth-gated), GET /health, GET /docs",
      "GET /auth/me, POST /auth/register, POST /auth/login, POST /auth/logout",
      "GET /api/drawings, POST /api/drawings*, GET /api/drawings/:id, PUT /api/drawings/:id*, DELETE /api/drawings/:id*",
      "GET /api/stats, POST /api/drawings/:id/png*",
      "GET /api/rooms  (active rooms + peers)"
    ],
    note: "* requires auth"
  })
);

// --------------------------------------------------
// Auth API (always returns { ok:true, username } on success)
// --------------------------------------------------
app.get("/auth/me", (req, res) => {
  // avoid any stale cached responses
  res.set("Cache-Control", "no-store");
  if (req.session.user)
    return res.json({ authenticated: true, username: req.session.user.username });
  res.json({ authenticated: false });
});

app.post(
  "/auth/register",
  safe(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username & password required" });
    if (users.has(username)) return res.status(409).json({ error: "User exists" });
    const hash = await bcrypt.hash(password, 12);
    users.set(username, { username, hash });
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Session error" });
      req.session.user = { username };
      res.json({ ok: true, username });
    });
  })
);

app.post(
  "/auth/login",
  safe(async (req, res) => {
    const { username, password } = req.body || {};
    const u = users.get(username);
    if (!u) return res.status(401).json({ error: "Invalid credentials" });
    const ok = await bcrypt.compare(password, u.hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Session error" });
      req.session.user = { username };
      res.json({ ok: true, username });
    });
  })
);

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// --------------------------------------------------
// Drawings API
// --------------------------------------------------
app.get("/api/drawings", (_req, res) => {
  const rows = db
    .prepare(`SELECT id,title,created_at,updated_at FROM drawings ORDER BY updated_at DESC`)
    .all();
  res.json(rows);
});

app.post(
  "/api/drawings",
  requireAuth,
  safe(async (req, res) => {
    const parsed = DrawingSchema.parse(req.body);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO drawings (id,title,json,created_at,updated_at) VALUES (?,?,?,?,?)`)
      .run(id, parsed.title, JSON.stringify(parsed), now, now);
    res.status(201).json({ id });
  })
);

app.get("/api/drawings/:id", (req, res) => {
  const row = db.prepare(`SELECT json FROM drawings WHERE id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(JSON.parse(row.json));
});

app.put(
  "/api/drawings/:id",
  requireAuth,
  safe(async (req, res) => {
    const partial = DrawingSchema.partial().parse(req.body);
    const existing = db.prepare(`SELECT json FROM drawings WHERE id=?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    const merged = { ...JSON.parse(existing.json), ...partial };
    db.prepare(`UPDATE drawings SET json=?, title=?, updated_at=? WHERE id=?`)
      .run(JSON.stringify(merged), merged.title ?? "(untitled)", new Date().toISOString(), req.params.id);
    res.json({ ok: true });
  })
);

app.delete("/api/drawings/:id", requireAuth, (req, res) => {
  db.prepare(`DELETE FROM drawings WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

app.get("/api/stats", (_req, res) => {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM drawings`).get().c;
  const last = db.prepare(`SELECT updated_at FROM drawings ORDER BY updated_at DESC LIMIT 1`).get();
  res.json({ count, lastUpdated: last?.updated_at ?? null });
});

app.post("/api/drawings/:id/png", requireAuth, (req, res) => {
  const { dataUrl } = req.body || {};
  if (!/^data:image\/png;base64,/.test(dataUrl || ""))
    return res.status(400).json({ error: "Invalid PNG dataUrl" });
  res.json({ ok: true });
});

// --------------------------------------------------
// Yjs WebSocket server (collaboration) + room directory
// --------------------------------------------------
const wss = new WebSocketServer({ noServer: true });
const rooms = new Map(); // name -> { doc, awareness, conns:Set }
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

function getRoom(name) {
  let r = rooms.get(name);
  if (r) return r;

  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  const conns = new Set();

  awareness.on("update", ({ added, updated, removed }, origin) => {
    const changed = added.concat(updated, removed);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    const buf = encoding.toUint8Array(enc);
    for (const ws of conns) if (ws !== origin && ws.readyState === ws.OPEN) ws.send(buf);
  });

  r = { doc, awareness, conns };
  rooms.set(name, r);
  return r;
}

function sendSync(ws, doc) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_SYNC);
  syncProtocol.writeSyncStep1(enc, doc);
  ws.send(encoding.toUint8Array(enc));
}

function sendFullAwareness(ws, awareness) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_AWARENESS);
  encoding.writeVarUint8Array(
    enc,
    awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awareness.getStates().keys()))
  );
  ws.send(encoding.toUint8Array(enc));
}

function onWSConnection(ws, roomName) {
  const { doc, awareness, conns } = getRoom(roomName);
  conns.add(ws);

  // initial sync + presence
  sendSync(ws, doc);
  sendFullAwareness(ws, awareness);

  ws.on("message", (data) => {
    const dec = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(dec);
    if (type === MSG_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.readSyncMessage(dec, enc, doc);
      const reply = encoding.toUint8Array(enc);
      if (reply.length > 1) ws.send(reply);
    } else if (type === MSG_AWARENESS) {
      const update = decoding.readVarUint8Array(dec);
      awarenessProtocol.applyAwarenessUpdate(awareness, update, ws);
    }
  });

  ws.on("close", () => {
    conns.delete(ws);
  });
}

// Accept /yjs/<room> or /yjs?room=<room>
server.on("upgrade", (request, socket, head) => {
  try {
    const u = new URL(request.url, `http://${request.headers.host}`);
    if (!u.pathname.startsWith("/yjs")) return socket.destroy();
    let room = u.pathname.replace(/^\/yjs\/?/, "");
    if (!room) room = u.searchParams.get("room") || "default";
    wss.handleUpgrade(request, socket, head, (ws) => onWSConnection(ws, room));
  } catch {
    socket.destroy();
  }
});

// Active rooms (filter out anonymous placeholders)
app.get("/api/rooms", (_req, res) => {
  res.set("Cache-Control", "no-store");
  const summary = [];
  for (const [name, { awareness }] of rooms.entries()) {
    const peers = [];
    awareness.getStates().forEach((st, cid) => {
      const n = (st?.name || "").trim();
      if (!n || n.toLowerCase() === "user" || n.toLowerCase() === "guest") return;
      peers.push({ id: cid, name: n, color: st?.color || "#999" });
    });
    summary.push({ name, peers });
  }
  res.json(summary);
});

// --------------------------------------------------
// 404 + Error handlers
// --------------------------------------------------
app.use((req, res) => res.status(404).json({ error: "Route not found" }));
app.use((err, req, res, _next) => {
  console.error(err);
  if (err instanceof z.ZodError)
    return res.status(400).json({ error: "Invalid payload", issues: err.issues });
  res.status(500).json({ error: "Server error", message: err.message });
});

// --------------------------------------------------
// Start
// --------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`HTTP: http://localhost:${PORT}`);
  console.log(`WS  : ws://localhost:${PORT}/yjs/<roomId>`);
});
