/**
 * services/hetrixtools.js
 *
 * Checks an IP or domain against the HetrixTools Blacklist API.
 * Docs: https://hetrixtools.com/resources/api-blacklist-check/
 *
 * Returns a normalised result object.
 */

const axios = require('axios');

const SOURCE = 'HetrixTools';
const BASE_URL = 'https://api.hetrixtools.com/v3';

/**
 * Check a target against HetrixTools Blacklist API.
 * @param {string} target  IP address or domain name
 * @param {'ip'|'domain'} type
 * @returns {Promise<object>}
 */
async function check(target, type) {
  const checkedAt = new Date().toISOString();
  const apiKey = process.env.HETRIXTOOLS_API_KEY;

  if (!apiKey) {
    return {
      target,
      type,
      source: SOURCE,
      status: 'error',
      confidence_score: 0,
      details: 'API key not configured – HetrixTools skipped',
      checked_at: checkedAt,
    };
  }

  try {
    // HetrixTools endpoint: /blacklist-check/<type>/<target>/
    const endpoint = type === 'ip' ? 'blacklist-check/ipv4' : 'blacklist-check/domain';
    const url = `${BASE_URL}/${endpoint}/${target}/`;

    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 15000,
    });

    const result = response.data;
    // blacklisted_count is the number of lists that flagged this target
    const blacklistedCount = result.blacklisted_count || 0;
    const totalLists = result.listed_count || 1;
    const score = Math.round((blacklistedCount / totalLists) * 100);

    let status;
    if (blacklistedCount === 0) {
      status = 'clean';
    } else if (blacklistedCount <= 2) {
      status = 'suspicious';
    } else {
      status = 'blacklisted';
    }

    return {
      target,
      type,
      source: SOURCE,
      status,
      confidence_score: score,
      details: `Blacklisted on ${blacklistedCount}/${totalLists} lists`,
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
