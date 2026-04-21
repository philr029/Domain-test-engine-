/**
 * services/abuseipdb.js
 *
 * Checks an IP address against the AbuseIPDB API.
 * Docs: https://docs.abuseipdb.com/#check-endpoint
 *
 * Returns a normalised result object:
 * {
 *   target, type, source, status, confidence_score, details, checked_at
 * }
 */

const axios = require('axios');

const SOURCE = 'AbuseIPDB';
const BASE_URL = 'https://api.abuseipdb.com/api/v2/check';

/**
 * Check a single IP against AbuseIPDB.
 * @param {string} ip
 * @returns {Promise<object>} normalised result
 */
async function checkIP(ip) {
  const checkedAt = new Date().toISOString();
  const apiKey = process.env.ABUSEIPDB_API_KEY;

  if (!apiKey) {
    return {
      target: ip,
      type: 'ip',
      source: SOURCE,
      status: 'error',
      confidence_score: 0,
      details: 'API key not configured',
      checked_at: checkedAt,
    };
  }

  try {
    const response = await axios.get(BASE_URL, {
      headers: { Key: apiKey, Accept: 'application/json' },
      params: { ipAddress: ip, maxAgeInDays: 90, verbose: false },
      timeout: 10000,
    });

    const data = response.data.data;
    const score = data.abuseConfidenceScore; // 0–100

    let status;
    if (score === 0) {
      status = 'clean';
    } else if (score < 50) {
      status = 'suspicious';
    } else {
      status = 'blacklisted';
    }

    return {
      target: ip,
      type: 'ip',
      source: SOURCE,
      status,
      confidence_score: score,
      details: `Abuse confidence score: ${score}. Total reports: ${data.totalReports}. Country: ${data.countryCode || 'N/A'}`,
      checked_at: checkedAt,
    };
  } catch (err) {
    return {
      target: ip,
      type: 'ip',
      source: SOURCE,
      status: 'error',
      confidence_score: 0,
      details: `Request failed: ${err.message}`,
      checked_at: checkedAt,
    };
  }
}

/**
 * AbuseIPDB only supports IP lookups, not domain lookups.
 * Returns a graceful skip result for domain targets.
 * @param {string} domain
 * @returns {object}
 */
function checkDomain(domain) {
  return {
    target: domain,
    type: 'domain',
    source: SOURCE,
    status: 'error',
    confidence_score: 0,
    details: 'AbuseIPDB does not support domain lookups',
    checked_at: new Date().toISOString(),
  };
}

/**
 * Universal entry point – routes to the right method based on type.
 * @param {string} target
 * @param {'ip'|'domain'} type
 * @returns {Promise<object>}
 */
async function check(target, type) {
  if (type === 'ip') return checkIP(target);
  return checkDomain(target);
}

module.exports = { check };
