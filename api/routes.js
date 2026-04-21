/**
 * api/routes.js
 *
 * Express router exposing:
 *   POST /api/run        – manually trigger the report job
 *   GET  /api/results    – return the latest scan results (JSON)
 *   GET  /api/report     – download the latest Excel report
 *   GET  /api/status     – job status (running / idle)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');

const { runJob } = require('../jobs/dailyReportJob');

// ── Rate limiters ─────────────────────────────────────────────────────────────
// General read endpoints: 60 requests per minute per IP
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests – please try again later.' },
});

// Report download: 10 requests per minute per IP (file I/O intensive)
const downloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many download requests – please try again later.' },
});

// Manual run: 5 requests per minute per IP (expensive operation)
const runLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many run requests – please try again later.' },
});

const router = express.Router();
const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const HISTORY_DIR = path.join(__dirname, '..', 'data', 'history');

// ── GET /api/status ───────────────────────────────────────────────────────────
router.get('/status', readLimiter, (req, res) => {
  const { isRunning } = require('../jobs/dailyReportJob');
  res.json({ status: isRunning() ? 'running' : 'idle', timestamp: new Date().toISOString() });
});

// ── POST /api/run ─────────────────────────────────────────────────────────────
router.post('/run', runLimiter, async (req, res) => {
  try {
    const result = await runJob();
    if (!result) {
      return res.status(409).json({ error: 'Job already running or no targets found.' });
    }
    res.json({
      message: 'Report generated successfully.',
      summary: result.summary,
      changes: result.changes.length,
      filePath: result.filePath,
    });
  } catch (err) {
    console.error('[api/run]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/results ──────────────────────────────────────────────────────────
router.get('/results', readLimiter, (req, res) => {
  if (!fs.existsSync(HISTORY_DIR)) {
    return res.json({ results: [], message: 'No scan history found.' });
  }

  const today = new Date().toISOString().split('T')[0];
  const todayFile = path.join(HISTORY_DIR, `${today}.json`);

  // Try today, else return the most recent file
  let targetFile = todayFile;
  if (!fs.existsSync(targetFile)) {
    const files = fs.readdirSync(HISTORY_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();
    if (files.length === 0) {
      return res.json({ results: [], message: 'No scan history found.' });
    }
    targetFile = path.join(HISTORY_DIR, files[0]);
  }

  try {
    const data = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
    res.json({ date: path.basename(targetFile, '.json'), results: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read results: ' + err.message });
  }
});

// ── GET /api/report ───────────────────────────────────────────────────────────
router.get('/report', downloadLimiter, (req, res) => {
  if (!fs.existsSync(REPORTS_DIR)) {
    return res.status(404).json({ error: 'No reports found.' });
  }

  // Find the latest date directory
  const dateDirs = fs.readdirSync(REPORTS_DIR)
    .filter((d) => fs.statSync(path.join(REPORTS_DIR, d)).isDirectory())
    .sort()
    .reverse();

  if (dateDirs.length === 0) {
    return res.status(404).json({ error: 'No reports found.' });
  }

  const latestDir = path.join(REPORTS_DIR, dateDirs[0]);
  const xlsxFiles = fs.readdirSync(latestDir).filter((f) => f.endsWith('.xlsx'));

  if (xlsxFiles.length === 0) {
    return res.status(404).json({ error: 'No Excel file found in latest report directory.' });
  }

  const filePath = path.join(latestDir, xlsxFiles[0]);
  res.download(filePath, xlsxFiles[0]);
});

module.exports = router;
