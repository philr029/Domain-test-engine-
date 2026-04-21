/**
 * utils/excelReport.js
 *
 * Generates a formatted Excel workbook containing:
 *  1. Summary sheet
 *  2. Detailed Results sheet
 *  3. Changes sheet (diff vs. yesterday)
 *
 * Uses ExcelJS for rich formatting (colours, bold headers, auto-filters).
 */

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

// ─── Colour palette ──────────────────────────────────────────────────────────
const COLORS = {
  headerBg: 'FF1A1A2E',   // dark blue
  headerFont: 'FFFFFFFF', // white
  clean: 'FFD9EAD3',      // light green
  suspicious: 'FFFFF2CC', // light yellow
  blacklisted: 'FFFCE4D6',// light red
  error: 'FFF3F3F3',      // light grey
  cleanFont: 'FF274E13',
  suspiciousFont: 'FF7F6000',
  blacklistedFont: 'FF990000',
};

/** Map verdict/status → row fill colour. */
function rowColor(status) {
  const s = (status || '').toLowerCase();
  if (s === 'clean' || s === 'safe') return COLORS.clean;
  if (s === 'suspicious') return COLORS.suspicious;
  if (s === 'blacklisted') return COLORS.blacklisted;
  return COLORS.error;
}

/** Style a header row: bold white text on dark-blue background. */
function styleHeader(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: COLORS.headerFont } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLORS.headerBg },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFAAAAAA' } },
    };
  });
}

/** Auto-size all columns based on content (max 60 chars). */
function autoSize(worksheet) {
  worksheet.columns.forEach((col) => {
    let maxLen = col.header ? col.header.length : 10;
    col.eachCell({ includeEmpty: true }, (cell) => {
      const len = cell.value ? String(cell.value).length : 0;
      if (len > maxLen) maxLen = len;
    });
    col.width = Math.min(maxLen + 4, 60);
  });
}

/**
 * Build a Summary object from an array of verdict results.
 * @param {object[]} verdicts
 * @returns {object}
 */
function buildSummary(verdicts) {
  const today = new Date().toISOString().split('T')[0];
  let clean = 0, suspicious = 0, blacklisted = 0, errors = 0;

  for (const v of verdicts) {
    const vrd = (v.verdict || '').toUpperCase();
    if (vrd === 'SAFE') clean++;
    else if (vrd === 'SUSPICIOUS') suspicious++;
    else if (vrd === 'BLACKLISTED') blacklisted++;
    else errors++;
  }

  return {
    date: today,
    total: verdicts.length,
    clean,
    suspicious,
    blacklisted,
    errors,
  };
}

/**
 * Compute the Changes array by comparing today's verdicts with yesterday's.
 * @param {object[]} todayVerdicts
 * @param {object[]|null} yesterdayVerdicts
 * @returns {object[]}
 */
function computeChanges(todayVerdicts, yesterdayVerdicts) {
  if (!yesterdayVerdicts || yesterdayVerdicts.length === 0) return [];

  const yesterdayMap = {};
  for (const v of yesterdayVerdicts) {
    yesterdayMap[v.target] = v;
  }

  const changes = [];
  for (const today of todayVerdicts) {
    const yesterday = yesterdayMap[today.target];
    if (!yesterday) {
      changes.push({ ...today, change: 'new_target', prev_verdict: 'N/A' });
      continue;
    }
    if (today.verdict !== yesterday.verdict) {
      let changeLabel = 'verdict_changed';
      if (today.verdict === 'BLACKLISTED') changeLabel = 'now_blacklisted';
      else if (today.verdict === 'SAFE' && yesterday.verdict !== 'SAFE') changeLabel = 'now_clean';
      changes.push({
        ...today,
        change: changeLabel,
        prev_verdict: yesterday.verdict,
        prev_score: yesterday.overall_score,
      });
    } else if (Math.abs(today.overall_score - (yesterday.overall_score || 0)) >= 10) {
      changes.push({
        ...today,
        change: 'score_changed',
        prev_verdict: yesterday.verdict,
        prev_score: yesterday.overall_score,
      });
    }
  }
  return changes;
}

