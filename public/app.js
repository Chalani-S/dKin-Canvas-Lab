// public/app.js — responsive pointer mapping + presence + peers UI
import * as Y from "https://cdn.jsdelivr.net/npm/yjs@13.6.23/+esm";
import { WebsocketProvider } from "https://cdn.jsdelivr.net/npm/y-websocket@2.0.3/+esm";

const roomId = decodeURIComponent(location.pathname.split("/").pop());

// ----- DOM helpers -----
const $ = id => document.getElementById(id);
const roomTag = $("roomTag");
const cvs = $("board");
const overlay = $("overlay");
const nameEl = $("name");
const colorEl = $("color");
const sizeEl = $("size");
const clearBtn = $("clear");
const saveBtn = $("save");
const openBtn = $("open");
const exportBtn = $("export");
const logoutBtn = $("logout");
const sessionBadge = $("sessionBadge");
const peersEl = $("peers");
const avatarsEl = $("avatars");
const roomsMonitor = $("roomsMonitor");
const statusEl = $("status");
const peersSummary = $("peersSummary");

if (roomTag) roomTag.textContent = `#${roomId}`;
const ctx = cvs.getContext("2d");
const octx = overlay.getContext("2d");

// ----- local state -----
const state = {
  drawing: false,
  color: "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0"),
  size: 4,
  authedUser: null
};
if (colorEl) colorEl.value = state.color;
if (sizeEl) sizeEl.value = String(state.size);

// ----- Yjs provider -----
const wsProto = location.protocol === "https:" ? "wss" : "ws";
const provider = new WebsocketProvider(
  `${wsProto}://${location.host}/yjs/${encodeURIComponent(roomId)}`,
  roomId,
  new Y.Doc(),
  { connect: true }
);
const awareness = provider.awareness;
const ydoc = provider.doc;
const ystrokes = ydoc.getArray("strokes");

// ----- auth helpers -----
async function me() {
  const r = await fetch("/auth/me", { credentials: "same-origin", cache: "no-store" });
  return await r.json();
}
async function refreshAuthUI() {
  const m = await me();
  if (m.authenticated) {
    state.authedUser = m.username;
    if (sessionBadge) { sessionBadge.textContent = `Logged in as ${m.username}`; sessionBadge.className = "badge on"; }
    if (saveBtn) saveBtn.disabled = false;
    if (nameEl) { nameEl.value = m.username; nameEl.readOnly = true; }
    ensurePresence(); // broadcast username immediately
  } else {
    location.href = `/?room=${encodeURIComponent(roomId)}&needLogin=1`;
  }
}
async function doLogout() {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  location.href = `/?room=${encodeURIComponent(roomId)}`;
}
if (logoutBtn) logoutBtn.onclick = doLogout;

// ----- presence helpers -----
function ensurePresence(cursor = null) {
  const name = (nameEl?.value || state.authedUser || "").trim() || "user";
  const color = colorEl?.value || state.color;
  awareness.setLocalState({ name, color, cursor });
}

// rebroadcast on connect/focus/color change
provider.on("status", (e) => {
  if (statusEl) statusEl.textContent = `connection: ${e.status}`;
  if (e.status === "connected") ensurePresence();
});
window.addEventListener("focus", () => ensurePresence());
colorEl?.addEventListener("input", () => ensurePresence());
setInterval(() => {
  const s = awareness.getLocalState();
  if (s) awareness.setLocalState(s);
}, 30000);

// ----- drawing render -----
function redraw() {
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cvs.width, cvs.height);
  ystrokes.forEach((s) => {
    if (s.tool !== "pen") return;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.lineCap = "round";
    ctx.beginPath();
    s.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  });
}
ystrokes.observe(redraw);

