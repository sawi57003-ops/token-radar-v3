// Token Radar v3's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail
// view with the calibration's own factors, the live-token calibration check, and
// the method. No network: every byte it shows is in data.js.
//
// The page recomputes a row's implied value from the calibration the model fitted
// (implied = TVL x 10^(beta0 + beta1*log10(TVL) + log10(category ratio))), so the
// page's code and the board's data are visibly the same arithmetic. URL params:
// ?slug=<slug> opens a protocol's detail, ?category=<name> prefilters,
// ?tab=live|method switches tab.
(function () {
  var DATA = window.RADAR;
  var params = new URLSearchParams(location.search);
  var state = {
    tab: params.get('tab') === 'live' || params.get('tab') === 'method' ? params.get('tab') : 'board',
    q: '',
    category: params.get('category') || '',
    chain: '',
    watchlistOnly: false,
    sortKey: 'rank',
    sortDir: 1,
    selected: params.get('slug') || null,
  };
  var main = document.getElementById('board');
  main.setAttribute('aria-busy', 'false');

  function fmtUsd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e10 ? 1 : 2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return '—';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /** A row's implied value, recomputed here from the fitted calibration. */
  function impliedOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * Math.pow(10, DATA.model.beta0 + DATA.model.beta1 * Math.log10(row.tvl_usd) + Math.log10(row.category_ratio))));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'onclick' || k === 'oninput' || k === 'onchange') node[k] = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !DATA.watchlist_slugs[r.slug]) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (q && (r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1)) return false;
      return true;
    });
    var dir = state.sortDir;
    function num(a, b) { return (a - b) * dir; }
    rows.sort(function (a, b) {
      if (state.sortKey === 'rank') return num(a.rank, b.rank);
      if (state.sortKey === 'implied') return num(a.implied_value_usd, b.implied_value_usd);
      if (state.sortKey === 'tvl') return num(a.tvl_usd, b.tvl_usd);
      if (state.sortKey === 'growth') return num(a.change_7d === null ? -999 : a.change_7d, b.change_7d === null ? -999 : b.change_7d);
      if (state.sortKey === 'age') return num(a.age_days === null ? -1 : a.age_days, b.age_days === null ? -1 : b.age_days);
      if (state.sortKey === 'name') return (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) * dir;
      return num(a.rank, b.rank);
    });
    return rows;
  }

  function selectedRow() {
    if (!state.selected) return null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === state.selected) return DATA.rows[i];
    return null;
  }

  function renderDetail(row) {
    var recomputed = impliedOf(row);
    var comps = DATA.live.filter(function (l) { return l.category === row.category; })
      .sort(function (a, b) { return Math.abs(Math.log10(a.tvl_usd) - Math.log10(row.tvl_usd)) - Math.abs(Math.log10(b.tvl_usd) - Math.log10(row.tvl_usd)); })
      .slice(0, 4);
    var wl = DATA.watchlist_slugs[row.slug] ? ' · on the watchlist' : '';
    return el('section', { class: 'detail' },
      el('button', { class: 'back', onclick: function () { state.selected = null; render(); } }, '← Back to the board'),
      el('h2', {}, row.name),
      el('p', { class: 'sub' }, 'Rank #' + row.rank + ' · ' + (row.category || 'No category') + ' · ' + row.chains.join(', ') + wl),
      el('table', { class: 'factors' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Factor'), el('th', {}, 'Value'))),
        el('tbody', {},
          el('tr', {}, el('td', {}, 'TVL'), el('td', {}, fmtUsd(row.tvl_usd))),
          el('tr', {}, el('td', {}, 'Category ratio (median live mcap / TVL, shrunk)'), el('td', {}, row.category_ratio.toFixed(3) + '×')),
          el('tr', {}, el('td', {}, 'Launch multiple (implied / TVL, after the TVL slope)'), el('td', {}, row.tvl_multiple.toFixed(3) + '×')),
          el('tr', {}, el('td', {}, '7-day TVL growth (shown, not scored — see Method)'), el('td', {}, fmtPct(row.change_7d))),
          el('tr', {}, el('td', {}, 'Age with no token recorded'), el('td', {}, fmtAge(row.age_days))),
          el('tr', {}, el('td', {}, 'Implied launch value (recomputed here from the factors)'), el('td', {}, fmtUsd(recomputed))),
          el('tr', {}, el('td', {}, 'Implied launch value (the board)'), el('td', {}, fmtUsd(row.implied_value_usd))),
          recomputed === row.implied_value_usd
            ? el('tr', {}, el('td', {}, 'The two agree'), el('td', {}, 'exact'))
            : el('tr', {}, el('td', {}, 'The two agree'), el('td', {}, 'within $' + Math.abs(recomputed - row.implied_value_usd))),
        )
      ),
      el('h3', {}, 'How to farm it'),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) { return el('li', {}, s); })),
      comps.length ? el('h3', {}, 'Live tokens in the same category (the calibration set)') : null,
      comps.length ? el('div', { class: 'comps' }, comps.map(function (l) {
        return el('span', { class: 'chip' }, el('b', {}, l.name), ' · mcap ' + fmtUsd(l.mcap_usd || 0) + ' · ' + (l.mcap_usd && l.tvl_usd ? (l.mcap_usd / l.tvl_usd).toFixed(2) + '× TVL' : ''));
      })) : null,
      el('p', { class: 'note' }, '“Records no token” is what the snapshot says: DefiLlama records no market cap, CoinGecko id or symbol for this protocol. It is not proof it has none.')
    );
  }

  function renderBoard() {
    var categories = [];
    var chains = [];
    DATA.rows.forEach(function (r) {
      if (r.category && categories.indexOf(r.category) === -1) categories.push(r.category);
      r.chains.forEach(function (c) { if (chains.indexOf(c) === -1) chains.push(c); });
    });
    categories.sort();
    chains.sort();
    function sortBtn(key, label) {
      var arrow = state.sortKey === key ? (state.sortDir === 1 ? ' ▲' : ' ▼') : '';
      return el('button', { onclick: function () {
        if (state.sortKey === key) state.sortDir = -state.sortDir;
        else { state.sortKey = key; state.sortDir = key === 'rank' ? 1 : -1; }
        render();
      } }, label + arrow);
    }
    var rows = filteredRows();
    var table = el('table', { class: 'board' },
      el('thead', {}, el('tr', {},
        el('th', { class: 'num' }, sortBtn('rank', '#')),
        el('th', {}, sortBtn('name', 'Protocol')),
        el('th', {}, 'Category'),
        el('th', { class: 'num' }, sortBtn('tvl', 'TVL')),
        el('th', { class: 'num' }, sortBtn('growth', '7d')),
        el('th', { class: 'num' }, sortBtn('age', 'Age')),
        el('th', { class: 'num' }, sortBtn('implied', 'Implied value'))
      )),
      el('tbody', {}, rows.map(function (r) {
        var wl = DATA.watchlist_slugs[r.slug] ? ' ★' : '';
        return el('tr', {
          class: state.selected === r.slug ? 'sel' : null,
          onclick: function () { state.selected = state.selected === r.slug ? null : r.slug; render(); },
        },
          el('td', { class: 'rank num' }, String(r.rank)),
          el('td', {}, el('b', {}, r.name + wl), el('span', { class: 'slug' }, r.slug)),
          el('td', { class: 'cat' }, r.category || '—'),
          el('td', { class: 'num' }, fmtUsd(r.tvl_usd)),
          el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down') }, fmtPct(r.change_7d)),
          el('td', { class: 'num' }, fmtAge(r.age_days)),
          el('td', { class: 'num' }, el('span', { class: 'imp' }, fmtUsd(r.implied_value_usd)), el('span', { class: 'per' }, r.tvl_multiple.toFixed(2) + '× TVL'))
        );
      }))
    );
    return el('div', {},
      el('div', { class: 'controls' },
        el('input', { type: 'search', placeholder: 'Search a protocol…', value: state.q, oninput: function (e) { state.q = e.target.value; render(); } }),
        el('select', { 'aria-label': 'Category', onchange: function (e) { state.category = e.target.value; render(); } },
          el('option', { value: '' }, 'All categories'),
          categories.map(function (c) { return el('option', { value: c, selected: state.category === c ? 'selected' : null }, c); })),
        el('select', { 'aria-label': 'Chain', onchange: function (e) { state.chain = e.target.value; render(); } },
          el('option', { value: '' }, 'All chains'),
          chains.map(function (c) { return el('option', { value: c, selected: state.chain === c ? 'selected' : null }, c); })),
        el('label', {}, el('input', { type: 'checkbox', checked: state.watchlistOnly ? 'checked' : null, onchange: function (e) { state.watchlistOnly = e.target.checked; render(); } }), ' Watchlist only')
      ),
      el('p', { class: 'count' }, el('b', {}, String(rows.length)), ' of ' + DATA.rows.length + ' protocols · ★ = on the snapshot’s watchlist · click a row for its detail and farm plan'),
      rows.length ? table : el('p', { class: 'empty' }, 'No protocol matches that filter.')
    );
  }

  function renderLive() {
    var rows = DATA.live.slice().sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); });
    return el('div', {},
      el('p', { class: 'note' }, 'The calibration set: the ' + DATA.live.length + ' largest live-token protocols by market cap. The model learns the launch multiple from these — the median market cap per dollar of TVL in each category — and never from a hand-written list. A token that already trades is shown at the market’s own value, never as an implied one.'),
      el('table', { class: 'board' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Protocol'), el('th', {}, 'Category'),
          el('th', { class: 'num' }, 'TVL'), el('th', { class: 'num' }, 'Market cap'),
          el('th', { class: 'num' }, 'mcap / TVL'), el('th', { class: 'num' }, '7d'))),
        el('tbody', {}, rows.map(function (l) {
          return el('tr', { onclick: function () {} },
            el('td', {}, el('b', {}, l.name)),
            el('td', { class: 'cat' }, l.category || '—'),
            el('td', { class: 'num' }, fmtUsd(l.tvl_usd)),
            el('td', { class: 'num' }, fmtUsd(l.mcap_usd || 0)),
            el('td', { class: 'num' }, l.mcap_usd && l.tvl_usd ? (l.mcap_usd / l.tvl_usd).toFixed(2) + '×' : '—'),
            el('td', { class: 'num ' + (l.change_7d === null ? '' : l.change_7d >= 0 ? 'up' : 'down') }, fmtPct(l.change_7d))
          );
        }))
      )
    );
  }

  function cvRow(label, cv, hl) {
    return el('tr', {},
      el('td', {}, label),
      el('td', { class: hl === 'spearman' ? 'hl' : null }, cv.spearman.toFixed(3)),
      el('td', { class: hl === 'rmse' ? 'hl' : null }, cv.rmse_log10.toFixed(3)),
      el('td', {}, (cv.within_2x * 100).toFixed(0) + '%'),
      el('td', {}, cv.top10.toFixed(1) + ' / 10'),
      el('td', {}, cv.top20.toFixed(1) + ' / 20'));
  }

  function renderMethod() {
    var m = DATA.model;
    var cv = DATA.cv;
    var v2 = DATA.v2_cv;
    var catRows = Object.keys(m.category_ratio).sort(function (a, b) { return m.category_ratio[b] - m.category_ratio[a]; })
      .map(function (c) {
        return el('tr', {}, el('td', {}, c), el('td', {}, String(m.category_n[c] || 0)), el('td', {}, m.category_ratio[c].toFixed(3) + '×'));
      });
    return el('div', { class: 'method' },
      el('h2', {}, 'Method — radar-4-rank'),
      el('p', {}, 'The board ranks every pre-token protocol that passes the product rule by what its launch would be worth if its record stayed as it is. The value is fitted from the snapshot’s own live-token protocols, at run time, by this program — no name is ever special-cased and no multiple is hand-written.'),
      el('h3', {}, 'The value'),
      el('p', {}, 'For a protocol with TVL T in category C: ', el('code', {}, 'implied = T × 10^(b0 + b1·log10(T) + log-ratio(C))'), '. The category log-ratio is the median log10(market cap / TVL) of that category’s live tokens, shrunk toward the market-wide median with a prior weight of ', el('code', {}, String(m.prior_weight)), '. The line in log10(TVL) is a ridge fit on the residual; its slope is ', el('code', {}, m.beta1.toFixed(3)), ', so the launch multiple falls as TVL grows — the biggest protocols are worth fewer dollars per dollar of TVL than the small ones. The market-wide multiple is ', el('code', {}, m.global_ratio.toFixed(3) + '×'), ' TVL.'),
      el('h3', {}, 'Why this beats the v2 OLS model'),
      el('p', {}, 'The v2 model ran an OLS regression of log10(market cap) on TVL, growth, chain count and age. It fitted the magnitude well but its growth and chain terms were noise for ranking: on leave-one-out cross-validation of the 118 live tokens it ranked them at Spearman ', el('code', {}, v2.spearman.toFixed(3)), ', worse than the plain category median (', el('code', {}, '0.387'), '). v3 drops the OLS, keeps the category median as the rank backbone, shrinks the thin categories harder, and adds only the TVL slope — the one secondary signal the data supports. The table below is computed by the program at run time, leave-one-out, for both models.'),
      el('table', { class: 'cv' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Model (leave-one-out)'), el('th', {}, 'Spearman ↑'), el('th', {}, 'log10 RMSE ↓'), el('th', {}, 'Within 2×'), el('th', {}, 'Top 10'), el('th', {}, 'Top 20'))),
        el('tbody', {},
          cvRow('v3 radar-4-rank', cv, 'spearman'),
          cvRow('v2 OLS (refit here)', v2, null))
      ),
      el('h3', {}, 'The thin-category problem, and the fix'),
      el('p', {}, 'Two categories rest on a single live token each: Risk Curators on Api3 (market cap / TVL 2.975) and Chain on Astar dApps Staking (3.026). With the usual prior weight of 3, that one small token would set the multiple for all 38 pre-token Risk Curators — including the three largest protocols on the board. A weight of 6 pulls those categories most of the way back to the market-wide multiple, so a thin category borrows strength from the market instead of inventing one. Categories with no live token at all fall back to the market-wide multiple.'),
      el('h3', {}, 'What was tested and left out'),
      el('p', {}, 'Seven-day TVL growth: its correlation with the launch multiple, after the category is removed, is −0.02 — no signal. The board still shows each protocol’s growth, but the value does not chase weekly noise. Chain count: correlation −0.09, and it does not survive cross-validation. Age with no token: a long un-tokenised run adds a small premium in-sample, but it does not improve the ranking out of sample, so it stays out of the value and in the detail view as context.'),
      el('h3', {}, 'Who is on the board'),
      el('p', {}, 'The board holds ', el('b', {}, String(DATA.board_size)), ' protocols: all ', el('b', {}, String(DATA.watchlist_size)), ' on the snapshot’s watchlist, plus every other pre-token protocol that passes the product rule — not a wrapped, staked or bridged product, not a versioned pool, not an exchange’s own product — whatever its TVL. The watchlist is the floor, never the ceiling: a protocol the list leaves out, like the largest one on this board, is ranked too. The snapshot carries no parent-protocol field, so a product the house left off the watchlist for that reason is ranked on its own record here. “Records no token” is what the snapshot says; it is not proof a protocol has none.'),
      el('h3', {}, 'Category multiples (live-token calibration)'),
      el('table', { class: 'cv' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Category'), el('th', {}, 'Live n'), el('th', {}, 'Multiple'))),
        el('tbody', {}, catRows)
      ),
      el('h3', {}, 'Farm plans'),
      el('p', {}, 'Every row carries six steps generated from its own record — its category, its chains, its TVL and its age — each with what it costs and how long it takes. The steps never name a token that does not exist yet and never ask for a payment to claim: a claim is only ever from the protocol’s own page.'),
      el('p', { class: 'note' }, 'Calibration: ' + m.n_live + ' live-token protocols, ' + m.n_train + ' kept after trimming ratio quirks (market cap / TVL outside 0.005–5). Snapshot as of ' + DATA.as_of + '. Source: ' + esc(DATA.source) + '.')
    );
  }

  function render() {
    main.innerHTML = '';
    var top = DATA.rows[0];
    var hero = el('div', { class: 'wrap' },
      el('header', { class: 'hero' },
        el('h1', {}, 'Token Radar ', el('span', { class: 'v3' }, 'v3 · radar-4-rank')),
        el('p', { class: 'lede' }, 'Which pre-token protocol is worth farming next, and what is its launch worth? The board ranks ', el('b', {}, String(DATA.board_size)), ' protocols by an implied value calibrated from the ', el('b', {}, String(DATA.model.n_live)), ' tokens that already trade — a rank-first model that beats the v2 OLS on the live set (Spearman ', el('b', {}, DATA.cv.spearman.toFixed(3)), ' vs ', el('b', {}, DATA.v2_cv.spearman.toFixed(3)), ').')
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Protocols ranked'), el('div', { class: 'v' }, String(DATA.board_size)), el('div', { class: 'd' }, DATA.watchlist_size + ' on the watchlist')),
        el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Top implied value'), el('div', { class: 'v' }, fmtUsd(top.implied_value_usd)), el('div', { class: 'd' }, top.name)),
        el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Market multiple'), el('div', { class: 'v' }, DATA.model.global_ratio.toFixed(2) + '×', el('small', {}, ' TVL')), el('div', { class: 'd' }, 'median live mcap / TVL')),
        el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Rank (leave-one-out)'), el('div', { class: 'v' }, DATA.cv.spearman.toFixed(3)), el('div', { class: 'd' }, 'Spearman vs live mcap'))
      ),
      el('div', { class: 'tabs' },
        el('button', { 'aria-selected': state.tab === 'board' ? 'true' : 'false', onclick: function () { state.tab = 'board'; render(); } }, 'Board'),
        el('button', { 'aria-selected': state.tab === 'live' ? 'true' : 'false', onclick: function () { state.tab = 'live'; render(); } }, 'Live tokens'),
        el('button', { 'aria-selected': state.tab === 'method' ? 'true' : 'false', onclick: function () { state.tab = 'method'; render(); } }, 'Method')
      )
    );
    main.appendChild(hero);
    var body = el('div', { class: 'wrap' });
    var sel = selectedRow();
    if (sel) body.appendChild(renderDetail(sel));
    if (state.tab === 'board') body.appendChild(renderBoard());
    else if (state.tab === 'live') body.appendChild(renderLive());
    else body.appendChild(renderMethod());
    body.appendChild(el('footer', { class: 'foot' }, 'Snapshot as of ' + DATA.as_of + ' · floor $' + DATA.floor_usd.toLocaleString('en-US') + ' · implied values are this entry’s own claim, never the snapshot’s.'));
    main.appendChild(body);
  }

  render();
})();
