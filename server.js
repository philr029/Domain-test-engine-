/**
 * server.js
 *
 * Entry point for the Daily Blacklist Monitoring and Email Report Engine.
 *
 * Starts the Express HTTP server and registers the cron scheduler.
 * Pass --test (or set NODE_ENV=test) to run a single manual job then exit.
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');

const apiRouter = require('./api/routes');
const { startScheduler, runJob } = require('./jobs/dailyReportJob');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve the static frontend dashboard
app.use(express.static(path.join(__dirname, 'frontend')));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// ── Root: serve dashboard ─────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const isTest = process.argv.includes('--test') || process.env.NODE_ENV === 'test';

if (isTest) {
  // Manual test mode: run the job once and exit
  console.log('[server] Running in manual test mode…');
  runJob()
    .then((result) => {
      if (result) {
        console.log('[test] Job completed. Summary:', result.summary);
      } else {
        console.log('[test] Job returned no result (no targets or already running).');
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[test] Job failed:', err);
      process.exit(1);
    });
} else {
  app.listen(PORT, () => {
    console.log(`[server] Domain Blacklist Monitor running on http://localhost:${PORT}`);
    startScheduler();
  });
}

module.exports = app; // export for potential testing
