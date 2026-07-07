const AHREFS_ENDPOINT = 'https://api.ahrefs.com/v3/public/domain-rating-free';

function normalizeDomain(raw) {
  if (!raw || typeof raw !== 'string') return '';

  let value = raw.trim().toLowerCase();
  if (!value) return '';

  // Add a temporary protocol so URL can remove paths, query strings, hashes, and ports.
  if (!/^https?:\/\//i.test(value)) {
    value = 'http://' + value;
  }

  try {
    const parsed = new URL(value);
    let hostname = parsed.hostname.toLowerCase();
    hostname = hostname.replace(/^www\./, '');
    hostname = hostname.replace(/\.$/, '');
    return hostname;
  } catch (error) {
    return raw
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '')
      .replace(/\.$/, '');
  }
}

function isValidDomain(domain) {
  if (!domain || domain.length > 253) return false;
  if (domain.includes('..')) return false;
  if (domain.includes('_')) return false;

  const domainRegex = /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i;
  return domainRegex.test(domain);
}

async function fetchWithTimeout(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'BulkDRCheckerVercel/1.0'
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, {
      success: false,
      domain: '',
      error: 'Method not allowed. Use GET.'
    });
  }

  const input = req.query?.target;
  const domain = normalizeDomain(input);

  if (!domain) {
    return sendJson(res, 400, {
      success: false,
      domain: '',
      error: 'Target domain is required.'
    });
  }

  if (!isValidDomain(domain)) {
    return sendJson(res, 400, {
      success: false,
      domain,
      error: 'Invalid domain format.'
    });
  }

  const apiUrl = `${AHREFS_ENDPOINT}?target=${encodeURIComponent(domain)}&output=json`;

  try {
    const ahrefsResponse = await fetchWithTimeout(apiUrl, 20000);
    const rawText = await ahrefsResponse.text();

    if (!ahrefsResponse.ok) {
      let detail = rawText;
      try {
        const parsedError = JSON.parse(rawText);
        detail = parsedError?.error || parsedError?.message || rawText;
      } catch (_) {}

      return sendJson(res, ahrefsResponse.status, {
        success: false,
        domain,
        error: `Ahrefs API returned HTTP ${ahrefsResponse.status}${detail ? ': ' + String(detail).slice(0, 180) : ''}`
      });
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (error) {
      return sendJson(res, 502, {
        success: false,
        domain,
        error: 'Ahrefs returned invalid JSON.'
      });
    }

    const dr = data?.domain_rating?.domain_rating;
    if (typeof dr !== 'number' || Number.isNaN(dr)) {
      return sendJson(res, 502, {
        success: false,
        domain,
        error: 'Ahrefs response did not include a Domain Rating value.'
      });
    }

    return sendJson(res, 200, {
      success: true,
      domain,
      dr
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      return sendJson(res, 504, {
        success: false,
        domain,
        error: 'Ahrefs request timed out after 20 seconds.'
      });
    }

    return sendJson(res, 502, {
      success: false,
      domain,
      error: error.message || 'Network error while contacting Ahrefs.'
    });
  }
};
