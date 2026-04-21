/**
 * jobs/dailyReportJob.js
 *
 * Schedules (and runs) the daily blacklist monitoring report.
 *
 * - Uses node-cron for scheduling
 * - Prevents duplicate concurrent runs via a simple lock flag
 * - Loads yesterday's scan results for diff comparison
 * - Persists each run's results to /data/history/<date>.json
 * - Skips emailing if EMAIL_ONLY_ON_CHANGE=true and nothing changed
 */

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const { runAllChecks } = require('../utils/scoring');
const { generateReport } = require('../utils/excelReport');
const { sendReportEmail } = require('../utils/sendEmail');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const TARGETS_FILE = path.join(DATA_DIR, 'targets.json');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');

// Simple in-process lock to prevent concurrent runs
let isRunning = false;

/**
 * Load targets from the JSON config file.
 * @returns {object[]}
 */
function loadTargets() {
  if (!fs.existsSync(TARGETS_FILE)) {
    console.warn(`[job] targets.json not found at ${TARGETS_FILE}`);
    return [];
  }
  return JSON.parse(fs.readFileSync(TARGETS_FILE, 'utf-8'));
}

/**
 * Load yesterday's results (if they exist) for diff comparison.
 * @returns {object[]|null}
 */
function loadYesterdayResults() {
  if (!fs.existsSync(HISTORY_DIR)) return null;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];
  const file = path.join(HISTORY_DIR, `${dateStr}.json`);

  if (!fs.existsSync(file)) return null;

  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Persist today's results to history for tomorrow's diff.
 * @param {object[]} verdicts
 */
function saveHistory(verdicts) {
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }
  const dateStr = new Date().toISOString().split('T')[0];
  const file = path.join(HISTORY_DIR, `${dateStr}.json`);
  fs.writeFileSync(file, JSON.stringify(verdicts, null, 2));
  console.log(`[job] History saved: ${file}`);
}

/**
 * The core job logic – checks all targets, builds the report, emails it.
 * Can be called from the cron schedule or from an API endpoint.
 *
 * @returns {Promise<{filePath: string, summary: object, changes: object[]}>}
 */
async function runJob() {
  if (isRunning) {
    console.warn('[job] Previous run still in progress – skipping.');
    return null;
  }

  isRunning = true;
  const startTime = Date.now();
  console.log('[job] Starting daily blacklist scan…');

  try {
    const targets = loadTargets();
    if (targets.length === 0) {
      console.warn('[job] No targets found – aborting.');
      return null;
    }

    // Run all checks
    const verdicts = await runAllChecks(targets);

    // Load yesterday's results for diff
    const yesterdayVerdicts = loadYesterdayResults();

    // Save today's results to history
    saveHistory(verdicts);

    // Generate the Excel report (saved to /reports/<date>/)
    const dateStr = new Date().toISOString().split('T')[0];
    const outputDir = path.join(REPORTS_DIR, dateStr);
    const { filePath, summary, changes } = await generateReport(verdicts, yesterdayVerdicts, outputDir);

    // Decide whether to send the email
    const onlyOnChange = (process.env.EMAIL_ONLY_ON_CHANGE || 'false').toLowerCase() === 'true';
    if (!onlyOnChange || changes.length > 0) {
      await sendReportEmail(filePath, summary, changes);
    } else {
      console.log('[job] EMAIL_ONLY_ON_CHANGE=true and no changes detected – email skipped.');
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[job] Completed in ${duration}s. Verdict: ${summary.total} checked, ${summary.blacklisted} blacklisted, ${summary.suspicious} suspicious.`);

    return { filePath, summary, changes, verdicts };
  } catch (err) {
    console.error('[job] Job failed:', err);
    throw err;
  } finally {
    isRunning = false;
  }
}

/**
 * Register the cron schedule and start the job runner.
 * Called once from server.js at startup.
 */
function startScheduler() {
  const schedule = process.env.CRON_SCHEDULE || '0 8 * * *';
  const timezone = process.env.CRON_TIMEZONE || 'UTC';

  if (!cron.validate(schedule)) {
    console.error(`[job] Invalid cron expression: "${schedule}"`);
    return;
  }

  cron.schedule(schedule, () => {
    console.log(`[job] Cron triggered at ${new Date().toISOString()}`);
    runJob().catch((err) => console.error('[job] Unhandled error in cron run:', err));
  }, { timezone });

  console.log(`[job] Scheduler started – cron: "${schedule}", timezone: ${timezone}`);
}

module.exports = { startScheduler, runJob, isRunning: () => isRunning };
