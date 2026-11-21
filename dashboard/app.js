// Token Launch Radar's page. It reads window.RADAR — written beside dashboard/ by main.ts — and
// renders the ranked board, a filterable and sortable table, a per-protocol detail drawer with the
// model's own decomposition and farm plan, the separated live-token view, and the methodology.
// No network, no framework: every byte it shows is in data.js, and every state is reachable from the
// URL hash so each screenshot is reproducible.
(function () {
  'use strict';

  var R = window.RADAR;
  if (!R) return;

  var state = { tab: 'board', q: '', category: '', chain: '', status: '', sort: 'implied', dir: -1, p: null };

  // ------------------------------------------------------------------ formatting

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + trimNum(n / 1e9) + 'B';
    if (abs >= 1e6) return '$' + trimNum(n / 1e6) + 'M';
    if (abs >= 1e4) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function trimNum(x) { return (Math.round(x * 100) / 100).toString(); }
  function fmtPct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + (Math.round(n * 100) / 100).toFixed(2) + '%';
  }
  function fmtPctClass(n) { return n === null || n === undefined ? 'g-flat' : n > 0 ? 'g-up' : n < 0 ? 'g-down' : 'g-flat'; }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return trimNum(Math.round(days / 36.5) / 10) + 'y';
    return Math.round(days) + 'd';
  }
  function fmtMult(n) { return (n === null || n === undefined ? '—' : '×' + (Math.round(n * 1000) / 1000)); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        child.forEach(function (c) {
          if (c === null || c === undefined) return;
          node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
        });
      } else if (child.nodeType) node.appendChild(child);
      else node.appendChild(document.createTextNode(String(child)));
    }
    return node;
  }
  function chip(text, more) { return el('span', { class: more ? 'chip more' : 'chip', text: text }); }
  function chips(list, max) {
    var wrap = el('div', { class: 'chips' });
    var shown = (list || []).slice(0, max || 2);
    shown.forEach(function (c) { wrap.appendChild(chip(c)); });
    if ((list || []).length > shown.length) wrap.appendChild(chip('+' + (list.length - shown.length), true));
    if (shown.length === 0) wrap.appendChild(chip('—'));
    return wrap;
  }

  // ------------------------------------------------------------------ state via the URL hash

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    state.tab = ['board', 'live', 'method'].indexOf(params.get('tab')) >= 0 ? params.get('tab') : 'board';
    state.q = params.get('q') || '';
    state.category = params.get('category') || '';
    state.chain = params.get('chain') || '';
    state.status = params.get('status') || '';
    state.sort = ['rank', 'name', 'tvl', 'change', 'age', 'implied'].indexOf(params.get('sort')) >= 0 ? params.get('sort') : 'implied';
    var dir = parseInt(params.get('dir') || '', 10);
    state.dir = dir === 1 ? 1 : -1;
    state.p = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.q) params.set('q', state.q);
    if (state.category) params.set('category', state.category);
    if (state.chain) params.set('chain', state.chain);
    if (state.status) params.set('status', state.status);
    if (!(state.sort === 'implied' && state.dir === -1)) { params.set('sort', state.sort); params.set('dir', String(state.dir)); }
    if (state.p) params.set('p', state.p);
    var next = '#' + params.toString();
    if (next !== window.location.hash) history.replaceState(null, '', next === '#' ? window.location.pathname : next);
  }

  // ------------------------------------------------------------------ filters and sorting

  function matchStatus(row) {
    if (state.status === 'watchlist') return row.tvl_usd >= R.floor_usd;
    if (state.status === 'early') return row.tvl_usd < R.floor_usd;
    if (state.status === 'momentum') return row.change_7d !== null && row.change_7d >= 10;
    if (state.status === 'fresh') return row.age_days !== null && row.age_days <= 180;
    return true;
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return R.rows.filter(function (row) {
      if (q && row.name.toLowerCase().indexOf(q) < 0 && row.slug.toLowerCase().indexOf(q) < 0) return false;
      if (state.category && (row.category || 'Uncategorized') !== state.category) return false;
      if (state.chain && row.chains.indexOf(state.chain) < 0) return false;
      return matchStatus(row);
    });
  }
  function sorted(rows) {
    var key = state.sort, dir = state.dir;
    var copy = rows.slice();
    copy.sort(function (a, b) {
      var va, vb;
      if (key === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); return va < vb ? -dir : va > vb ? dir : a.rank - b.rank; }
      if (key === 'rank') { return dir === -1 ? a.rank - b.rank : b.rank - a.rank; }
      if (key === 'change') { va = a.change_7d === null ? -Infinity : a.change_7d; vb = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else { va = a.implied_value_usd; vb = b.implied_value_usd; }
      return va === vb ? a.rank - b.rank : (va < vb ? -dir : dir);
    });
    return copy;
  }

  // ------------------------------------------------------------------ the board

  function renderStats() {
    var stats = document.getElementById('stats');
    stats.textContent = '';
    function stat(value, label, hot) {
      var b = el('b', { text: value });
      var s = el('div', { class: 'stat' + (hot ? ' hot' : '') }, b, el('span', { text: label }));
      stats.appendChild(s);
    }
    var watchCovered = R.rows.filter(function (r) { return r.tvl_usd >= R.floor_usd; }).length;
    stat(watchCovered + '/' + R.watchlist_size, 'watchlist covered', true);
    stat(String(R.board_size), 'protocols tracked');
    stat(R.early_size + '/' + R.early_size, 'early · full coverage');
    stat(String(R.set_aside_parent_products), 'wrapped set aside');
    stat(String(R.live_size), 'live tokens apart');
    stat(R.as_of, 'snapshot date');
  }

  function renderBoard() {
    var tbody = document.getElementById('rows');
    var empty = document.getElementById('empty');
    tbody.textContent = '';
    var rows = sorted(filtered());
    var topValue = R.rows[0] && R.rows[0].implied_value_usd ? R.rows[0].implied_value_usd : 1;
    document.getElementById('count').textContent = '';
    document.getElementById('count').appendChild(el('b', { text: String(rows.length) }));
    document.getElementById('count').appendChild(document.createTextNode(' of ' + R.board_size + ' shown'));
    empty.hidden = rows.length !== 0;
    rows.forEach(function (row) {
      var watch = row.tvl_usd >= R.floor_usd;
      var tr = el('tr', {
        tabindex: '0',
        'aria-label': row.name + ', rank ' + row.rank + ', implied value ' + fmtUsd(row.implied_value_usd),
        onclick: function () { openDrawer(row.slug, tr); },
        onkeydown: function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDrawer(row.slug, tr); } },
      });
      var rankCell = el('td', { class: 'c-rank' }, el('span', { class: 'rank-num' + (row.rank <= 3 ? ' rank-top' : ''), text: padRank(row.rank) }));
      var nameCell = el('td', { class: 'c-name' },
        el('div', { class: 'p-name' }, document.createTextNode(row.name)),
        el('div', { class: 'p-slug' }, document.createTextNode(row.slug + (row.category ? '' : '')))
      );
      var cat = row.category ? el('span', { class: 'p-cat', text: row.category }) : null;
      if (cat) nameCell.firstChild.appendChild(cat);
      if (watch) nameCell.firstChild.appendChild(el('span', { class: 'watch-flag', text: 'watchlist' }));
      tr.appendChild(rankCell);
      tr.appendChild(nameCell);
      tr.appendChild(el('td', {}, chips(row.chains, 2)));
      tr.appendChild(el('td', { class: 'c-num' }, document.createTextNode(fmtUsd(row.tvl_usd))));
      tr.appendChild(el('td', { class: 'c-num ' + fmtPctClass(row.change_7d) }, document.createTextNode(fmtPct(row.change_7d))));
      tr.appendChild(el('td', { class: 'c-num' }, document.createTextNode(fmtAge(row.age_days))));
      var valueCell = el('td', { class: 'c-num c-value' }, el('span', { class: 'value-big', text: fmtUsd(row.implied_value_usd) }));
      var valueBar = el('div', { class: 'value-bar' }, el('i', { style: 'width:' + Math.max(2, Math.round(row.implied_value_usd / topValue * 100)) + '%' }));
      valueCell.appendChild(valueBar);
      tr.appendChild(valueCell);
      tr.appendChild(el('td', { class: 'c-conf' }, el('span', { class: 'badge ' + row.confidence, text: row.confidence })));
      tbody.appendChild(tr);
    });
  }
  function padRank(n) { return n < 100 ? (n < 10 ? '0' + n : String(n)) : String(n); }

  function renderSortArrows() {
    document.querySelectorAll('#view-board thead button[data-sort]').forEach(function (btn) {
      var th = btn.closest('th');
      var key = btn.getAttribute('data-sort');
      var active = state.sort === key;
      var arrow = btn.querySelector('.sort-arrow');
      arrow.textContent = active ? (state.dir === -1 ? '▼' : '▲') : '';
      if (active) th.setAttribute('aria-sort', state.dir === -1 ? 'descending' : 'ascending');
      else th.removeAttribute('aria-sort');
    });
  }

  // ------------------------------------------------------------------ drawer

  var lastFocus = null;
  function parseStep(s) {
    var atCost = s.indexOf(' Cost: ');
    if (atCost < 0) return { text: s, cost: null, time: null };
    var text = s.slice(0, atCost);
    var rest = s.slice(atCost + 7);
    var atTime = rest.indexOf('. Time: ');
    if (atTime < 0) return { text: text, cost: rest, time: null };
    return { text: text, cost: rest.slice(0, atTime), time: rest.slice(atTime + 8).replace(/\.$/, '') };
  }
  function openDrawer(slug, focusBack) {
    var row = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) { row = R.rows[i]; break; }
    if (!row) return;
    lastFocus = focusBack || document.activeElement;
    state.p = slug;
    writeHash();
    var drawer = document.getElementById('drawer');
    drawer.textContent = '';
    drawer.appendChild(el('button', { type: 'button', class: 'drawer-close', 'aria-label': 'Close detail view', onclick: closeDrawer, text: '✕' }));
    drawer.appendChild(el('p', { class: 'd-kicker', text: 'Rank ' + padRank(row.rank) + ' · ' + row.confidence + ' signal' }));
    drawer.appendChild(el('h2', { id: 'd-name', text: row.name }));
    drawer.appendChild(el('p', { class: 'd-slug', text: row.slug }));
    var chipsRow = el('div', { class: 'd-chips' });
    if (row.category) chipsRow.appendChild(chip(row.category));
    (row.chains || []).slice(0, 4).forEach(function (c) { chipsRow.appendChild(chip(c)); });
    if ((row.chains || []).length > 4) chipsRow.appendChild(chip('+' + (row.chains.length - 4), true));
    drawer.appendChild(chipsRow);

    var statusBox = el('div', { class: 'd-status' },
      el('p', {}, el('b', { text: 'Records no token' }), document.createTextNode(
        ' on DefiLlama as of ' + R.as_of + ' — both its market cap and its ticker are unrecorded. ' +
        'The record is not proof: a token may exist that DefiLlama does not carry.'
      )));
    drawer.appendChild(statusBox);

    var grid = el('div', { class: 'metric-grid' });
    function metric(value, label, hot) { return el('div', { class: 'metric' + (hot ? ' hot' : '') }, el('b', { text: value }), el('span', { text: label })); }
    grid.appendChild(metric(fmtUsd(row.implied_value_usd), 'implied launch value', true));
    grid.appendChild(metric(fmtUsd(row.tvl_usd), 'TVL'));
    grid.appendChild(metric(fmtPct(row.change_7d), 'TVL change, 7d'));
    grid.appendChild(metric(fmtAge(row.age_days), 'run with no token'));
    drawer.appendChild(grid);

    drawer.appendChild(el('p', { class: 'd-section-title', text: 'How the model reaches the value' }));
    var m = row.model;
    var decomp = el('div', { class: 'decomp' });
    function dRow(label, sub, value, frac, dim) {
      var bar = el('div', { class: 'decomp-bar' }, el('i', { class: dim ? 'dim' : '', style: 'width:' + Math.round(Math.min(1, frac) * 100) + '%' }));
      return el('div', { class: 'decomp-row' },
        el('div', { class: 'decomp-label' }, document.createTextNode(label), el('small', { text: sub })),
        bar,
        el('div', { class: 'decomp-val', text: value }));
    }
    decomp.appendChild(dRow('Category anchor', m.anchor_source === 'category' ? 'median of ' + m.anchor_samples + ' live peers' : 'snapshot-wide median', fmtMult(m.anchor_multiple), m.anchor_multiple / 6, m.anchor_source !== 'category'));
    decomp.appendChild(dRow('Momentum', (row.change_7d === null ? 'growth unreported' : '7d change ' + fmtPct(row.change_7d)), fmtMult(m.momentum_multiplier), m.momentum_multiplier / 1.5, false));
    decomp.appendChild(dRow('Readiness', m.readiness_band, fmtMult(m.readiness_multiplier), m.readiness_multiplier / 1.2, false));
    var final = el('div', { class: 'decomp-final' }, el('span', { text: 'TVL × anchor × momentum × readiness' }), el('b', { text: fmtUsd(row.implied_value_usd) }));
    decomp.appendChild(final);
    drawer.appendChild(decomp);

    drawer.appendChild(el('p', { class: 'd-section-title', text: 'How to farm it' }));
    var list = el('ol', { class: 'farm-list' });
    (row.farm_steps || []).forEach(function (s) {
      var step = parseStep(s);
      var meta = el('div', { class: 'farm-meta' });
      if (step.cost) meta.appendChild(el('span', { class: 'chip cost', text: step.cost }));
      if (step.time) meta.appendChild(el('span', { class: 'chip', text: step.time }));
      list.appendChild(el('li', {}, el('p', { class: 'farm-text', text: step.text }), meta));
    });
    drawer.appendChild(list);

    drawer.appendChild(el('p', { class: 'd-caveat', text: 'Costs are rough gas estimates for the named chain tier, capital is a suggested position size relative to the protocol\'s scale — both assumptions, stated in Methodology. Nothing here is financial advice.' }));

    document.getElementById('backdrop').hidden = false;
    drawer.hidden = false;
    document.body.style.overflow = 'hidden';
    drawer.querySelector('.drawer-close').focus();
  }
  function closeDrawer() {
    state.p = null;
    writeHash();
    document.getElementById('drawer').hidden = true;
    document.getElementById('backdrop').hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.isConnected) lastFocus.focus();
  }

  // ------------------------------------------------------------------ live view

  function renderLive() {
    var tbody = document.getElementById('live-rows');
    tbody.textContent = '';
    R.live.forEach(function (row, i) {
      var tr = el('tr');
      tr.appendChild(el('td', { class: 'c-rank' }, el('span', { class: 'rank-num', text: padRank(i + 1) })));
      var nameCell = el('td', { class: 'c-name' }, el('div', { class: 'p-name', text: row.name }), el('div', { class: 'p-slug', text: row.slug }));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', {}, document.createTextNode(row.category || '—')));
      tr.appendChild(el('td', { class: 'c-num' }, document.createTextNode(fmtUsd(row.tvl_usd))));
      tr.appendChild(el('td', { class: 'c-num' }, document.createTextNode(fmtUsd(row.mcap_usd))));
      tr.appendChild(el('td', { class: 'c-num multiple-num' }, document.createTextNode(fmtMult(row.multiple))));
      tr.appendChild(el('td', { class: 'c-num ' + fmtPctClass(row.change_7d) }, document.createTextNode(fmtPct(row.change_7d))));
      tbody.appendChild(tr);
    });
  }

  // ------------------------------------------------------------------ methodology

  function renderMethod() {
    var host = document.getElementById('method');
    host.textContent = '';
    var M = R.model;

    var formula = el('div', { class: 'card' },
      el('p', { class: 'card-kicker', text: 'the value model · v' + R.model_version }),
      el('h2', { text: 'One formula, three snapshot signals' }));
    formula.appendChild(el('code', { class: 'formula', text: 'implied = TVL × anchor × momentum × readiness\nanchor    = median(MCAP/TVL) of live peers in the category\nmomentum  = 1 + clamp(7d, ' + M.growth_floor + '%…' + M.growth_cap + '%) × ' + M.momentum_weight + '\nreadiness = hump over days run with no token' }));
    formula.appendChild(el('p', { text: 'The board is not a TVL table: every one of the three signals the rules name — TVL, the seven-day change and how long a protocol has run with no token — moves the ranking, and the anchor is the market\'s own median multiple, computed from the live protocols in this same snapshot. No protocol name is special-cased anywhere in the code; the same function scores every row.' }));
    host.appendChild(formula);

    var anchorsCard = el('div', { class: 'card' },
      el('p', { class: 'card-kicker', text: 'signal 1 · anchor' }),
      el('h2', { text: 'What the market pays comparable protocols' }));
    anchorsCard.appendChild(el('p', { text: 'For each category the model takes the median market-cap-to-TVL multiple of this snapshot\'s own live-token protocols (at least ' + M.anchor_min_samples + ' samples), clamped to ' + M.anchor_min + '–' + M.anchor_max + '. A protocol with no category or too few peers gets the snapshot-wide median: ×' + R.anchor_global + '.' }));
    var table = el('table', { class: 'anchor-table' });
    table.appendChild(el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live peers' }), el('th', { scope: 'col', text: 'Median MCAP/TVL' }))));
    var tb = el('tbody');
    R.anchors.slice(0, 10).forEach(function (a) {
      tb.appendChild(el('tr', {}, el('td', { text: a.category }), el('td', { text: String(a.samples) }), el('td', { text: '×' + a.multiple })));
    });
    table.appendChild(tb);
    anchorsCard.appendChild(table);
    if (R.anchors.length > 10) anchorsCard.appendChild(el('p', { text: '…and ' + (R.anchors.length - 10) + ' more categories.' }));
    host.appendChild(anchorsCard);

    var mom = el('div', { class: 'card' },
      el('p', { class: 'card-kicker', text: 'signal 2 · momentum' }),
      el('h2', { text: 'Seven days of TVL growth' }));
    mom.appendChild(el('p', { text: 'A protocol whose TVL is compounding now is one whose future token would launch into demand. The model clamps the reported seven-day change to ' + M.growth_floor + '%…' + M.growth_cap + '% and weighs it at ' + M.momentum_weight + ' per point of growth — enough to reorder the board, never enough to let one week of hot money rewrite it. Growth DefiLlama does not report counts as flat, and the row is marked as such.' }));
    host.appendChild(mom);

    var ready = el('div', { class: 'card' },
      el('p', { class: 'card-kicker', text: 'signal 3 · readiness' }),
      el('h2', { text: 'The age of a launch that has not happened' }));
    ready.appendChild(el('p', { text: 'Too new and there is little accrued usage for a token to reward; years old with no launch and the thesis goes stale. The model peaks in the prime window and eases toward both ends:' }));
    var list = el('ul', { class: 'readiness-list' });
    R.readiness_notes.forEach(function (note) { list.appendChild(el('li', { text: note })); });
    ready.appendChild(list);
    host.appendChild(ready);

    var limits = el('div', { class: 'card' },
      el('p', { class: 'card-kicker', text: 'honest limits' }),
      el('h2', { text: 'What this board is not' }));
    var ul = el('ul', { class: 'readiness-list' });
    [
      'one sealed snapshot: no yield rates, team history, funding or points data — only what DefiLlama recorded',
      'coverage is complete: the board ranks all ' + R.board_size + ' rankable pre-token protocols — the whole ' + R.watchlist_size + '-protocol watchlist plus every one below the $' + Math.round(R.floor_usd / 1e6) + 'M floor; the ' + R.set_aside_parent_products + ' above-floor records DefiLlama ties to a parent product sit out with the wrapped tokens',
      'a protocol that records no token may still have one DefiLlama does not carry',
      'an implied value is a launch scenario under the stated model, never a price prediction',
      'gas and capital figures in farm plans are tier estimates, not quotes',
      'the program is deterministic: no clock, no randomness, identical bytes on every run',
    ].forEach(function (t) { ul.appendChild(el('li', { text: t })); });
    limits.appendChild(ul);
    host.appendChild(limits);
  }

  // ------------------------------------------------------------------ tabs, filter options, wiring

  function setTab(tab) {
    state.tab = tab;
    ['board', 'live', 'method'].forEach(function (t) {
      document.getElementById('view-' + t).hidden = t !== tab;
      document.getElementById('tab-' + t).setAttribute('aria-pressed', String(t === tab));
    });
  }

  function buildOptions() {
    var categories = new Set(), chains = new Set();
    R.rows.forEach(function (row) {
      categories.add(row.category || 'Uncategorized');
      (row.chains || []).forEach(function (c) { chains.add(c); });
    });
    var catSel = document.getElementById('f-category');
    Array.from(categories).sort().forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c })); });
    var chainSel = document.getElementById('f-chain');
    Array.from(chains).sort().forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c })); });
  }

  function controlsFromState() {
    document.getElementById('f-q').value = state.q;
    document.getElementById('f-category').value = state.category;
    document.getElementById('f-chain').value = state.chain;
    document.getElementById('f-status').value = state.status;
  }
  function stateFromControls() {
    state.q = document.getElementById('f-q').value;
    state.category = document.getElementById('f-category').value;
    state.chain = document.getElementById('f-chain').value;
    state.status = document.getElementById('f-status').value;
  }

  function refresh() {
    renderStats();
    renderBoard();
    renderSortArrows();
  }

  readHash();
  buildOptions();
  controlsFromState();
  setTab(state.tab);
  renderLive();
  renderMethod();
  document.getElementById('foot-source').textContent = R.source;
  document.getElementById('foot-version').textContent = 'v' + R.model_version;
  document.getElementById('foot-date').textContent = R.as_of;
  refresh();
  if (state.p) openDrawer(state.p);

  document.querySelectorAll('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () { setTab(btn.getAttribute('data-tab')); writeHash(); });
  });
  ['f-q', 'f-category', 'f-chain', 'f-status'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', function () { stateFromControls(); state.p = null; refresh(); writeHash(); });
  });
  function clearAll() {
    state.q = ''; state.category = ''; state.chain = ''; state.status = '';
    controlsFromState(); refresh(); writeHash();
  }
  document.getElementById('f-clear').addEventListener('click', clearAll);
  document.getElementById('empty-clear').addEventListener('click', clearAll);
  document.querySelectorAll('#view-board thead button[data-sort]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
      refresh(); writeHash();
    });
  });
  document.getElementById('backdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && state.p) closeDrawer(); });
  window.addEventListener('hashchange', function () { readHash(); controlsFromState(); setTab(state.tab); refresh(); if (state.p) openDrawer(state.p); else closeDrawer(); });
})();