// ----- peers UI -----
function initials(name) {
  const n = (name || "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/).filter(Boolean);
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function drawCursorsAndPeers() {
  // clear layers
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (peersEl) peersEl.innerHTML = "";
  if (avatarsEl) avatarsEl.innerHTML = "";

  // Dedup by name and skip anonymous placeholders
  const entriesByName = new Map();

  awareness.getStates().forEach((st, cid) => {
    const name = (st?.name || "").trim();
    const color = st?.color || "#999";

    // Skip anonymous placeholders
    if (!name || name.toLowerCase() === "user" || name.toLowerCase() === "guest") return;

    // Draw live cursor for others (coords are in canvas internal units)
    if (st?.cursor && cid !== awareness.clientID) {
      const { x, y } = st.cursor;
      octx.fillStyle = color;
      octx.beginPath(); octx.arc(x, y, 6, 0, Math.PI * 2); octx.fill();
      octx.font = "12px system-ui"; octx.fillText(name, x + 10, y + 4);
    }

    entriesByName.set(name, { name, color });
  });

  // Ensure we include ourselves even if echo is delayed
  if (state.authedUser) {
    const selfName = state.authedUser.trim();
    if (selfName && !entriesByName.has(selfName)) {
      const selfColor = colorEl?.value || state.color;
      entriesByName.set(selfName, { name: selfName, color: selfColor });
    }
  }

  const entries = Array.from(entriesByName.values());

  // Render chips and avatars
  entries.forEach((e) => {
    if (peersEl) {
      const tag = document.createElement("span");
      tag.className = "peer-tag";
      tag.textContent = e.name;
      tag.style.borderColor = e.color;
      peersEl.appendChild(tag);
    }
    if (avatarsEl) {
      const av = document.createElement("div");
      av.className = "avatar";
      av.title = e.name;
      av.textContent = initials(e.name);
      av.style.borderColor = e.color;
      av.style.color = e.color;
      avatarsEl.appendChild(av);
    }
  });

  if (peersSummary) {
    peersSummary.textContent = `${entries.length} online: ${entries.map(e => e.name).join(", ")}`;
  }
}
awareness.on("change", drawCursorsAndPeers);
document.addEventListener("visibilitychange", () => { if (!document.hidden) drawCursorsAndPeers(); });

// ----- responsive pointer mapping -----
// Canvas has fixed internal size (width/height attributes), but CSS scales it.
// Map client coords -> internal coords using scale from bounding rect.
function getXY(e) {
  const r = cvs.getBoundingClientRect();
  const scaleX = cvs.width / r.width;
  const scaleY = cvs.height / r.height;
  return {
    x: (e.clientX - r.left) * scaleX,
    y: (e.clientY - r.top) * scaleY
  };
}

cvs.addEventListener("pointerdown", (e) => {
  state.drawing = true;
  state.active = { tool: "pen", color: colorEl.value, size: Number(sizeEl.value), points: [getXY(e)] };
});
cvs.addEventListener("pointermove", (e) => {
  const p = getXY(e);
  ensurePresence(p); // update live cursor (internal units)
  if (!state.drawing) return;
  const pts = state.active.points;
  pts.push(p);
  ctx.strokeStyle = state.active.color; ctx.lineWidth = state.active.size; ctx.lineCap = "round";
  ctx.beginPath(); const n = pts.length; ctx.moveTo(pts[n - 2].x, pts[n - 2].y); ctx.lineTo(pts[n - 1].x, pts[n - 1].y); ctx.stroke();
});
cvs.addEventListener("pointerup", () => {
  if (!state.drawing) return;
  state.drawing = false;
  ydoc.transact(() => ystrokes.push([state.active]));
  state.active = null;
  ensurePresence(null);
});
cvs.addEventListener("pointerleave", () => ensurePresence(null));

// ----- clear / save / load / export -----
clearBtn.onclick = () => {
  if (!confirm("Clear canvas for everyone in this room?")) return;
  ydoc.transact(() => ystrokes.delete(0, ystrokes.length));
};

function docToJSON() {
  return {
    title: (nameEl?.value || "Untitled"),
    size: { w: cvs.width, h: cvs.height },  // remains 1200x720 internally
    background: "#ffffff",
    strokes: ystrokes.toJSON()
  };
}
async function saveToServer() {
  const payload = docToJSON();
  const res = await fetch("/api/drawings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(payload)
  });
  if (res.status === 401) return alert("Please login on the Home page to save.");
  const data = await res.json();
  if (!res.ok) return alert(data.error || "Save failed");
  alert("Saved id: " + data.id);
}
async function listDrawings() {
  const r = await fetch("/api/drawings", { credentials: "same-origin", cache: "no-store" });
  return await r.json();
}
async function loadFromServer(id) {
  const r = await fetch(`/api/drawings/${id}`, { credentials: "same-origin", cache: "no-store" });
  const drawing = await r.json();
  if (!r.ok) return alert(drawing.error || "Load failed");
  ydoc.transact(() => {
    ystrokes.delete(0, ystrokes.length);
    (drawing.strokes || []).forEach((s) => ystrokes.push([s]));
  });
  redraw();
}
function exportPNG() {
  const url = cvs.toDataURL("image/png");
  const win = window.open();
  win.document.write(`<img src="${url}" style="max-width:100%">`);
}
saveBtn.onclick = saveToServer;
openBtn.onclick = async () => {
  const list = await listDrawings();
  if (!list.length) return alert("No drawings saved yet.");
  const pick = prompt("Enter drawing id to open:\n" + list.map((r) => `${r.id} — ${r.title}`).join("\n"));
  if (pick) loadFromServer(pick.trim());
};
exportBtn.onclick = exportPNG;

// ----- global rooms monitor -----
async function refreshRooms() {
  const r = await fetch("/api/rooms", { credentials: "same-origin", cache: "no-store" });
  const rooms = await r.json().catch(() => []);
  if (!roomsMonitor) return;
  roomsMonitor.innerHTML = "";
  rooms.forEach((room) => {
    const wrap = document.createElement("div");
    wrap.className = "room-card small";
    const head = document.createElement("div");
    head.className = "room-head";
    head.textContent = `#${room.name}`;
    const body = document.createElement("div");
    body.className = "room-peers";
    room.peers.forEach((p) => {
      const tag = document.createElement("span");
      tag.className = "peer-tag";
      tag.textContent = p.name;
      tag.style.borderColor = p.color;
      body.appendChild(tag);
    });
    wrap.appendChild(head); wrap.appendChild(body);
    roomsMonitor.appendChild(wrap);
  });
}

// ----- init -----
(async function init() {
  await refreshAuthUI();
  redraw();
  ensurePresence();
  drawCursorsAndPeers();
  refreshRooms();
  setInterval(refreshRooms, 5000);
})();