/**
 * Generate an Excel workbook and save it to disk.
 *
 * @param {object[]} verdicts          Today's aggregated verdict results.
 * @param {object[]|null} yesterdayVerdicts  Yesterday's results (for diff).
 * @param {string} outputDir           Directory to save the file.
 * @returns {Promise<{filePath: string, summary: object, changes: object[]}>}
 */
async function generateReport(verdicts, yesterdayVerdicts, outputDir) {
  const summary = buildSummary(verdicts);
  const changes = computeChanges(verdicts, yesterdayVerdicts);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Domain Blacklist Monitor';
  workbook.created = new Date();

  // ── Sheet 1: Summary ──────────────────────────────────────────────────────
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 20 },
  ];
  styleHeader(summarySheet.getRow(1));
  summarySheet.addRows([
    { metric: 'Report Date', value: summary.date },
    { metric: 'Total Targets Checked', value: summary.total },
    { metric: 'Clean / Safe', value: summary.clean },
    { metric: 'Suspicious', value: summary.suspicious },
    { metric: 'Blacklisted', value: summary.blacklisted },
    { metric: 'Errors', value: summary.errors },
  ]);

  // ── Sheet 2: Detailed Results ─────────────────────────────────────────────
  const detailSheet = workbook.addWorksheet('Detailed Results');
  detailSheet.columns = [
    { header: 'Target',           key: 'target',           width: 20 },
    { header: 'Type',             key: 'type',             width: 10 },
    { header: 'Label',            key: 'label',            width: 20 },
    { header: 'Source',           key: 'source',           width: 14 },
    { header: 'Status',           key: 'status',           width: 14 },
    { header: 'Confidence Score', key: 'confidence_score', width: 18 },
    { header: 'Verdict',          key: 'verdict',          width: 14 },
    { header: 'Details',          key: 'details',          width: 50 },
    { header: 'Checked At',       key: 'checked_at',       width: 22 },
  ];
  styleHeader(detailSheet.getRow(1));
  detailSheet.autoFilter = 'A1:I1';

  for (const v of verdicts) {
    for (const r of v.results) {
      const row = detailSheet.addRow({
        target: v.target,
        type: v.type,
        label: v.label,
        source: r.source,
        status: r.status,
        confidence_score: r.confidence_score,
        verdict: v.verdict,
        details: r.details,
        checked_at: r.checked_at,
      });
      const fillColor = rowColor(r.status);
      row.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: fillColor },
        };
      });
    }
  }

  // ── Sheet 3: Changes ──────────────────────────────────────────────────────
  const changesSheet = workbook.addWorksheet('Changes');
  changesSheet.columns = [
    { header: 'Target',         key: 'target',       width: 20 },
    { header: 'Type',           key: 'type',         width: 10 },
    { header: 'Label',          key: 'label',        width: 20 },
    { header: 'Change',         key: 'change',       width: 18 },
    { header: 'Current Verdict',key: 'verdict',      width: 18 },
    { header: 'Previous Verdict',key:'prev_verdict', width: 18 },
    { header: 'Current Score',  key: 'overall_score',width: 15 },
    { header: 'Previous Score', key: 'prev_score',   width: 15 },
  ];
  styleHeader(changesSheet.getRow(1));
  changesSheet.autoFilter = 'A1:H1';

  if (changes.length === 0) {
    changesSheet.addRow({ target: 'No changes detected', type: '', label: '', change: '', verdict: '', prev_verdict: '', overall_score: '', prev_score: '' });
  } else {
    for (const c of changes) {
      const row = changesSheet.addRow({
        target: c.target,
        type: c.type,
        label: c.label,
        change: c.change,
        verdict: c.verdict,
        prev_verdict: c.prev_verdict,
        overall_score: c.overall_score,
        prev_score: c.prev_score ?? '',
      });
      const fillColor = rowColor(c.verdict);
      row.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: fillColor },
        };
      });
    }
  }

  // Auto-size every sheet
  [summarySheet, detailSheet, changesSheet].forEach(autoSize);

  // ── Save to disk ──────────────────────────────────────────────────────────
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const fileName = `report-${summary.date}.xlsx`;
  const filePath = path.join(outputDir, fileName);
  await workbook.xlsx.writeFile(filePath);

  console.log(`[excelReport] Report saved: ${filePath}`);
  return { filePath, summary, changes };
}

module.exports = { generateReport, buildSummary, computeChanges };
