/* ========================================
     State
  ======================================== */
  let results = [];
  let isRunning = false;
  let shouldStop = false;
  let currentFilter = 'all';

  /* ========================================
     DOM References
  ======================================== */
  const domainInput   = document.getElementById('domainInput');
  const domainCount   = document.getElementById('domainCount');
  const btnStart      = document.getElementById('btnStart');
  const btnStop       = document.getElementById('btnStop');
  const btnClear      = document.getElementById('btnClear');
  const btnSample     = document.getElementById('btnSample');
  const btnExport     = document.getElementById('btnExport');
  const speedMode     = document.getElementById('speedMode');
  const progressSection = document.getElementById('progressSection');
  const progressText  = document.getElementById('progressText');
  const progressPercent = document.getElementById('progressPercent');
  const progressFill  = document.getElementById('progressFill');
  const statsGrid     = document.getElementById('statsGrid');
  const resultsSection = document.getElementById('resultsSection');
  const resultsBody   = document.getElementById('resultsBody');
  const filterBar     = document.getElementById('filterBar');
  const emptyState    = document.getElementById('emptyState');

  /* ========================================
     Helpers
  ======================================== */

  /* Normalize a domain: strip protocol, www, path, port */
  function cleanDomain(raw) {
    let d = raw.trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '');
    d = d.replace(/^www\./, '');
    d = d.replace(/\/.*$/, '');
    d = d.replace(/:\d+$/, '');
    d = d.replace(/\s+/g, '');
    return d;
  }

  /* Parse textarea into unique, non-empty, normalized domains */
  function parseDomains() {
    const lines = domainInput.value.split(/\n/);
    const seen = new Set();
    const domains = [];
    for (const line of lines) {
      const d = cleanDomain(line);
      if (d && !seen.has(d)) {
        seen.add(d);
        domains.push(d);
      }
    }
    return domains;
  }

  function drClass(dr) {
    if (dr >= 70) return 'dr-top';
    if (dr >= 50) return 'dr-high';
    if (dr >= 20) return 'dr-med';
    return 'dr-low';
  }

  function drBarColor(dr) {
    if (dr >= 70) return 'var(--accent)';
    if (dr >= 50) return '#66ffbb';
    if (dr >= 20) return 'var(--warning)';
    return 'var(--error)';
  }

  /* Toast */
  function showToast(message, type) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';
    const iconMap = {
      ok: 'fa-circle-check ok',
      err: 'fa-circle-xmark err',
      warn: 'fa-triangle-exclamation warn'
    };
    toast.innerHTML =
      '<i class="fas ' + (iconMap[type] || iconMap.warn) + ' toast-icon"></i>' +
      '<span>' + message + '</span>';
    container.appendChild(toast);
    setTimeout(function() {
      toast.classList.add('toast-out');
      toast.addEventListener('animationend', function() { toast.remove(); });
    }, 4000);
  }

  function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  /* ========================================
     Domain count live update
  ======================================== */
  domainInput.addEventListener('input', function() {
    var domains = parseDomains();
    domainCount.textContent = domains.length + ' domain' + (domains.length !== 1 ? 's' : '');
  });

  /* ========================================
     Render helpers
  ======================================== */

  function updateProgress(current, total) {
    var pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressText.innerHTML = 'Checking <strong>' + current + ' / ' + total + '</strong>';
    progressPercent.textContent = pct + '%';
    progressFill.style.width = pct + '%';
  }

  function updateStats() {
    var successes = results.filter(function(r) { return r.status === 'ok'; });
    var failed = results.filter(function(r) { return r.status !== 'ok' && r.status !== 'checking'; });
    var drs = successes.map(function(r) { return r.dr3; }).filter(function(d) { return typeof d === 'number'; });
    var dr4s = successes.map(function(r) { return r.dr4; }).filter(function(d) { return typeof d === 'number'; });
    var avg = drs.length > 0 ? (drs.reduce(function(a, b) { return a + b; }, 0) / drs.length).toFixed(1) : '\u2014';
    var max = drs.length > 0 ? Math.max.apply(null, drs) : '\u2014';
    var high = drs.filter(function(d) { return d >= 50; }).length;

    document.getElementById('statTotal').textContent = results.length;
    document.getElementById('statSuccess').textContent = successes.length;
    document.getElementById('statFailed').textContent = failed.length;
    document.getElementById('statAvg').textContent = avg;
    document.getElementById('statMax').textContent = max;
    document.getElementById('statHigh').textContent = high;
    document.getElementById('statAvg4').textContent = dr4s.length ? (dr4s.reduce(function(a,b){return a+b;},0)/dr4s.length).toFixed(1) : '\u2014';
  }

  function renderResults() {
    var filtered = results.filter(function(r) {
      if (currentFilter === 'all') return true;
      if (currentFilter === 'high') return r.status === 'ok' && r.dr3 >= 50;
      if (currentFilter === 'med') return r.status === 'ok' && r.dr3 >= 20 && r.dr3 < 50;
      if (currentFilter === 'low') return r.status === 'ok' && r.dr3 < 20;
      if (currentFilter === 'error') return r.status === 'error';
      return true;
    });

    if (filtered.length === 0) {
      resultsBody.innerHTML =
        '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--fg-dim);">' +
        'No results match this filter.</td></tr>';
      return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      var r = filtered[i];
      var drBadge, drBar, statusHtml;

      if (r.status === 'ok') {
        drBadge = '<span class="dr-badge ' + drClass(r.dr3) + '">' + r.dr3 + '</span>';
        drBar = '<div class="dr-bar-track"><div class="dr-bar-fill" style="width:' +
                (r.dr3 || 0) + '%;background:' + drBarColor(r.dr3 || 0) + ';"></div></div>';
        statusHtml = r.error ? '<span class="status-err" title="' + escapeHtml(r.error) + '">Partial</span>' : '<span class="status-ok">OK</span>';
      } else if (r.status === 'checking') {
        drBadge = '<span style="color:var(--fg-dim);font-size:12px;">\u2014</span>';
        drBar = '<div class="dr-bar-track"><div class="dr-bar-fill" style="width:0%;"></div></div>';
        statusHtml = '<span class="status-wait"><span class="spinner"></span>Checking</span>';
      } else {
        drBadge = '<span style="color:var(--fg-dim);font-size:12px;">\u2014</span>';
        drBar = '<div class="dr-bar-track"><div class="dr-bar-fill" style="width:0%;"></div></div>';
        statusHtml = '<span class="status-err">' + escapeHtml(r.error) + '</span>';
      }

      html +=
        '<tr class="row-enter" style="animation-delay:' + Math.min(i * 20, 300) + 'ms">' +
        '<td class="td-num">' + (i + 1) + '</td>' +
        '<td class="td-domain"><span class="domain-with-icon"><img class="domain-favicon" src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(r.domain) + '&sz=32" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">' + escapeHtml(r.domain) + '</span></td>' +
        '<td class="td-dr">' + drBadge + '</td>' +
        '<td class="td-dr">' + (typeof r.dr4 === 'number' ? '<span class="dr-badge ' + drClass(r.dr4) + '">' + r.dr4 + '</span>' : '\u2014') + '</td>' +
        '<td class="td-dr">' + (typeof r.dr3 === 'number' && typeof r.dr4 === 'number' ? (r.dr4-r.dr3 > 0 ? '+' : '') + (Math.round((r.dr4-r.dr3)*10)/10) : '\u2014') + '</td>' +
        '<td class="dr-bar-cell">' + drBar + '</td>' +
        '<td class="td-status">' + statusHtml + '</td>' +
        '</tr>';
    }
    resultsBody.innerHTML = html;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  /* ========================================
     Filter chips
  ======================================== */
  filterBar.addEventListener('click', function(e) {
    var chip = e.target.closest('.filter-chip');
    if (!chip) return;
    var chips = filterBar.querySelectorAll('.filter-chip');
    for (var i = 0; i < chips.length; i++) chips[i].classList.remove('active');
    chip.classList.add('active');
    currentFilter = chip.dataset.filter;
    renderResults();
  });

  /* ========================================
     API call — calls YOUR backend, NOT Ahrefs
  ======================================== */
  async function fetchDR(domain) {
    var response;
    try {
      response = await fetch('/api/check-dr?target=' + encodeURIComponent(domain));
    } catch (err) {
      throw new Error('Cannot connect to local server. Make sure npm start is running.');
    }

    var data;
    try {
      data = await response.json();
    } catch (err) {
      throw new Error('Backend returned an invalid response.');
    }

    if (!response.ok || !data.success) {
      var apiError = new Error(data.error || 'Unknown error from backend');
      apiError.status = response.status;
      apiError.retryAfterMs = Number(data.retryAfterMs) || 0;
      throw apiError;
    }
    return data;
  }

  /* Retry only temporary errors. Avoid wasting time on invalid API keys and other permanent failures. */
  async function checkSingleDomain(domain) {
    var maxRetries = 2;
    for (var attempt = 0; attempt <= maxRetries; attempt++) {
      if (shouldStop) return { dr3: null, dr4: null, error: 'Stopped' };
      try {
        var data = await fetchDR(domain);
        return { dr3: data.dr3, dr4: data.dr4, errors: data.errors, error: null };
      } catch (err) {
        var message = err.message || 'Unknown error';
        var temporary = !err.status || err.status === 429 || err.status >= 500;
        if (!temporary || attempt === maxRetries) {
          return { dr3: null, dr4: null, error: message };
        }
        var waitMs = Math.max(err.retryAfterMs || 0, (attempt + 1) * 2000);
        await sleep(Math.min(waitMs, 15000));
      }
    }
  }

  /* Each server request fetches DR3 and DR4 concurrently. Here we check several domains
     concurrently too, keeping request volume bounded to respect Ahrefs rate limits. */
  async function startChecking() {
    if (isRunning) return;
    var domains = parseDomains();
    if (domains.length === 0) {
      showToast('Please enter at least one domain.', 'warn');
      return;
    }

    isRunning = true;
    shouldStop = false;
    currentFilter = 'all';
    var chips = filterBar.querySelectorAll('.filter-chip');
    for (var c = 0; c < chips.length; c++) chips[c].classList.remove('active');
    filterBar.querySelector('[data-filter="all"]').classList.add('active');

    btnStart.style.display = 'none';
    btnStop.style.display = 'inline-flex';
    btnClear.disabled = true;
    btnSample.disabled = true;
    domainInput.disabled = true;
    speedMode.disabled = true;
    progressSection.classList.add('active');
    statsGrid.classList.add('active');
    resultsSection.classList.add('active');
    emptyState.style.display = 'none';

    results = domains.map(function(domain) {
      return { domain: domain, dr3: null, dr4: null, status: 'checking', error: '' };
    });
    updateProgress(0, domains.length);
    updateStats();
    renderResults();

    var settings = {
      fast: { workers: 5, launchGap: 0 },
      balanced: { workers: 3, launchGap: 150 },
      safe: { workers: 1, launchGap: 1200 }
    }[speedMode.value] || { workers: 3, launchGap: 150 };

    var nextIndex = 0;
    var completed = 0;
    var lastLaunch = 0;
    var launchGate = Promise.resolve();

    // Serialize brief launch spacing, not the full API work.
    function reserveNext() {
      var take;
      launchGate = launchGate.then(async function() {
        if (shouldStop || nextIndex >= domains.length) return;
        var gap = Math.max(0, lastLaunch + settings.launchGap - Date.now());
        if (gap) await sleep(gap);
        if (shouldStop) return;
        take = nextIndex++;
        lastLaunch = Date.now();
      });
      return launchGate.then(function() { return take; });
    }

    async function worker() {
      while (!shouldStop) {
        var index = await reserveNext();
        if (index === undefined) break;
        var result = await checkSingleDomain(domains[index]);
        var entry = results[index];
        entry.dr3 = result.dr3;
        entry.dr4 = result.dr4;
        entry.errors = result.errors;
        entry.error = result.error || Object.entries(result.errors || {})
          .filter(function(pair) { return pair[1]; })
          .map(function(pair) { return pair[0].toUpperCase() + ': ' + pair[1]; })
          .join('; ');
        entry.status = result.error ? 'error' : 'ok';
        completed++;
        updateProgress(completed, domains.length);
        updateStats();
        renderResults();
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(settings.workers, domains.length) }, worker));
    } finally {
      // When stopped, remove unstarted placeholders to avoid fake 'Checking' rows.
      if (shouldStop) results = results.filter(function(r) { return r.status !== 'checking'; });
      isRunning = false;
      btnStart.style.display = 'inline-flex';
      btnStop.style.display = 'none';
      btnClear.disabled = false;
      btnSample.disabled = false;
      domainInput.disabled = false;
      speedMode.disabled = false;
      updateStats();
      renderResults();
      updateProgress(results.length, results.length);
    }

    var okCount = results.filter(function(r) { return r.status === 'ok'; }).length;
    var errCount = results.filter(function(r) { return r.status === 'error'; }).length;
    if (shouldStop) {
      showToast('Stopped. ' + okCount + ' checked, ' + errCount + ' failed.', 'warn');
    } else if (errCount === 0) {
      showToast('All ' + okCount + ' domains checked successfully!', 'ok');
    } else {
      showToast('Done. ' + okCount + ' OK, ' + errCount + ' failed.', errCount > okCount ? 'err' : 'warn');
    }
  }

  /* ========================================
     Button handlers
  ======================================== */
  btnStart.addEventListener('click', startChecking);

  btnStop.addEventListener('click', function() {
    shouldStop = true;
    showToast('Stopping new checks. Active requests will finish.', 'warn');
  });

  btnClear.addEventListener('click', function() {
    domainInput.value = '';
    domainCount.textContent = '0 domains';
    results = [];
    resultsBody.innerHTML = '';
    progressSection.classList.remove('active');
    statsGrid.classList.remove('active');
    resultsSection.classList.remove('active');
    emptyState.style.display = '';
    showToast('Cleared.', 'ok');
  });

  btnSample.addEventListener('click', function() {
    domainInput.value = 'google.com\ngithub.com\nwikipedia.org\nbbc.com\nahrefs.com';
    domainInput.dispatchEvent(new Event('input'));
    showToast('Sample domains loaded.', 'ok');
  });

  /* ========================================
     CSV Export
  ======================================== */
  btnExport.addEventListener('click', function() {
    if (results.length === 0) {
      showToast('No results to export.', 'warn');
      return;
    }
    var csv = 'Domain,DR3,DR4,Difference,Status\n';
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var dr3 = typeof r.dr3 === 'number' ? r.dr3 : '';
      var dr4 = typeof r.dr4 === 'number' ? r.dr4 : '';
      var diff = dr3 !== '' && dr4 !== '' ? Math.round((dr4-dr3)*10)/10 : '';
      var status = r.status === 'ok' ? 'OK' : r.error;
      csv += '"' + r.domain + '",' + dr3 + ',' + dr4 + ',' + diff + ',"' + status.replace(/"/g, '""') + '"\n';
    }
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'dr-check-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV downloaded.', 'ok');
  });

  /* ========================================
     Keyboard shortcut: Ctrl+Enter to start
  ======================================== */
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !isRunning) {
      e.preventDefault();
      startChecking();
    }
  });
