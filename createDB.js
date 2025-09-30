// createDB.js
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, 'vitalcare.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // --- USERS (patients, doctors, admins) ---
    db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      role          TEXT NOT NULL CHECK (role IN ('patient','doctor','admin')),

      -- Common identity
      name          TEXT NOT NULL,
      email         TEXT UNIQUE NOT NULL,
      password      TEXT NOT NULL,           -- plain for demo only
      created_at    TEXT NOT NULL,

      -- Patient-ish (optional)
      firstName     TEXT,
      lastName      TEXT,
      phone         TEXT,
      dob           TEXT,
      gender        TEXT,
      medicare      TEXT,
      address       TEXT,

      -- Doctor-ish (optional)
      specialty     TEXT,
      location      TEXT,
      qualifications TEXT,
      interests     TEXT,
      bio           TEXT,
      photoUrl      TEXT,

      -- New: booking switch (1=enabled, 0=disabled)
      enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1))
    )
  `);

    // --- MIGRATION: ensure "enabled" exists for older DBs ---
    db.all(`PRAGMA table_info(users);`, (err, rows) => {
        if (err) {
            console.error('PRAGMA table_info(users) failed:', err.message);
            return;
        }
        const hasEnabled = rows.some(r => r.name === 'enabled');
        if (!hasEnabled) {
            db.run(
                `ALTER TABLE users ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1));`,
                (e) => {
                    if (e) console.warn('Adding enabled column failed (might already exist):', e.message);
                    else console.log('✓ Added users.enabled column');
                }
            );
        }
    });

    // --- APPOINTMENTS ---
    db.run(`
    CREATE TABLE IF NOT EXISTS appointments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,       -- patient user id
      doctor_id  INTEGER,                -- doctor user id
      appt_date  TEXT NOT NULL,          -- YYYY-MM-DD
      appt_time  TEXT NOT NULL,          -- HH:MM
      notes      TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id)   REFERENCES users(id),
      FOREIGN KEY(doctor_id) REFERENCES users(id)
    )
  `);

    // --- FEEDBACK / CONTACT ---
    db.run(`
    CREATE TABLE IF NOT EXISTS feedback (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT,
      email      TEXT NOT NULL,
      subject    TEXT,
      message    TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

    // --- SEED: admin + a sample doctor (idempotent) ---
    db.run(`
    INSERT OR IGNORE INTO users
      (id, role, name, email, password, created_at,
       firstName, lastName, specialty, location, phone, enabled)
    VALUES
      (1, 'admin', 'Site Admin', 'admin@vitalcare.example', 'admin123', datetime('now'),
       'Site', 'Admin', NULL, NULL, NULL, 1)
  `);

    db.run(`
    INSERT OR IGNORE INTO users
      (id, role, name, email, password, created_at,
       firstName, lastName, specialty, location, phone, enabled)
    VALUES
      (2, 'doctor', 'Hannah Kim', 'doctor.hannah@vitalcare.example', 'doc123', datetime('now'),
       'Hannah', 'Kim', 'General Practice', 'Moonee Ponds', '0390001234', 1)
  `);

    console.log('✓ Database initialised at', dbPath);
});

db.close();
