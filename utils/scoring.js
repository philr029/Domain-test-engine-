/**
 * utils/scoring.js
 *
 * Aggregates raw results from multiple check sources into a single
 * normalised verdict per target.
 *
 * Verdict priority (highest wins):
 *   blacklisted > suspicious > clean > error
 *
 * Overall confidence_score = average of all non-error scores.
 */

/** Priority map – higher number wins. */
const PRIORITY = {
  blacklisted: 3,
  suspicious: 2,
  clean: 1,
  error: 0,
};

/**
 * Compute an aggregate verdict for one target from multiple source results.
 *
 * @param {object[]} results  Array of normalised source results for ONE target.
 * @returns {{
 *   target: string,
 *   type: string,
 *   verdict: 'BLACKLISTED'|'SUSPICIOUS'|'SAFE'|'ERROR',
 *   overall_score: number,
 *   source_count: number,
 *   error_count: number,
 *   results: object[]
 * }}
 */
function computeVerdict(results) {
  if (!results || results.length === 0) {
    return {
      target: '',
      type: '',
      verdict: 'ERROR',
      overall_score: 0,
      source_count: 0,
      error_count: 0,
      results: [],
    };
  }

  const { target, type } = results[0];
  let topPriority = 0;
  let topStatus = 'error';
  let scoreSum = 0;
  let scoreCount = 0;
  let errorCount = 0;

  for (const r of results) {
    const p = PRIORITY[r.status] ?? 0;
    if (p > topPriority) {
      topPriority = p;
      topStatus = r.status;
    }
    if (r.status !== 'error') {
      scoreSum += r.confidence_score;
      scoreCount++;
    } else {
      errorCount++;
    }
  }

  const overall_score = scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0;

  const verdictMap = {
    blacklisted: 'BLACKLISTED',
    suspicious: 'SUSPICIOUS',
    clean: 'SAFE',
    error: 'ERROR',
  };

  return {
    target,
    type,
    verdict: verdictMap[topStatus] || 'ERROR',
    overall_score,
    source_count: results.length,
    error_count: errorCount,
    results,
  };
}

/**
 * Run all available check services against every target in the list.
 *
 * Providers are loaded dynamically; if an API key is missing the service
 * returns a graceful "error" result so we never crash the whole run.
 *
 * @param {object[]} targets  Array of { target, type, label } objects.
 * @returns {Promise<object[]>}  Array of aggregated verdict objects (one per target).
 */
async function runAllChecks(targets) {
  const services = [
    require('../services/abuseipdb'),
    require('../services/virustotal'),
    require('../services/hetrixtools'),
    // Add new providers here – just implement check(target, type)
  ];

  const aggregated = [];

  for (const item of targets) {
    // Run all services in parallel for this target
    const rawResults = await Promise.all(
      services.map((svc) => svc.check(item.target, item.type))
    );

    const verdict = computeVerdict(rawResults);
    // Attach label from the input
    verdict.label = item.label || '';
    aggregated.push(verdict);
  }

  return aggregated;
}

module.exports = { computeVerdict, runAllChecks };
