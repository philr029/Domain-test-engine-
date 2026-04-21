/**
 * services/virustotal.js
 *
 * Checks an IP or domain against the VirusTotal API (v3).
 * Docs: https://developers.virustotal.com/reference/overview
 *
 * Returns a normalised result object.
 */

const axios = require('axios');

const SOURCE = 'VirusTotal';
const BASE_URL = 'https://www.virustotal.com/api/v3';

/**
 * Build the VirusTotal endpoint URL for a given target type.
 * @param {string} target
 * @param {'ip'|'domain'} type
 * @returns {string}
 */
function buildUrl(target, type) {
  if (type === 'ip') return `${BASE_URL}/ip_addresses/${target}`;
  return `${BASE_URL}/domains/${target}`;
}

/**
 * Determine status from VirusTotal stats.
 * @param {{malicious:number, suspicious:number}} stats
 * @returns {{ status: string, confidence_score: number }}
 */
function deriveStatus(stats) {
  const malicious = stats.malicious || 0;
  const suspicious = stats.suspicious || 0;
  const total = Object.values(stats).reduce((a, b) => a + b, 0) || 1;
  const score = Math.round(((malicious + suspicious) / total) * 100);

  let status;
  if (malicious > 0) {
    status = 'blacklisted';
  } else if (suspicious > 0) {
    status = 'suspicious';
  } else {
    status = 'clean';
  }

  return { status, confidence_score: score };
}

/**
 * Check a target (IP or domain) against VirusTotal.
 * @param {string} target
 * @param {'ip'|'domain'} type
 * @returns {Promise<object>}
 */
async function check(target, type) {
  const checkedAt = new Date().toISOString();
  const apiKey = process.env.VIRUSTOTAL_API_KEY;

  if (!apiKey) {
    return {
      target,
      type,
      source: SOURCE,
      status: 'error',
      confidence_score: 0,
      details: 'API key not configured',
      checked_at: checkedAt,
    };
  }

  try {
    const url = buildUrl(target, type);
    const response = await axios.get(url, {
      headers: { 'x-apikey': apiKey },
      timeout: 15000,
    });

    const stats = response.data.data.attributes.last_analysis_stats || {};
    const { status, confidence_score } = deriveStatus(stats);

    return {
      target,
      type,
      source: SOURCE,
      status,
      confidence_score,
      details: `Malicious: ${stats.malicious || 0}, Suspicious: ${stats.suspicious || 0}, Harmless: ${stats.harmless || 0}, Undetected: ${stats.undetected || 0}`,
      checked_at: checkedAt,
    };
  } catch (err) {
    const code = err.response ? err.response.status : null;
    return {
      target,
      type,
      source: SOURCE,
      status: 'error',
      confidence_score: 0,
      details: code ? `HTTP ${code}: ${err.message}` : `Request failed: ${err.message}`,
      checked_at: checkedAt,
    };
  }
}

module.exports = { check };
