# dKin-Canvas-Lab
dKin Canvas Lab is a real-time, collaborative drawing web app built to demonstrate modern full-stack techniques end-to-end.

## Feature overview
### Advanced HTML5 element - Canvas
• Freehand pen tool with adjustable color and size.
• Live presence cursors (per-user name + color) using Yjs “awareness”.
• Accurate pointer mapping even when the canvas is CSS-scaled (so drawings line up
across devices).
• Separate overlay layer for cursors so strokes remain clean.
### Extended UI styling & interaction
• Responsive layout (desktop → tablet → mobile) via media queries; sticky top bar,
avatars, badges, “chips” room presets, subtle hero/landing sections.
• Clear UX states: login badge, join-room gating, friendly banners, and toasts.
• Keyboard-friendly inputs; confirm on destructive actions (e.g., Clear).

### How to explore on the site
1. Home (/): Register or log in (badge updates).
2. Join a room: Enter a room ID (e.g., studio-123) → collaborators see each other
instantly.
3. Draw & collaborate: Colored cursors appear; strokes sync in real time.
4. Save / Open / Export: Save to SQLite (returns ID), open previous drawings, export
PNG.
5. Manual (/manual): Deep dive into implementation details and API usage.
