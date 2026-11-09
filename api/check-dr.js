const AHREFS_ENDPOINT = 'https://api.ahrefs.com/v3/public/domain-rating-free';
const AHREFS_API_KEY = process.env.AHREFS_API_KEY;

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
        Authorization: `Bearer ${AHREFS_API_KEY}`,
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

  if (!AHREFS_API_KEY) {
    return sendJson(res, 500, {
      success: false,
      domain,
      error: 'AHREFS_API_KEY is not configured on the server.'
    });
  }

  async function getVersion(version) {
    const apiUrl = `${AHREFS_ENDPOINT}?target=${encodeURIComponent(domain)}&version=${version}&output=json`;
    try {
      const response = await fetchWithTimeout(apiUrl, 20000);
      const raw = await response.text();
      if (!response.ok) {
        let detail = raw;
        try { const parsed = JSON.parse(raw); detail = parsed.error || parsed.message || raw; } catch (_) {}
        const after = response.headers.get('retry-after');
        const seconds = after ? Number(after) : NaN;
        const retryAfterMs = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
        return { value: null, error: `HTTP ${response.status}: ${String(detail).slice(0, 150)}`, status: response.status, retryAfterMs };
      }
      const data = JSON.parse(raw);
      const value = data?.domain_rating?.domain_rating;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { value: null, error: 'Missing or invalid Domain Rating' };
      }
      return { value, error: null };
    } catch (error) {
      return { value: null, error: error.name === 'AbortError' ? 'Request timed out' : (error.message || 'API error') };
    }
  }

  const [v3, v4] = await Promise.all([getVersion('dr3'), getVersion('dr4')]);
  const bothFailed = !!v3.error && !!v4.error;
  const statuses = [v3.status, v4.status].filter(Boolean);
  const failureStatus = statuses.includes(429) ? 429 :
    (statuses.includes(401) ? 401 : statuses.includes(403) ? 403 : 502);
  return sendJson(res, bothFailed ? failureStatus : 200, {
    success: !bothFailed,
    domain,
    dr3: v3.value,
    dr4: v4.value,
    errors: { dr3: v3.error, dr4: v4.error },
    retryAfterMs: Math.max(v3.retryAfterMs || 0, v4.retryAfterMs || 0),
    error: v3.error && v4.error ? `DR3: ${v3.error}; DR4: ${v4.error}` : null
  });
};
