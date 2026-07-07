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
  const delayMs       = document.getElementById('delayMs');
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
    var drs = successes.map(function(r) { return r.dr; });
    var avg = drs.length > 0 ? (drs.reduce(function(a, b) { return a + b; }, 0) / drs.length).toFixed(1) : '\u2014';
    var max = drs.length > 0 ? Math.max.apply(null, drs) : '\u2014';
    var high = drs.filter(function(d) { return d >= 50; }).length;

    document.getElementById('statTotal').textContent = results.length;
    document.getElementById('statSuccess').textContent = successes.length;
    document.getElementById('statFailed').textContent = failed.length;
    document.getElementById('statAvg').textContent = avg;
    document.getElementById('statMax').textContent = max;
    document.getElementById('statHigh').textContent = high;
  }

  function renderResults() {
    var filtered = results.filter(function(r) {
      if (currentFilter === 'all') return true;
      if (currentFilter === 'high') return r.status === 'ok' && r.dr >= 50;
      if (currentFilter === 'med') return r.status === 'ok' && r.dr >= 20 && r.dr < 50;
      if (currentFilter === 'low') return r.status === 'ok' && r.dr < 20;
      if (currentFilter === 'error') return r.status === 'error';
      return true;
    });

    if (filtered.length === 0) {
      resultsBody.innerHTML =
        '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--fg-dim);">' +
        'No results match this filter.</td></tr>';
      return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      var r = filtered[i];
      var drBadge, drBar, statusHtml;

      if (r.status === 'ok') {
        drBadge = '<span class="dr-badge ' + drClass(r.dr) + '">' + r.dr + '</span>';
        drBar = '<div class="dr-bar-track"><div class="dr-bar-fill" style="width:' +
                r.dr + '%;background:' + drBarColor(r.dr) + ';"></div></div>';
        statusHtml = '<span class="status-ok">OK</span>';
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
        '<td class="td-domain">' + escapeHtml(r.domain) + '</td>' +
        '<td class="td-dr">' + drBadge + '</td>' +
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
      throw new Error(data.error || 'Unknown error from backend');
    }
    return data.dr;
  }

  /* Check a single domain with up to 2 retries */
  async function checkSingleDomain(domain) {
    var maxRetries = 2;
    var lastError = '';

    for (var attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        var dr = await fetchDR(domain);
        return { dr: dr, error: null };
      } catch (err) {
        lastError = err.message || 'Unknown error';
        if (attempt < maxRetries) {
          /* Wait 2 seconds before retrying */
          await sleep(2000);
        }
      }
    }

    return { dr: 0, error: lastError };
  }

  /* ========================================
     Main checking logic
  ======================================== */
  async function startChecking() {
    var domains = parseDomains();
    if (domains.length === 0) {
      showToast('Please enter at least one domain.', 'warn');
      return;
    }

    isRunning = true;
    shouldStop = false;
    results = [];
    currentFilter = 'all';

    /* Reset filter chips */
    var chips = filterBar.querySelectorAll('.filter-chip');
    for (var c = 0; c < chips.length; c++) chips[c].classList.remove('active');
    filterBar.querySelector('[data-filter="all"]').classList.add('active');

    /* UI state */
    btnStart.style.display = 'none';
    btnStop.style.display = 'inline-flex';
    btnClear.disabled = true;
    btnSample.disabled = true;
    domainInput.disabled = true;
    progressSection.classList.add('active');
    statsGrid.classList.add('active');
    resultsSection.classList.add('active');
    emptyState.style.display = 'none';
    updateProgress(0, domains.length);

    var delay = parseInt(delayMs.value, 10);

    for (var i = 0; i < domains.length; i++) {
      if (shouldStop) break;

      var domain = domains[i];

      /* Add checking placeholder */
      results.push({ domain: domain, dr: 0, status: 'checking', error: '' });
      updateProgress(i + 1, domains.length);
      updateStats();
      renderResults();

      /* Check with retries */
      var result = await checkSingleDomain(domain);

      /* Find the entry and update it */
      var entry = null;
      for (var j = results.length - 1; j >= 0; j--) {
        if (results[j].domain === domain && results[j].status === 'checking') {
          entry = results[j];
          break;
        }
      }
      if (entry) {
        entry.dr = result.dr;
        if (result.error) {
          entry.status = 'error';
          entry.error = result.error;
        } else {
          entry.status = 'ok';
          entry.error = '';
        }
      }

      updateStats();
      renderResults();

      /* Delay between domains (skip after last) */
      if (i < domains.length - 1 && !shouldStop) {
        await sleep(delay);
      }
    }

    /* Done */
    isRunning = false;
    btnStart.style.display = 'inline-flex';
    btnStop.style.display = 'none';
    btnClear.disabled = false;
    btnSample.disabled = false;
    domainInput.disabled = false;

    var okCount = 0, errCount = 0;
    for (var k = 0; k < results.length; k++) {
      if (results[k].status === 'ok') okCount++;
      else if (results[k].status === 'error') errCount++;
    }

    if (shouldStop) {
      showToast('Stopped early. ' + okCount + ' checked, ' + errCount + ' failed.', 'warn');
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
    showToast('Stopping after current request...', 'warn');
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
    var csv = 'Domain,DR,Status\n';
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var dr = r.status === 'ok' ? r.dr : '';
      var status = r.status === 'ok' ? 'OK' : r.error;
      csv += '"' + r.domain + '",' + dr + ',"' + status.replace(/"/g, '""') + '"\n';
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
