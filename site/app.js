/* =====================================================================
   POOL HALL TOURNAMENTS — website
   ===================================================================== */
(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var DEMO_FLAG = 'pht-demo-on';
  var DEMO_ONLY = !CFG.API_URL;                                    // no backend at all: demo is the only mode
  var DEMO = DEMO_ONLY || localStorage.getItem(DEMO_FLAG) === '1'; // signed in as demo on the real site
  var local = DEMO ? LocalBackend.browser() : null;
  var E = Engine;
  var app = document.getElementById('app');
  var timers = [];
  var SKEY = DEMO ? 'pht-demo-session' : 'pht-session';            // real sign-in is kept separate from the demo

  document.getElementById('hallName').textContent = CFG.HALL_NAME || 'Pool Hall';
  document.getElementById('appName').textContent = CFG.APP_NAME || 'Tournament Desk';
  document.title = (CFG.HALL_NAME || 'Pool Hall') + ' · ' + (CFG.APP_NAME || 'Tournaments');
  if (DEMO) {
    var bar = document.getElementById('demoBar');
    bar.hidden = false;
    bar.innerHTML = '<b>DEMO</b> — practice data saved on this device only. Nothing here touches real tournaments. ' +
      '<button id="demoReset" class="link">Reset demo</button>' + (DEMO_ONLY ? '' : ' · <button id="demoExit" class="link">Exit demo</button>');
    document.getElementById('demoReset').onclick = function () { if (confirm('Erase all demo data and start fresh?')) { local.reset(); localStorage.removeItem(SKEY); location.hash = '#/admin'; location.reload(); } };
    var ex = document.getElementById('demoExit');
    if (ex) ex.onclick = function () { localStorage.removeItem(DEMO_FLAG); localStorage.removeItem(SKEY); location.hash = '#/'; location.reload(); };
  }
  function enterDemo() {
    localStorage.setItem(DEMO_FLAG, '1');
    var lb = LocalBackend.browser();
    lb.call('login', { username: 'demo', password: 'demo123' }, '').then(function (r) {
      localStorage.setItem('pht-demo-session', r.session); location.hash = '#/admin'; location.reload();
    }, function () { location.hash = '#/admin'; location.reload(); });
  }

  /* ---------------- helpers ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function session() { return localStorage.getItem(SKEY) || ''; }
  function money(n) { n = Number(n) || 0; return '$' + n.toFixed(n % 1 ? 2 : 0); }
  function fmtDate(d) {
    if (!d) return '';
    var dt = new Date(d + (String(d).length === 10 ? 'T12:00:00' : ''));
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  }
  function fmtTime(t) {
    if (!t) return '';
    var p = String(t).split(':'), h = Number(p[0]), mm = p[1] || '00';
    return (h % 12 || 12) + ':' + mm + (h < 12 ? ' AM' : ' PM');
  }
  function ago(iso) { if (!iso) return ''; var s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; return Math.floor(s / 3600) + ' h ago'; }
  function toast(msg, isErr) {
    var t = document.getElementById('toast'); t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : ''); t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, isErr ? 6000 : 2800);
  }
  function modal(html, bind) {
    var m = document.getElementById('modal'), c = document.getElementById('modalCard');
    c.innerHTML = html; m.hidden = false;
    m.onclick = function (e) { if (e.target === m) closeModal(); };
    $$('[data-close]', c).forEach(function (b) { b.onclick = closeModal; });
    if (bind) bind(c);
  }
  function closeModal() { document.getElementById('modal').hidden = true; }
  function poll(fn, sec) { timers.push(setInterval(function () { if (!document.hidden) fn(); }, (sec || CFG.POLL_SECONDS || 15) * 1000)); }
  function clearTimers() { timers.forEach(clearInterval); timers = []; }
  function busy(btn, p) {
    if (btn) { btn.disabled = true; btn._t = btn.innerHTML; btn.innerHTML = '…'; }
    return p.then(function (r) { if (btn) { btn.disabled = false; btn.innerHTML = btn._t; } return r; },
      function (e) { if (btn) { btn.disabled = false; btn.innerHTML = btn._t; } toast(e.message, true); throw e; });
  }
  function smsHref(phone, text) { return 'sms:' + String(phone || '').replace(/[^\d+]/g, '') + '?&body=' + encodeURIComponent(text); }

  function api(action, args) {
    args = args || {};
    var p = DEMO ? local.call(action, args, session()) :
      fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: action, args: args, session: session() }) })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (!j.ok) throw new Error(j.error || 'Something went wrong'); return j.data; });
    return p.catch(function (e) {
      if (/sign in/i.test(e.message) && /^#\/admin/.test(location.hash)) { localStorage.removeItem(SKEY); setTimeout(route, 10); }
      throw e;
    });
  }

  /* ---------------- derived tournament data ---------------- */
  function derive(T) {
    var cfg = E.defaults(T.t.config), names = {}, ent = {}, by = {}, num = {};
    T.entries.forEach(function (e) { names[e.id] = e.name; ent[e.id] = e; });
    T.matches.forEach(function (m) { by[m.id] = m; });
    var ko = T.matches.filter(function (m) { return m.stage !== 'RR'; });
    ko.forEach(function (m, i) { num[m.id] = i + 1; });
    var rr = T.matches.filter(function (m) { return m.stage === 'RR'; });
    var st = cfg.format === 'RR' && T.entries.some(function (e) { return e.grp; }) ? E.standings(cfg, T.entries, T.matches) : null;
    var plan = cfg.format === 'RR' ? E.rrPlan(cfg, T.entries.length) : null;
    function nm(id, src) {
      if (id === 'BYE') return 'BYE';
      if (id) return names[id] || '?';
      if (src) { var t = src.split(':'), ref = by[t.slice(1).join(':')]; if (ref && (t[0] === 'W' || t[0] === 'L')) return (t[0] === 'W' ? 'Winner' : 'Loser') + ' of M' + num[ref.id]; }
      return 'TBD';
    }
    return { T: T, cfg: cfg, names: names, ent: ent, by: by, num: num, ko: ko, rr: rr, st: st, plan: plan, nm: nm };
  }

  function raceLabel(cfg, m) {
    if (cfg.teamMode === 'teams') return E.raceText(cfg, m.race);
    if (m.stage === 'RR') return m.race + ' games';
    return E.raceText(cfg, m.race);
  }

  /* ---------------- router ---------------- */
  function route() {
    clearTimers(); closeModal();
    var h = location.hash.replace(/^#/, '') || '/';
    var parts = h.split('?')[0].split('/').filter(Boolean);
    $$('.nav a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-nav') === (parts[0] === 'admin' ? 'admin' : parts[0] === 'stats' || parts[0] === 'player' ? 'stats' : (parts[0] ? '' : 'home'))); });
    window.scrollTo(0, 0);
    app.innerHTML = '<div class="loading">Loading…</div>';
    var p0 = parts[0];
    try {
      if (!p0) return viewHome();
      if (p0 === 't') return viewTournament(parts[1], parts[2] || '');
      if (p0 === 'p') return viewPortal(parts[1]);
      if (p0 === 's') return viewScore(parts[1], parts[2]);
      if (p0 === 'stats') return viewStats();
      if (p0 === 'player') return viewPlayerStats(parts[1]);
      if (p0 === 'invite') return viewInvite(parts[1]);
      if (p0 === 'admin') {
        if (!session()) return viewLogin();
        var sub = parts[1] || '';
        if (localStorage.getItem('pht-mustchange') === '1' && sub !== 'password') { location.hash = '#/admin/password'; return; }
        if (!sub) return viewAdminHome();
        if (sub === 'players') return viewPlayers();
        if (sub === 'password') return viewChangePassword();
        if (sub === 'directors') return viewDirectors();
        if (sub === 'templates') return viewTemplates();
        if (sub === 'new') return viewTournamentForm(null, parts[2]);
        if (sub === 'edit') return viewTournamentForm(parts[2]);
        if (sub === 't') return viewControl(parts[2], parts[3] || 'players');
      }
      app.innerHTML = '<div class="empty">Page not found. <a href="#/">Go home</a></div>';
    } catch (e) { fail(e); }
  }
  function fail(e) { app.innerHTML = '<div class="card empty">' + esc(e.message || e) + '<br><br><a href="#/">Back to events</a></div>'; }
  window.addEventListener('hashchange', route);

  /* =====================================================================
     PUBLIC: home
     ===================================================================== */
  function viewHome() {
    api('listTournaments').then(function (r) {
      var list = r.tournaments.filter(function (t) { return t.status !== 'registration' || true; });
      var live = list.filter(function (t) { return ['roundrobin', 'finals', 'bracket'].indexOf(t.status) >= 0; });
      var upcoming = list.filter(function (t) { return t.status === 'registration' || t.status === 'drawn'; }).reverse();
      var done = list.filter(function (t) { return t.status === 'complete'; });
      app.innerHTML =
        '<div class="hero"><img src="logo.jpg" alt="' + esc(CFG.HALL_NAME || '') + '"><div><h1 style="margin:0">' + esc(CFG.HALL_NAME || 'Tournaments') + '</h1><p class="muted" style="margin:4px 0 0">Live standings, brackets and results for Saturday & Sunday tournaments.</p></div></div>' +
        section('Live now', live, 'Nothing is being played right now.') +
        section('Coming up', upcoming, 'No upcoming tournaments posted yet.') +
        section('Recent results', done.slice(0, 20), 'No results yet.');
      poll(function () { if (location.hash === '' || location.hash === '#/') viewHome(); }, 30);
    }).catch(fail);
    function section(title, list, emptyText) {
      return '<div class="section-title"><h2 style="margin:0">' + title + '</h2></div>' +
        (list.length ? '<div class="grid g2">' + list.map(tcard).join('') + '</div>' : '<div class="empty card">' + emptyText + '</div>');
    }
  }
  function tcard(t) {
    var c = t.config;
    return '<a class="card tcard" href="#/t/' + t.id + '"><div class="row between"><span class="when">' + esc(fmtDate(t.date)) + '</span>' +
      '<span class="pill ' + (t.status === 'complete' ? 'done' : (t.status === 'registration' || t.status === 'drawn') ? '' : 'live') + '">' + esc(t.statusLabel) + '</span></div>' +
      '<h2 style="margin:6px 0">' + esc(t.name) + '</h2><div class="kv"><span><b>' + c.gameType + '-ball</b></span><span>' + formatName(c) + '</span><span>' + (t.players || 0) + ' players</span></div>' +
      (t.champion ? '' : '') + '</a>';
  }
  function formatName(c) {
    var pre = c.teamMode === 'doubles' ? (c.jackJill ? 'Jack & Jill · ' : 'Doubles · ') : c.teamMode === 'teams' ? 'Teams · ' : '';
    return pre + formatName0(c);
  }
  function formatName0(c) {
    if (c.format === 'RR') return 'Round robin → ' + (c.finals === 'DE' ? 'double' : 'single') + ' knockout';
    return c.format === 'DE' ? 'Double knockout' : 'Single knockout';
  }

  /* =====================================================================
     PUBLIC: tournament
     ===================================================================== */
  function viewTournament(id, tab) {
    var state = { tab: tab };
    function load(silent) {
      return api('getTournament', { id: id }).then(function (T) { draw(derive(T)); }).catch(function (e) { if (!silent) fail(e); });
    }
    function draw(D) {
      var t = D.T.t, cfg = D.cfg, tabs = [];
      if (t.status !== 'registration' && t.status !== 'complete') tabs.push(['', t.status === 'drawn' ? 'Schedule' : 'Live']);
      if (cfg.format === 'RR' && D.st) tabs.push(['groups', 'Groups']);
      if (D.ko.length) tabs.push(['bracket', 'Bracket']);
      if (D.T.matches.length) tabs.push(['matches', 'Matches']);
      tabs.push(['players', t.status === 'complete' ? 'Results' : 'Players']);
      var cur = state.tab;
      if (!tabs.some(function (x) { return x[0] === cur; })) cur = tabs[0][0];
      var champ = t.champion ? D.names[t.champion] : '';
      app.innerHTML =
        '<div class="row between"><div><div class="when muted" style="font:600 13px var(--disp);letter-spacing:.1em;text-transform:uppercase;color:var(--red3)">' + esc(fmtDate(t.date)) + '</div>' +
        '<h1 style="margin:2px 0 4px">' + esc(t.name) + '</h1>' +
        '<div class="kv"><span><b>' + cfg.gameType + '-ball</b></span><span>' + formatName(cfg) + '</span>' + raceSummary(cfg) + '<span>' + D.T.entries.length + ' players</span><span class="pill ' + (t.status === 'complete' ? 'done' : (t.status === 'registration' || t.status === 'drawn') ? '' : 'live') + '">' + esc(t.statusLabel) + '</span></div></div>' +
        (champ ? '<div class="card" style="margin:0;text-align:center"><small>CHAMPION</small><div class="champ">🏆 ' + esc(champ) + '</div></div>' : '') + '</div>' +
        (cfg.notes ? '<p class="muted">' + esc(cfg.notes) + '</p>' : '') +
        '<div class="tabs">' + tabs.map(function (x) { return '<a href="#/t/' + id + (x[0] ? '/' + x[0] : '') + '" class="' + (x[0] === cur ? 'on' : '') + '">' + x[1] + '</a>'; }).join('') + '</div>' +
        '<div id="tabBody"></div><p class="dim" style="font-size:12px;text-align:center">Updates automatically · last refreshed ' + new Date().toLocaleTimeString() + '</p>';
      var body = $('#tabBody');
      if (cur === '') body.innerHTML = liveBoard(D);
      else if (cur === 'groups') body.innerHTML = groupsView(D, false);
      else if (cur === 'bracket') body.innerHTML = bracketView(D);
      else if (cur === 'matches') body.innerHTML = matchList(D, D.T.matches, false);
      else body.innerHTML = playersView(D);
    }
    load(); poll(function () { load(true); });
  }

  function raceSummary(cfg) {
    var s = [];
    if (cfg.teamMode === 'doubles') s.push(cfg.jackJill ? 'Jack & Jill scotch doubles' : 'Scotch doubles');
    if (cfg.teamMode === 'teams') {
      var N = cfg.playersPerSide, ptsT = cfg.teamWin === 'points' && cfg.gameType !== '9';
      s.push('Teams ' + N + 'v' + (ptsT ? E.teamRoundsOf(cfg) : N) + ' · ' + (ptsT ? 'match card' : 'race to game wins'));
      if (cfg.format === 'RR' && !ptsT) s.push('RR race to ' + cfg.raceRR);
      if (ptsT) return '<span>' + esc(s.join(' · ')) + '</span>';
    }
    if (cfg.format === 'RR' && cfg.teamMode !== 'teams') s.push(cfg.rrGames + ' games per RR match');
    var unit = cfg.raceType === 'points' && cfg.gameType !== '9' ? ' pts' : '';
    s.push('A-side race to ' + cfg.raceA + unit);
    var de = cfg.format === 'DE' || (cfg.format === 'RR' && cfg.finals === 'DE');
    if (de) s.push('B-side ' + cfg.raceB + unit);
    if (cfg.raceFinal) s.push('Final ' + cfg.raceFinal + unit);
    return '<span>' + esc(s.join(' · ')) + '</span>';
  }

  function liveBoard(D) {
    if (D.T.t.status === 'drawn') {
      var first = D.T.matches.filter(function (m) { return m.status === 'ready' || m.status === 'waiting'; }).sort(function (a, b) { return String(a.time || '99').localeCompare(String(b.time || '99')) || a.seq - b.seq; });
      return '<div class="card" style="text-align:center"><b>The draw is out — play starts soon.</b><div class="muted">Times and tables below are the plan and may change on the day.</div></div>' + matchList(D, first.slice(0, 40), false);
    }
    var live = D.T.matches.filter(function (m) { return m.status === 'live'; });
    var ready = D.T.matches.filter(function (m) { return m.status === 'ready'; }).sort(function (a, b) { return a.seq - b.seq; });
    var tables = D.cfg.tables.slice();
    live.forEach(function (m) { if (m.table && tables.indexOf(m.table) < 0) tables.push(m.table); });
    var noTable = live.filter(function (m) { return !m.table; });
    var html = '<div class="tables">' + tables.map(function (tb) {
      var m = live.filter(function (x) { return x.table === tb; })[0];
      if (!m) return '<div class="tbl"><div class="no">Table ' + esc(tb) + '</div><div class="dim" style="padding:12px 0">Open</div></div>';
      return tableCard(D, m);
    }).join('') + noTable.map(function (m) { return tableCard(D, m); }).join('') + '</div>';
    html += '<div class="section-title"><h3 style="margin:0">Up next</h3></div>';
    html += ready.length ? matchList(D, ready.slice(0, 12), false) : '<div class="empty">No matches waiting.</div>';
    return html;
  }

  function tableCard(D, m, actions) {
    var c = E.computeMatch(m, D.cfg);
    return '<div class="tbl busy"><div class="row between"><span class="no">' + (m.table ? 'Table ' + esc(m.table) : 'In play') + '</span><span class="pill live">Live</span></div>' +
      '<div class="vs"><span>' + esc(D.nm(m.p1)) + '</span><span class="sc">' + c.s1 + '</span><span>' + esc(D.nm(m.p2)) + '</span><span class="sc">' + c.s2 + '</span></div>' +
      '<small>' + esc(m.label) + (D.num[m.id] ? ' · M' + D.num[m.id] : '') + ' · ' + esc(raceLabel(D.cfg, m)) + '</small>' + (actions || '') + '</div>';
  }

  function groupsView(D, admin) {
    if (!D.st) return '<div class="empty">Groups haven\'t been drawn yet.</div>';
    var adv = D.plan.advance, html = '<div class="grid g2">';
    Object.keys(D.st).sort().forEach(function (g) {
      var rows = D.st[g], ms = D.rr.filter(function (m) { return m.grp === g; });
      var done = ms.filter(function (m) { return m.status === 'done'; }).length;
      html += '<div class="card flush"><div class="row between" style="padding:12px 14px"><h3 style="margin:0">Group ' + g + '</h3><small>' + done + '/' + ms.length + ' matches</small></div><div class="tbl-wrap"><table><thead><tr><th>#</th><th>Player</th><th class="num">P</th><th class="num">Score</th><th class="num">W</th><th class="num">ERO</th>' + (admin ? '<th class="num">Tie</th>' : '') + '</tr></thead><tbody>' +
        rows.map(function (r) {
          var e = D.ent[r.id];
          return '<tr class="' + (r.pos <= adv ? 'q' : '') + '"><td>' + r.pos + '</td><td>' + esc(D.names[r.id]) + (r.tied ? ' <span class="pill" title="Tied on every tie-breaker — one game playoff">tie</span>' : '') + (e && e.wildcard ? ' <span class="pill wc">WC</span>' : '') + '</td>' +
            '<td class="num">' + r.played + '</td><td class="num"><b>' + r.pts + '</b></td><td class="num">' + r.wins + '</td><td class="num">' + r.eros + '</td>' +
            (admin ? '<td class="num"><input data-tb="' + r.id + '" value="' + esc(e.tb || '') + '" style="width:52px;padding:4px" inputmode="numeric" title="Playoff order: 1 = won the playoff"></td>' : '') + '</tr>';
        }).join('') + '</tbody></table></div></div>';
    });
    html += '</div><p class="hint" style="margin-top:4px">Shaded = currently qualifying (top ' + adv + ' per group' + (D.plan.wildcards ? ', plus ' + D.plan.wildcards + ' wild cards drawn at random' : '') + '). Tie-breakers: head-to-head score, total wins, total EROs, then a one-game playoff.</p>';
    return html;
  }

  function bmBox(D, m, admin) {
    var c = E.computeMatch(m, D.cfg), w1 = m.winner && m.winner === m.p1, w2 = m.winner && m.winner === m.p2;
    var showScore = m.status === 'done' || m.status === 'live';
    var seed = function (id) { var e = D.ent[id]; return e && e.seed ? '<span class="seed">' + e.seed + '</span>' : ''; };
    var when = (m.status !== 'done' && m.status !== 'bye' && m.status !== 'void') ? ((m.time ? ' · ' + fmtTime(m.time) : '') + (m.plan && m.status !== 'live' ? ' · T' + esc(m.plan) : '')) : '';
    var inner = '<div class="hd"><span>M' + D.num[m.id] + (m.table && m.status === 'live' ? ' · Table ' + esc(m.table) : when) + '</span><span>' + esc(raceLabel(D.cfg, m).replace('Race to ', 'R')) + '</span></div>' +
      '<div class="pl ' + (w1 ? 'w' : w2 ? 'l' : '') + '"><span>' + seed(m.p1) + esc(D.nm(m.p1, m.src1)) + '</span><span class="s">' + (showScore ? c.s1 : '') + '</span></div>' +
      '<div class="pl ' + (w2 ? 'w' : w1 ? 'l' : '') + '"><span>' + seed(m.p2) + esc(D.nm(m.p2, m.src2)) + '</span><span class="s">' + (showScore ? c.s2 : '') + '</span></div>';
    var cls = 'bm ' + (m.status === 'live' ? 'live' : m.status === 'bye' ? 'bye' : m.status === 'void' ? 'void' : '');
    if (admin && (m.status === 'ready' || m.status === 'live' || m.status === 'done')) return '<a class="' + cls + '" style="display:block;color:inherit;text-decoration:none" href="#/s/' + m.id + '/d">' + inner + '</a>';
    return '<div class="' + cls + '">' + inner + '</div>';
  }

  function bracketView(D, admin) {
    if (!D.ko.length) return '<div class="empty">The bracket will appear here once it\'s drawn.</div>';
    function cols(stage) {
      var ms = D.ko.filter(function (m) { return m.stage === stage; }), rounds = {};
      ms.forEach(function (m) { (rounds[m.round] = rounds[m.round] || []).push(m); });
      return '<div class="bracket">' + Object.keys(rounds).sort(function (a, b) { return a - b; }).map(function (r) {
        var list = rounds[r].sort(function (a, b) { return a.pos - b.pos; });
        return '<div class="bcol"><h4>' + esc(list[0].label) + '</h4>' + list.map(function (m) { return bmBox(D, m, admin); }).join('') + '</div>';
      }).join('') + '</div>';
    }
    var html = '';
    if (D.ko.some(function (m) { return m.stage === 'SE'; })) html += cols('SE');
    else {
      html += '<div class="section-title"><h3 style="margin:0">A side (winners)</h3></div>' + cols('W');
      html += '<div class="section-title"><h3 style="margin:0">B side (one loss)</h3></div>' + cols('L');
      html += '<div class="section-title"><h3 style="margin:0">Grand final</h3></div>' + cols('GF');
      if (D.cfg.gfReset) html += '<p class="hint">If the B-side player wins the first grand final, a second (reset) match decides it.</p>';
    }
    return html;
  }

  function matchList(D, ms, admin, meId) {
    if (!ms.length) return '<div class="empty">No matches.</div>';
    return '<div class="card flush"><div class="tbl-wrap"><table><thead><tr><th>Match</th><th>Player</th><th class="num">Score</th><th class="num">Score</th><th>Player</th><th class="hide-sm">Status</th>' + (admin ? '<th></th>' : '') + '</tr></thead><tbody>' +
      ms.map(function (m) {
        var c = E.computeMatch(m, D.cfg), show = m.status === 'done' || m.status === 'live';
        var w1 = m.winner && m.winner === m.p1, w2 = m.winner && m.winner === m.p2;
        var st = m.status === 'live' ? '<span class="pill live">' + (m.table ? 'Table ' + esc(m.table) : 'Live') + '</span>' : m.status === 'done' ? '<span class="pill done">Final</span>' : '<span class="pill">' + esc(m.status) + '</span>';
        var mine = meId && (m.p1 === meId || m.p2 === meId);
        var when = (m.status === 'ready' || m.status === 'waiting') && (m.time || m.plan) ? '<br><small style="color:var(--yellow)">' + (m.time ? fmtTime(m.time) : '') + (m.time && m.plan ? ' · ' : '') + (m.plan ? 'Table ' + esc(m.plan) : '') + '</small>' : '';
        return '<tr' + (mine ? ' style="background:rgba(142,17,24,.15)"' : '') + '><td><small>' + esc(m.stage === 'RR' ? 'Grp ' + m.grp + ' · R' + m.round : 'M' + D.num[m.id] + ' · ' + m.label) + '</small>' + when + '</td>' +
          '<td style="' + (w1 ? 'color:var(--gold);font-weight:700' : '') + '">' + esc(D.nm(m.p1, m.src1)) + '</td><td class="num"><b>' + (show ? c.s1 : '') + '</b></td><td class="num"><b>' + (show ? c.s2 : '') + '</b></td>' +
          '<td style="' + (w2 ? 'color:var(--gold);font-weight:700' : '') + '">' + esc(D.nm(m.p2, m.src2)) + '</td><td class="hide-sm">' + st + '</td>' +
          (admin ? '<td class="row" style="gap:4px;flex-wrap:nowrap">' + ((m.status === 'ready' || m.status === 'live') ? tableSelect(D, m) : '') + '<a class="btn sm" href="#/s/' + m.id + '/d">Score</a></td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  function tableSelect(D, m) {
    var used = {}; D.T.matches.forEach(function (x) { if (x.status === 'live' && x.table && x.id !== m.id) used[x.table] = 1; });
    var opts = D.cfg.tables.filter(function (tb) { return !used[tb] || tb === m.table; });
    return '<select data-assign="' + m.id + '" style="width:auto;padding:4px" title="Assign table"><option value="">' + (m.status === 'live' && m.table ? 'Table ' + esc(m.table) : 'Table…') + '</option>' +
      opts.filter(function (tb) { return tb !== m.table; }).map(function (tb) { return '<option value="' + esc(tb) + '">Table ' + esc(tb) + '</option>'; }).join('') + '</select>';
  }

  function playersView(D) {
    var t = D.T.t, list = D.T.entries.slice();
    var complete = t.status === 'complete';
    if (complete) list.sort(function (a, b) { return (Number(a.place) || 999) - (Number(b.place) || 999); });
    else list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return '<div class="card flush"><div class="tbl-wrap"><table><thead><tr>' + (complete ? '<th>Place</th>' : '') + '<th>Player</th>' + (D.cfg.format === 'RR' ? '<th>Group</th>' : '') + '<th>Seed</th>' + (complete ? '<th class="num">Prize</th>' : '') + '</tr></thead><tbody>' +
      list.map(function (e) {
        var who = (e.members && e.members.length > 1) ? '<b>' + esc(e.name) + '</b>' + (e.team ? '<br><small>' + e.members.map(function (x) { return '<a href="#/player/' + x.pid + '">' + esc(x.name) + '</a>'; }).join(' · ') + '</small>' : '')
          : '<a href="#/player/' + e.pid + '">' + esc(e.name) + '</a>';
        return '<tr>' + (complete ? '<td><b>' + esc(e.place) + '</b></td>' : '') + '<td>' + who + (e.wildcard ? ' <span class="pill wc">Wild card</span>' : '') + '</td>' +
          (D.cfg.format === 'RR' ? '<td>' + esc(e.grp) + '</td>' : '') + '<td>' + esc(e.seed) + '</td>' + (complete ? '<td class="num">' + (e.payout ? money(e.payout) : '') + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* =====================================================================
     PLAYER PORTAL  (#/p/KEY)
     ===================================================================== */
  function viewPortal(key) {
    var lastCall = null;
    function load(silent) {
      return api('portal', { key: key }).then(function (T) {
        var D = derive(T), me = T.me, t = T.t, myName = D.names[me];
        var mine = T.matches.filter(function (m) { return m.p1 === me || m.p2 === me; }).sort(function (a, b) { return a.seq - b.seq; });
        var live = mine.filter(function (m) { return m.status === 'live'; });
        var ready = mine.filter(function (m) { return m.status === 'ready'; });
        var done = mine.filter(function (m) { return m.status === 'done'; });
        var waiting = mine.filter(function (m) { return m.status === 'waiting'; });
        var cur = live[0] || ready[0];
        var callSig = live[0] ? live[0].id + '@' + live[0].table : '';
        if (lastCall !== null && callSig && callSig !== lastCall) {      // newly called to a table: buzz + flash
          try { if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 600]); } catch (x) { }
          toast('You\'re up — Table ' + live[0].table + '!');
          document.title = '🎱 TABLE ' + live[0].table + ' — you\'re up';
        }
        lastCall = callSig;
        var html = '<div class="score-head"><small>' + esc(t.name) + '</small><h1 style="margin:2px 0">' + (D.ent[me].size > 1 ? esc(myName) : 'Hi ' + esc(D.ent[me].first || myName)) + '</h1><p class="muted" style="margin:0">Keep this page open — it updates by itself.</p></div>';
        if (cur) {
          var opp = cur.p1 === me ? cur.p2 : cur.p1;
          html += '<div class="banner" style="margin-top:14px">' + (cur.status === 'live' && cur.table ? '<div class="tableno" style="font:700 15px var(--disp);letter-spacing:.14em;color:var(--red3)">GO TO TABLE ' + esc(cur.table) + '</div>' : '<div class="muted">Your next match</div>') +
            '<b>vs ' + esc(D.nm(opp)) + '</b><div class="muted">' + esc(cur.label) + ' · ' + esc(raceLabel(D.cfg, cur)) + '</div>' +
            (cur.status !== 'live' && (cur.time || cur.plan) ? '<div style="margin-top:6px;color:var(--yellow);font-weight:700">' + (cur.time ? fmtTime(cur.time) : '') + (cur.time && cur.plan ? ' · ' : '') + (cur.plan ? 'Table ' + esc(cur.plan) : '') + '</div>' : '') +
            (t.status === 'drawn' ? '<div class="muted" style="margin-top:8px">Play hasn\'t started yet — you\'ll get a message when you\'re called.</div>' :
            '<a class="btn primary lg block" style="margin-top:12px" href="#/s/' + cur.id + '/' + key + '">' + ((cur.games || []).length ? 'Continue scoring' : 'Score this match') + '</a>') + '</div>';
        } else if (t.status === 'complete') {
          html += '<div class="banner"><b>Finished ' + esc(D.ent[me].place ? ordinal(D.ent[me].place) : '') + '</b>' + (D.ent[me].payout ? '<div>Prize: ' + money(D.ent[me].payout) + '</div>' : '') + '</div>';
        } else {
          var stillIn = isAlive(D, me);
          html += '<div class="card empty">' + (t.status === 'registration' ? 'The tournament hasn\'t started yet. You\'ll get a message when your first match is called.' :
            stillIn ? 'No match for you right now — waiting on other results.' : 'You\'re out of this one. Thanks for playing!') + '</div>';
        }
        html += '<div class="row" style="justify-content:center;margin:8px 0 14px"><a class="btn" href="#/t/' + t.id + '">Standings & bracket</a></div>';
        if (mine.length) html += '<h3>Your matches</h3>' + matchList(D, mine, false, me);
        app.innerHTML = html;
      }).catch(function (e) { if (!silent) fail(e); });
    }
    load(); poll(function () { load(true); }, 12);
  }
  function isAlive(D, id) {
    var losses = 0;
    D.ko.forEach(function (m) { if (m.status === 'done' && m.loser === id) losses++; });
    if (!D.ko.length) return true;
    var inB = D.ko.some(function (m) { return m.p1 === id || m.p2 === id; });
    if (!inB) return D.T.t.status === 'roundrobin';
    var de = D.ko.some(function (m) { return m.stage === 'L'; });
    return losses < (de ? 2 : 1) && !D.T.t.champion;
  }
  function ordinal(n) { n = Number(n); var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  /* =====================================================================
     SCORING  (#/s/MATCHID/KEY   key 'd' = director)
     ===================================================================== */
  function viewScore(mid, key) {
    var isDir = key === 'd';
    var tid = mid.split('-')[0];
    var st = { pending: null, ero: false, saving: false, D: null, m: null, games: null, dirty: false };
    function fetchT() { return isDir ? api('getTournament', { id: tid }) : api('portal', { key: key }); }
    function load(silent) {
      if (st.saving || st.pending || st.dirty) return Promise.resolve();
      return fetchT().then(function (T) {
        var D = derive(T), m = D.by[mid];
        if (!m) throw new Error('Match not found');
        if (!isDir && m.p1 !== T.me && m.p2 !== T.me) throw new Error('This isn\'t your match');
        st.D = D; st.m = m; st.games = JSON.parse(JSON.stringify(m.games || [])); draw();
      }).catch(function (e) { if (!silent) fail(e); });
    }
    function save(games) {
      st.saving = true;
      return api('scoreMatch', { id: mid, key: isDir ? '' : key, games: games }).then(function (r) {
        st.saving = false; st.dirty = false; st.m = r.match; st.games = JSON.parse(JSON.stringify(r.match.games || []));
        draw(); return r;
      }, function (e) { st.saving = false; toast(e.message, true); st.dirty = false; return load(); });
    }
    function back() { return isDir ? '#/admin/t/' + tid + '/tables' : '#/p/' + key; }

    function draw() {
      var D = st.D, m = st.m, cfg = D.cfg, t = D.T.t;
      var c = E.computeMatch({ stage: m.stage, race: m.race, games: st.games, lineup: m.lineup }, cfg);
      var n1 = D.nm(m.p1), n2 = D.nm(m.p2);
      var locked = t.status === 'complete' || ['waiting', 'void', 'bye'].indexOf(m.status) >= 0;
      var done = c.complete;
      var head = '<div class="row between"><a class="btn sm ghost" href="' + back() + '">← Back</a><small>' + esc(t.name) + '</small></div>' +
        '<div class="score-head" style="margin-top:8px">' + (m.table ? '<div class="tableno">Table ' + esc(m.table) + '</div>' : '') +
        '<h2 style="margin:2px 0">' + esc(m.label) + '</h2><small>' + esc(raceLabel(cfg, m)) + (m.stage === 'RR' && cfg.gameType === '8' ? ' · Win 10 · ERO 13 · Loser = balls made' : '') + '</small></div>';
      var tp = cfg.teamMode === 'teams' && c.points;
      var board = '<div class="board">' + sideBox(n1, c.s1, c.e1, c.winnerSide === 1 && done, c.s1 > c.s2, tp ? 'Match total ' + (c.mp1 || 0) : '') + sideBox(n2, c.s2, c.e2, c.winnerSide === 2 && done, c.s2 > c.s1, tp ? 'Match total ' + (c.mp2 || 0) : '') + '</div>';
      var body = '';
      if (locked) body = '<div class="card empty">' + (m.status === 'waiting' ? 'Waiting for players from earlier matches.' : m.status === 'bye' ? 'Bye — no match to play.' : m.status === 'void' ? 'Not needed.' : 'Tournament complete.') + '</div>';
      else if (cfg.teamMode === 'teams') body = teamEditor(D, m, c, n1, n2);
      else if (m.stage === 'RR') body = rrEditor(D, m, n1, n2);
      else body = koEditor(D, m, c, n1, n2);
      if (done && !locked) body = '<div class="banner"><b>' + (c.winnerSide ? esc(c.winnerSide === 1 ? n1 : n2) + ' wins' : 'Match drawn') + '</b><div class="muted">Result saved. ' + (isDir ? '' : 'Head back to your page for your next match.') + '</div>' +
        '<a class="btn primary" style="margin-top:10px" href="' + back() + '">' + (isDir ? 'Back to tables' : 'My next match') + '</a></div>' + body;
      app.innerHTML = head + board + body + (st.saving ? '<p class="dim" style="text-align:center">Saving…</p>' : '');
      bind(D, m, c);
    }
    function sideBox(n, s, e, winner, lead, extra) {
      return '<div class="side ' + (winner ? 'winner' : lead ? 'lead' : '') + '"><div class="nm">' + esc(n) + '</div><div class="big">' + s + '</div>' +
        (extra ? '<div class="sub" style="color:var(--text);font-weight:700">' + extra + '</div>' : '') + '<div class="sub">' + (e ? e + ' ERO' + (e > 1 ? 's' : '') : '&nbsp;') + '</div></div>';
    }

    /* ---- knockout: rack by rack ---- */
    function koEditor(D, m, c, n1, n2) {
      var cfg = D.cfg, pts = cfg.raceType === 'points' && cfg.gameType !== '9';
      var html = '';
      if (st.pending) {
        var loser = st.pending.w === 1 ? n2 : n1;
        html += '<div class="card"><h3 style="text-align:center">How many balls did ' + esc(loser) + ' make?</h3><div class="chips">' +
          [0, 1, 2, 3, 4, 5, 6, 7].map(function (n) { return '<button class="chip" data-balls="' + n + '">' + n + '</button>'; }).join('') +
          '</div><div class="row" style="justify-content:center;margin-top:12px"><button class="btn ghost" data-act="cancel">Cancel</button></div></div>';
        return html;
      }
      if (!c.complete) {
        html += '<label class="chk card" style="justify-content:center;font-weight:700"><input type="checkbox" id="ero" ' + (st.ero ? 'checked' : '') + '> Next rack was a break & run (ERO)</label>' +
          '<div class="board" style="margin-top:0"><button class="btn primary rackbtn" data-rack="1">+ Rack<br><small>' + esc(n1) + '</small></button>' +
          '<button class="btn primary rackbtn" data-rack="2">+ Rack<br><small>' + esc(n2) + '</small></button></div>';
      }
      html += '<div class="card"><div class="row between"><h3 style="margin:0">Racks</h3>' + (st.games.length ? '<button class="btn sm danger" data-act="undo">Undo last rack</button>' : '') + '</div><div class="rackhist" style="margin-top:8px">' +
        (st.games.length ? st.games.map(function (g, i) {
          var who = g.w === 1 ? n1 : n2;
          return '<span class="rk ' + (g.e ? 'e' : '') + '">' + (i + 1) + '. ' + esc(who.split(' ')[0]) + (g.e ? ' ERO' : '') + (pts ? ' (' + 10 + '–' + (g.n || 0) + ')' : '') + '</span>';
        }).join('') : '<span class="dim">No racks yet — tap the rack winner after each rack.</span>') + '</div></div>';
      return html;
    }

    /* ---- team match card ---- */
    function teamEditor(D, m, c, n1, n2) {
      var cfg = D.cfg, P = E.teamSide(cfg), R = E.teamRoundsOf(cfg), A = D.ent[m.p1].members || [], B = D.ent[m.p2].members || [];
      var L = st.lineup || m.lineup || {}, started = st.games.some(function (x) { return x; });
      var html = '';
      if (!started && (!c.ready || st.editLineup)) {
        var pick = function (side, list, cur) {
          var out = '';
          for (var i = 0; i < P; i++) out += '<label class="f" style="margin-bottom:6px">Player ' + (i + 1) + '<select data-lu="' + side + '" data-i="' + i + '">' +
            '<option value="">— choose —</option>' + list.map(function (x) { return '<option value="' + x.pid + '"' + ((cur || [])[i] === x.pid ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></label>';
          return out;
        };
        return '<div class="card"><h3 style="text-align:center">Line-ups · ' + P + 'v' + (c.points ? R : P) + '</h3><p class="hint" style="text-align:center">Pick ' + P + ' players for each side in order (player 1, 2, 3…). The app sets the opponents for every round.</p>' +
          '<div class="gcols"><div><div class="who">' + esc(n1) + ' (home)</div>' + pick('h', A, L.h) + '</div><div><div class="who">' + esc(n2) + ' (away)</div>' + pick('a', B, L.a) + '</div></div>' +
          '<button class="btn primary block" data-act="saveLineup" style="margin-top:8px">Lock in line-ups & start</button></div>';
      }
      var NR = c.showRounds, nmOf = function (list, pid) { var x = list.filter(function (y) { return y.pid === pid; })[0]; return x ? x.name : '—'; };
      var canEdit = !c.complete || isDir;
      function slot(side, idx, r) {             // which game slot a player is in for round r
        var rot = (c.points && r >= R) ? R - 1 : r % P;
        var b = side === 'h' ? idx : ((idx - rot) % P + P) % P;
        return { k: r * P + b, opp: side === 'h' ? ((b + rot) % P) + 1 : b + 1 };
      }
      function block(side, name, list, hcp) {
        var ids = side === 'h' ? L.h : L.a, my = side === 'h' ? 1 : 2;
        var head = '<tr><th class="pn">' + esc(name) + ' <span class="dim" style="font-weight:500">(' + (side === 'h' ? 'home' : 'away') + ')</span></th>';
        for (var r = 0; r < NR; r++) head += '<th class="rc">R' + (r + 1) + (r >= R && c.points ? '<br><small>replay</small>' : '') + '</th>';
        head += '<th class="rc">Total</th></tr>';
        var rows = (ids || []).map(function (pid, i) {
          var tot = 0, row = '<tr><td class="pn"><span class="pnum">' + (i + 1) + '</span>' + esc(nmOf(list, pid)) + '</td>';
          for (var r = 0; r < NR; r++) {
            var sl = slot(side, i, r), g = st.games[sl.k], val = '', tag = '', cls = 'cell';
            if (g && g.w) {
              var pts = E.gamePts(g, my); if (r < R || !c.points) tot += c.points ? pts : (g.w === my ? 1 : 0);
              val = c.points ? pts : (g.w === my ? 'W' : 'L'); cls += g.w === my ? ' won' : ' lost';
              tag = (my === 1 ? g.t1 : g.t2) || '';
            } else if (c.complete) { cls += ' na'; val = '·'; }
            row += '<td class="' + cls + '"' + (canEdit && !(c.complete && !(g && g.w)) ? ' data-cell="' + sl.k + '"' : '') + '><b>' + val + '</b>' + (tag ? '<span class="tg">' + tag + '</span>' : '') + '<span class="op">' + sl.opp + '</span></td>';
          }
          return row + '<td class="cell tot"><b>' + tot + '</b></td></tr>';
        }).join('');
        var sum = '';
        var rowOf = function (label, fn, totFn, cls) {
          var t = '<tr class="' + (cls || '') + '"><td class="pn lbl">' + label + '</td>';
          for (var r = 0; r < NR; r++) { var o = c.rounds[r]; t += '<td class="cell">' + (o ? fn(o, r) : '') + '</td>'; }
          return t + '<td class="cell tot">' + totFn() + '</td></tr>';
        };
        if (c.points) {
          var regular = function (fnTot) { return fnTot; };
          sum += rowOf('Sub-total', function (o) { return my === 1 ? o.sub1 : o.sub2; }, function () { return c.rounds.slice(0, R).reduce(function (a, o) { return a + (my === 1 ? o.sub1 : o.sub2); }, 0); }, 'st');
          sum += rowOf('Handicap', function (o) { return hcp; }, function () { return hcp * R; }, 'hc');
          sum += rowOf('Round total', function (o) { return my === 1 ? o.tot1 : o.tot2; }, function () { return my === 1 ? c.grand1 : c.grand2; }, 'rt');
          sum += rowOf('Wins per round', function (o) { return my === 1 ? o.gw1 : o.gw2; }, function () { return my === 1 ? c.gw1 : c.gw2; }, 'wr');
          sum += rowOf('Total', function (o) { return o.full ? (o.win === my ? 1 : 0) : ''; }, function () { return '<b>' + (my === 1 ? c.mp1 : c.mp2) + '</b>'; }, 'tt');
        } else {
          sum += rowOf('Wins per round', function (o) { return my === 1 ? o.gw1 : o.gw2; }, function () { return (my === 1 ? c.w1 : c.w2) + (hcp ? ' +' + hcp : ''); }, 'wr');
        }
        return '<div class="card flush mc-wrap"><div class="tbl-wrap"><table class="mc"><thead>' + head + '</thead><tbody>' + rows + sum + '</tbody></table></div></div>';
      }
      html += '<p class="muted" style="text-align:center;margin-top:-4px">' + (c.points ? 'Round goes to the higher round total (tie → more wins). +1 to the team with more total points. Most in <b>Total</b> wins.' : 'First to ' + m.race + ' game wins takes the match.') +
        ' Home breaks rounds 1, 3' + (NR > 4 ? ', 5' : '') + '; away breaks 2, 4. Small numbers = opponent. Tap a box to enter that game.</p>';
      if (c.points && c.complete) html += '<p style="text-align:center"><span class="pill gold">Overall points: ' + (c.overall ? esc(c.overall === 1 ? n1 : n2) + ' +1' : 'tied') + '</span></p>';
      if (c.tied) html += '<div class="banner" style="padding:10px"><b style="font-size:18px">Tied — replay round ' + R + '</b><div class="muted">Same pairings as round ' + R + '. Whoever wins the replay round wins the match.</div></div>';
      html += block('h', n1, A, c.hcp1) + block('a', n2, B, c.hcp2);
      if (isDir) html += '<div style="text-align:center"><button class="link" data-act="editLineup">Change line-ups (director)</button></div>';
      return html;
    }

    function gameModal(k) {
      var D = st.D, m = st.m, cfg = D.cfg, L = m.lineup || {}, pr = E.teamPair(cfg, L, k), pts = cfg.teamWin === 'points' && cfg.gameType !== '9';
      var A = D.ent[m.p1].members || [], B = D.ent[m.p2].members || [];
      var nmOf = function (list, pid) { var x = list.filter(function (y) { return y.pid === pid; })[0]; return x ? x.name : '—'; };
      var g = JSON.parse(JSON.stringify(st.games[k] || { w: 0, n: null, t1: '', t2: '' }));
      function render() {
        var tagRow = function (side) { var cur = side === 1 ? g.t1 : g.t2; return '<div class="chips" style="justify-content:flex-start">' + ['', 'ERO', 'BRO', '1ST'].map(function (t) { return '<button class="chip' + ((cur || '') === t ? ' on' : '') + '" style="min-width:52px;padding:7px 6px;font-size:13px" data-tag="' + side + '" data-t="' + t + '">' + (t || 'none') + '</button>'; }).join('') + '</div>'; };
        var loserName = g.w === 1 ? nmOf(B, pr.away) : g.w === 2 ? nmOf(A, pr.home) : '';
        return '<h2>Round ' + (pr.round + 1) + (pr.replay ? ' (replay)' : '') + '</h2><p class="muted" style="margin-top:-6px">' + (pr.homeBreaks ? 'Home' : 'Away') + ' breaks</p>' +
          '<h3>Who won?</h3><div class="gcols"><button class="btn ' + (g.w === 1 ? 'primary' : '') + ' block" data-win="1">' + esc(nmOf(A, pr.home)) + '</button><button class="btn ' + (g.w === 2 ? 'primary' : '') + ' block" data-win="2">' + esc(nmOf(B, pr.away)) + '</button></div>' +
          (pts && g.w ? '<h3 style="margin-top:14px">Balls made by ' + esc(loserName) + '</h3><div class="chips">' + [0, 1, 2, 3, 4, 5, 6, 7].map(function (n) { return '<button class="chip' + (g.n === n ? ' on' : '') + '" data-n="' + n + '">' + n + '</button>'; }).join('') + '</div>' : '') +
          '<h3 style="margin-top:14px">' + esc(nmOf(A, pr.home)) + '</h3>' + tagRow(1) + '<h3 style="margin-top:10px">' + esc(nmOf(B, pr.away)) + '</h3>' + tagRow(2) +
          '<div class="row" style="margin-top:16px"><button class="btn primary" data-act="gsave">Save</button>' + (st.games[k] ? '<button class="btn danger" data-act="gclear">Clear game</button>' : '') + '<button class="btn ghost" data-close>Cancel</button></div>';
      }
      function bindM(c) {
        $$('[data-win]', c).forEach(function (b) { b.onclick = function () { g.w = Number(b.getAttribute('data-win')); if (!pts) g.n = 0; c.innerHTML = render(); bindM(c); }; });
        $$('[data-n]', c).forEach(function (b) { b.onclick = function () { g.n = Number(b.getAttribute('data-n')); c.innerHTML = render(); bindM(c); }; });
        $$('[data-tag]', c).forEach(function (b) { b.onclick = function () { if (b.getAttribute('data-tag') === '1') g.t1 = b.getAttribute('data-t'); else g.t2 = b.getAttribute('data-t'); c.innerHTML = render(); bindM(c); }; });
        $$('[data-close]', c).forEach(function (b) { b.onclick = closeModal; });
        var sv = $('[data-act=gsave]', c); if (sv) sv.onclick = function () {
          if (!g.w) return toast('Pick the winner', true);
          if (pts && (g.n === null || g.n === undefined)) return toast('Enter the balls made by the loser', true);
          closeModal(); setTeamGame(k, { w: g.w, n: g.n || 0, t1: g.t1 || '', t2: g.t2 || '' });
        };
        var cl = $('[data-act=gclear]', c); if (cl) cl.onclick = function () { closeModal(); setTeamGame(k, null); };
      }
      modal(render(), bindM);
    }
    function setTeamGame(k, g) {
      var games = st.games.slice(); while (games.length <= k) games.push(null); games[k] = g;
      while (games.length && !games[games.length - 1]) games.pop();
      st.games = games; st.dirty = true; draw(); save(games);
    }

    /* ---- round robin: fixed games ---- */
    function rrEditor(D, m, n1, n2) {
      var cfg = D.cfg, N = cfg.rrGames || 2, html = '';
      for (var i = 0; i < N; i++) {
        var g = st.games[i] || { a: null, b: null };
        var prevOk = i === 0 || rrOk(cfg, st.games[i - 1]);
        var ok = rrOk(cfg, g);
        html += '<div class="game ' + (!prevOk ? 'locked' : ok ? 'ok' : '') + '" data-g="' + i + '"><div class="gh"><span>Game ' + (i + 1) + '</span>' +
          (ok ? '<span class="pill done">' + E.rrSidePts(cfg.gameType, g.a).pts + ' – ' + E.rrSidePts(cfg.gameType, g.b).pts + '</span>' : '<span class="dim">tap results</span>') + '</div>' +
          '<div class="gcols">' + rrSide(cfg, g, 'a', n1) + rrSide(cfg, g, 'b', n2) + '</div>' +
          (ok && i === st.games.length - 1 ? '<div style="text-align:center;margin-top:8px"><button class="link" data-clear="' + i + '">Clear this game</button></div>' : '') + '</div>';
      }
      return html;
    }
    function rrSide(cfg, g, side, name) {
      var s = g[side], o = g[side === 'a' ? 'b' : 'a'], r = s && s.r;
      var html = '<div><div class="who">' + esc(name) + '</div><div class="opt">';
      if (cfg.gameType === '9') {
        html += btn('W', 'Won') + btn('E', 'Won · B&R') + btn('L', 'Lost');
      } else {
        html += btn('W', 'Won (10)') + btn('E', 'ERO (13)');
        if (o && o.r === 'E') html += btn('R', 'Response ERO (13)');
        html += btn('L', 'Lost');
      }
      html += '</div>';
      if (cfg.gameType !== '9' && r === 'L') {
        html += '<small class="muted">Balls made</small><div class="chips" style="margin-top:4px">' + [0, 1, 2, 3, 4, 5, 6, 7].map(function (n) {
          return '<button class="chip' + (s.n === n ? ' on' : '') + '" style="min-width:34px;padding:7px 0;font-size:14px" data-gb="' + side + '" data-n="' + n + '">' + n + '</button>'; }).join('') + '</div>';
      }
      return html + '</div>';
      function btn(code, label) { return '<button class="chip' + (r === code ? ' on' : '') + '" data-gr="' + side + '" data-r="' + code + '">' + label + '</button>'; }
    }
    function rrOk(cfg, g) {
      if (!g || !g.a || !g.b) return false;
      if (cfg.gameType !== '9' && ((g.a.r === 'L' && g.a.n == null) || (g.b.r === 'L' && g.b.n == null))) return false;
      return !E.validRRGame(cfg.gameType, g);
    }

    function bind(D, m, c) {
      var cfg = D.cfg;
      var ero = $('#ero'); if (ero) ero.onchange = function () { st.ero = ero.checked; };
      $$('[data-rack]').forEach(function (b) {
        b.onclick = function () {
          var w = Number(b.getAttribute('data-rack'));
          if (cfg.raceType === 'points' && cfg.gameType !== '9') { st.pending = { w: w, e: st.ero ? 1 : 0 }; draw(); return; }
          var g = st.games.concat([{ w: w, e: st.ero ? 1 : 0, n: 0 }]); st.ero = false; st.games = g; st.dirty = true; draw(); save(g);
        };
      });
      $$('[data-balls]').forEach(function (b) {
        b.onclick = function () {
          var g = st.games.concat([{ w: st.pending.w, e: st.pending.e, n: Number(b.getAttribute('data-balls')) }]);
          st.pending = null; st.ero = false; st.games = g; st.dirty = true; draw(); save(g);
        };
      });
      var cancel = $('[data-act=cancel]'); if (cancel) cancel.onclick = function () { st.pending = null; draw(); };
      var undo = $('[data-act=undo]'); if (undo) undo.onclick = function () {
        if (!confirm('Remove the last rack?')) return;
        var g = st.games.slice(0, -1); st.games = g; st.dirty = true; draw(); save(g);
      };
      // team rounds
      var saveLu = $('[data-act=saveLineup]');
      if (saveLu) saveLu.onclick = function () {
        var L = { h: [], a: [] };
        $$('[data-lu]').forEach(function (sl) { L[sl.getAttribute('data-lu')][Number(sl.getAttribute('data-i'))] = sl.value; });
        var N = E.teamSide(cfg), okSide = function (x) { return x.filter(Boolean).length === N && x.filter(function (p, i) { return p && x.indexOf(p) === i; }).length === N; };
        if (!okSide(L.h) || !okSide(L.a)) return toast('Pick ' + N + ' different players for each side', true);
        st.lineup = L; st.editLineup = false; st.saving = true; st.dirty = false;
        api('scoreMatch', { id: mid, key: isDir ? '' : key, games: st.games, lineup: L }).then(function (r) {
          st.saving = false; st.m = r.match; st.lineup = null; st.games = JSON.parse(JSON.stringify(r.match.games || [])); draw();
        }, function (e) { st.saving = false; st.lineup = null; toast(e.message, true); load(); });
      };
      $$('[data-lu]').forEach(function (sl) {      // keep picks while the page refreshes
        sl.onchange = function () {
          var L = st.lineup || JSON.parse(JSON.stringify(m.lineup || {})); L.h = L.h || []; L.a = L.a || [];
          L[sl.getAttribute('data-lu')][Number(sl.getAttribute('data-i'))] = sl.value; st.lineup = L; st.dirty = true;
        };
      });
      var edl = $('[data-act=editLineup]'); if (edl) edl.onclick = function () {
        if (st.games.some(function (x) { return x; })) return toast('Clear the games first (Reset match below), then change line-ups', true);
        st.editLineup = true; draw();
      };
      $$('[data-cell]').forEach(function (td) { td.onclick = function () { gameModal(Number(td.getAttribute('data-cell'))); }; });
      // round robin
      $$('[data-gr]').forEach(function (b) {
        b.onclick = function () {
          var gi = Number(b.closest('[data-g]').getAttribute('data-g')), side = b.getAttribute('data-gr'), r = b.getAttribute('data-r'), other = side === 'a' ? 'b' : 'a';
          var g = st.games[gi] ? JSON.parse(JSON.stringify(st.games[gi])) : { a: null, b: null };
          g[side] = { r: r, n: r === 'L' ? (g[side] && g[side].n != null && g[side].r === 'L' ? g[side].n : (cfg.gameType === '9' ? 0 : null)) : 0 };
          if (r === 'W' || r === 'E') { if (!g[other] || g[other].r === 'W' || g[other].r === 'E' || (g[other].r === 'R' && r !== 'E')) g[other] = { r: 'L', n: cfg.gameType === '9' ? 0 : null }; }
          if (r === 'L' && cfg.gameType === '9' && (!g[other] || g[other].r === 'L')) g[other] = { r: 'W', n: 0 };
          if (r !== 'E' && g[other] && g[other].r === 'R') g[other] = { r: 'L', n: null };
          rrSet(gi, g);
        };
      });
      $$('[data-gb]').forEach(function (b) {
        b.onclick = function () {
          var gi = Number(b.closest('[data-g]').getAttribute('data-g')), side = b.getAttribute('data-gb');
          var g = JSON.parse(JSON.stringify(st.games[gi])); g[side].n = Number(b.getAttribute('data-n')); rrSet(gi, g);
        };
      });
      $$('[data-clear]').forEach(function (b) {
        b.onclick = function () { var gi = Number(b.getAttribute('data-clear')); var g = st.games.slice(0, gi); st.games = g; st.dirty = true; draw(); save(g); };
      });
      function rrSet(gi, g) {
        var games = st.games.slice(); games[gi] = g; st.games = games;
        var valid = []; for (var i = 0; i < games.length; i++) { if (rrOk(cfg, games[i])) valid.push(games[i]); else break; }
        var savedLen = (st.m.games || []).length;
        if (valid.length > gi || (valid.length !== savedLen)) { st.dirty = true; draw(); if (valid.length > gi) save(valid); }
        else { st.dirty = true; draw(); }
      }
    }
    load(); poll(function () { load(true); }, 10);
  }

  /* =====================================================================
     STATS
     ===================================================================== */
  var historyCache = null;
  function getHistory() {
    if (historyCache && Date.now() - historyCache.at < 60000) return Promise.resolve(historyCache.data);
    return api('history').then(function (h) { historyCache = { at: Date.now(), data: buildStats(h) }; return historyCache.data; });
  }
  function buildStats(h) {
    var tmap = {}, emap = {}, P = {};
    h.tournaments.forEach(function (t) { tmap[t.id] = t; });
    h.players.forEach(function (p) { P[p.id] = { id: p.id, name: p.name, events: 0, titles: 0, cashes: 0, earnings: 0, best: 0, rank12: 0, mw: 0, ml: 0, gw: 0, gl: 0, eros: 0, games: 0, rrPts: 0, rrM: 0, by: { '8': { mw: 0, ml: 0 }, '9': { mw: 0, ml: 0 } }, h2h: {}, recent: [] }; });
    var yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    function mem(e) { return e.members && e.members.length ? e.members : [{ pid: e.pid }]; }
    h.entries.forEach(function (e) {
      emap[e.id] = e; var t = tmap[e.tid]; if (!t) return;
      var cfg = E.defaults(t.config), ms = mem(e), team = cfg.teamMode !== 'singles';
      if (team && cfg.teamStats === 'none') return;
      ms.forEach(function (x) {
        var p = P[x.pid]; if (!p) return;
        p.events++; var pl = Number(e.place) || 0, pay = (Number(e.payout) || 0) / ms.length;
        if (pl === 1) p.titles++; if (pay > 0) { p.cashes++; p.earnings += pay; }
        if (pl && (!p.best || pl < p.best)) p.best = pl;
        if (String(t.date || t.updated).slice(0, 10) >= yearAgo) p.rank12 += Number(e.rankPts) || 0;
        p.recent.push({ t: t, place: pl, payout: pay, wc: e.wildcard, team: team ? (e.team || ms.map(function (y) { return P[y.pid] ? P[y.pid].name.split(' ')[0] : '?'; }).join(' & ')) : '' });
      });
    });
    function credit(a, b, c, rr, gt, aw, bw, h2h) {
      a.gw += c.w1; a.gl += c.w2; b.gw += c.w2; b.gl += c.w1; a.eros += c.e1; b.eros += c.e2;
      a.games += c.played; b.games += c.played;
      if (rr) { a.rrPts += c.s1; b.rrPts += c.s2; a.rrM++; b.rrM++; }
      if (aw || bw) {
        var W = aw ? a : b, L = aw ? b : a; W.mw++; L.ml++; W.by[gt].mw++; L.by[gt].ml++;
        if (h2h) { (W.h2h[L.id] = W.h2h[L.id] || { w: 0, l: 0 }).w++; (L.h2h[W.id] = L.h2h[W.id] || { w: 0, l: 0 }).l++; }
      }
    }
    h.matches.forEach(function (m) {
      var e1 = emap[m.p1], e2 = emap[m.p2], t = tmap[m.tid]; if (!e1 || !e2 || !t) return;
      var cfg = E.defaults(t.config);
      if (cfg.teamMode !== 'singles') {
        if (cfg.teamStats !== 'all') return;
        if (cfg.teamMode === 'teams') {
          (m.games || []).forEach(function (g, k) {
            if (!g || !g.w) return;
            var pr = E.teamPair(cfg, m.lineup, k), a = P[pr.home], b = P[pr.away]; if (!a || !b) return;
            var c = { s1: 0, s2: 0, w1: g.w === 1 ? 1 : 0, w2: g.w === 2 ? 1 : 0, e1: g.t1 === 'ERO' ? 1 : 0, e2: g.t2 === 'ERO' ? 1 : 0, played: 1 };
            credit(a, b, c, false, cfg.gameType, g.w === 1, g.w === 2, true);
            if (g.t1 === 'BRO') a.bro = (a.bro || 0) + 1; if (g.t2 === 'BRO') b.bro = (b.bro || 0) + 1;
            if (g.t1 === '1ST') a.first = (a.first || 0) + 1; if (g.t2 === '1ST') b.first = (b.first || 0) + 1;
          });
        } else {
          var c2 = E.computeMatch(m, cfg);
          mem(e1).forEach(function (x) { mem(e2).forEach(function (y, j) {
            var a = P[x.pid], b = P[y.pid]; if (!a || !b) return;
            // count each player's own match once (pair up with first opponent only), h2h vs every opponent
            if (j === 0) credit(a, { gw: 0, gl: 0, eros: 0, games: 0, rrPts: 0, rrM: 0, mw: 0, ml: 0, by: { '8': { mw: 0, ml: 0 }, '9': { mw: 0, ml: 0 } }, h2h: {} }, c2, m.stage === 'RR', cfg.gameType, m.winner === m.p1, m.winner === m.p2, false);
          }); });
          mem(e2).forEach(function (y) { var b = P[y.pid]; if (!b) return;
            credit(b, { gw: 0, gl: 0, eros: 0, games: 0, rrPts: 0, rrM: 0, mw: 0, ml: 0, by: { '8': { mw: 0, ml: 0 }, '9': { mw: 0, ml: 0 } }, h2h: {} }, swap(c2), m.stage === 'RR', cfg.gameType, m.winner === m.p2, m.winner === m.p1, false); });
        }
        return;
      }
      var a = P[e1.pid], b = P[e2.pid]; if (!a || !b) return;
      var c = E.computeMatch(m, cfg), gt = cfg.gameType;
      credit(a, b, c, m.stage === 'RR', gt, m.winner === m.p1, m.winner === m.p2, true);
    });
    function swap(c) { return { s1: c.s2, s2: c.s1, w1: c.w2, w2: c.w1, e1: c.e2, e2: c.e1, played: c.played }; }
    Object.keys(P).forEach(function (id) { P[id].recent.sort(function (x, y) { return String(y.t.date).localeCompare(String(x.t.date)); }); });
    return { players: P, tournaments: h.tournaments };
  }
  function pct(w, l) { return w + l ? Math.round(100 * w / (w + l)) + '%' : '–'; }

  function viewStats() {
    var sortKey = 'rank12';
    getHistory().then(function (S) {
      function draw() {
        var list = Object.keys(S.players).map(function (k) { return S.players[k]; }).filter(function (p) { return p.events > 0; });
        var keyFn = { rank12: function (p) { return p.rank12; }, titles: function (p) { return p.titles * 1000 + p.cashes; }, earnings: function (p) { return p.earnings; },
          winpct: function (p) { return p.mw + p.ml >= 5 ? p.mw / (p.mw + p.ml) : -1; }, eros: function (p) { return p.eros; }, events: function (p) { return p.events; } }[sortKey];
        list.sort(function (a, b) { return keyFn(b) - keyFn(a) || a.name.localeCompare(b.name); });
        var th = function (k, l) { return '<th class="num"><button class="link" style="color:' + (k === sortKey ? 'var(--text)' : 'var(--muted)') + ';text-decoration:none;font:inherit" data-sort="' + k + '">' + l + (k === sortKey ? ' ▾' : '') + '</button></th>'; };
        app.innerHTML = '<h1>Player stats</h1><p class="muted" style="margin-top:-6px">Built from every completed tournament. Ranking points cover the last 12 months.</p>' +
          '<input id="pfind" placeholder="Find a player…" style="max-width:320px;margin-bottom:12px">' +
          (list.length ? '<div class="card flush"><div class="tbl-wrap"><table><thead><tr><th>#</th><th>Player</th>' + th('rank12', 'Rank pts') + th('events', 'Events') + th('titles', 'Titles') + th('earnings', 'Winnings') + th('winpct', 'Match win %') + th('eros', 'EROs') + '</tr></thead><tbody id="ptbody">' +
            list.map(function (p, i) {
              return '<tr data-name="' + esc(p.name.toLowerCase()) + '"><td>' + (i + 1) + '</td><td><a href="#/player/' + p.id + '">' + esc(p.name) + '</a></td><td class="num"><b>' + p.rank12 + '</b></td><td class="num">' + p.events + '</td><td class="num">' + p.titles + '</td><td class="num">' + money(p.earnings) + '</td><td class="num">' + pct(p.mw, p.ml) + '</td><td class="num">' + p.eros + '</td></tr>';
            }).join('') + '</tbody></table></div></div>' : '<div class="card empty">Stats will appear after the first tournament is finished.</div>');
        $$('[data-sort]').forEach(function (b) { b.onclick = function () { sortKey = b.getAttribute('data-sort'); draw(); }; });
        var f = $('#pfind'); if (f) f.oninput = function () { var q = f.value.toLowerCase(); $$('#ptbody tr').forEach(function (tr) { tr.style.display = tr.getAttribute('data-name').indexOf(q) >= 0 ? '' : 'none'; }); };
      }
      draw();
    }).catch(fail);
  }

  function viewPlayerStats(pid) {
    getHistory().then(function (S) {
      var p = S.players[pid]; if (!p) throw new Error('Player not found');
      var opps = Object.keys(p.h2h).map(function (o) { return { id: o, name: S.players[o] ? S.players[o].name : '?', w: p.h2h[o].w, l: p.h2h[o].l }; })
        .sort(function (a, b) { return (b.w + b.l) - (a.w + a.l) || a.name.localeCompare(b.name); });
      var stat = function (v, l) { return '<div class="stat"><b>' + v + '</b><span>' + l + '</span></div>'; };
      app.innerHTML = '<a class="btn sm ghost" href="#/stats">← All players</a><h1 style="margin-top:10px">' + esc(p.name) + '</h1>' +
        '<div class="grid g3" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">' +
        stat(p.rank12, 'Rank pts (12 mo)') + stat(p.events, 'Tournaments') + stat(p.titles, 'Titles') + stat(p.best ? ordinal(p.best) : '–', 'Best finish') +
        stat(p.cashes, 'Cashes') + stat(money(p.earnings), 'Winnings') + stat(p.mw + '–' + p.ml, 'Matches W–L') + stat(pct(p.mw, p.ml), 'Match win %') +
        stat(p.gw + '–' + p.gl, 'Games/racks W–L') + stat(pct(p.gw, p.gl), 'Game win %') + stat(p.eros, 'EROs') + (p.bro ? stat(p.bro, 'BROs') : '') + (p.first ? stat(p.first, '1STs') : '') + stat(p.games ? (100 * p.eros / p.games).toFixed(1) + '%' : '–', 'ERO rate') +
        stat(p.rrM ? (p.rrPts / p.rrM).toFixed(1) : '–', 'Avg RR pts/match') + stat(pct(p.by['8'].mw, p.by['8'].ml), '8-ball match %') + stat(pct(p.by['9'].mw, p.by['9'].ml), '9-ball match %') + '</div>' +
        '<div class="grid g2" style="margin-top:14px"><div class="card flush"><h3 style="padding:12px 14px 0">Recent tournaments</h3><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Event</th><th class="num">Place</th><th class="num">Prize</th></tr></thead><tbody>' +
        p.recent.slice(0, 25).map(function (r) { return '<tr><td>' + esc(r.t.date) + '</td><td><a href="#/t/' + r.t.id + '/players">' + esc(r.t.name) + '</a>' + (r.team ? '<br><small class="muted">with ' + esc(r.team) + '</small>' : '') + (r.wc ? ' <span class="pill wc">WC</span>' : '') + '</td><td class="num">' + (r.place ? ordinal(r.place) : '') + '</td><td class="num">' + (r.payout ? money(r.payout) : '') + '</td></tr>'; }).join('') +
        '</tbody></table></div></div><div class="card flush"><h3 style="padding:12px 14px 0">Head to head</h3><div class="tbl-wrap"><table><thead><tr><th>Opponent</th><th class="num">W</th><th class="num">L</th></tr></thead><tbody>' +
        (opps.length ? opps.map(function (o) { return '<tr><td><a href="#/player/' + o.id + '">' + esc(o.name) + '</a></td><td class="num">' + o.w + '</td><td class="num">' + o.l + '</td></tr>'; }).join('') : '<tr><td colspan="3" class="dim">No matches yet</td></tr>') +
        '</tbody></table></div></div></div>';
    }).catch(fail);
  }

  /* =====================================================================
     DIRECTOR: login + home
     ===================================================================== */
  function viewLogin() {
    app.innerHTML = '<div class="card" style="max-width:380px;margin:30px auto"><h2>Director sign in</h2><form id="lf"><label class="f">Username<input name="u" autocomplete="username" autocapitalize="off" required></label>' +
      '<label class="f">Password<input name="p" type="password" autocomplete="current-password" required></label><button class="btn primary block">Sign in</button></form>' +
      (DEMO ? '' : '<p class="muted" style="text-align:center;margin:14px 0 0;font-size:13px">Just want to try it? <button class="link" id="tryDemo">Open the demo</button><br><span class="dim">(or sign in as demo / demo123)</span></p>') + '</div>';
    var td = $('#tryDemo'); if (td) td.onclick = enterDemo;
    $('#lf').onsubmit = function (e) {
      e.preventDefault(); var f = e.target;
      if (!DEMO && f.u.value.trim().toLowerCase() === 'demo') {
        if (f.p.value === 'demo123') return enterDemo();
        return toast('The demo password is demo123', true);
      }
      busy(f.querySelector('button'), api('login', { username: f.u.value, password: f.p.value })).then(function (r) {
        localStorage.setItem(SKEY, r.session);
        if (r.mustChange) { localStorage.setItem('pht-mustchange', '1'); location.hash = '#/admin/password'; route(); return; }
        localStorage.removeItem('pht-mustchange'); toast('Welcome, ' + r.name); route();
      });
    };
  }

  function adminNav(on) {
    var items = [['', 'Tournaments'], ['players', 'Players'], ['templates', 'Templates'], ['directors', 'Directors']];
    return '<div class="row between"><div class="tabs" style="margin:0 0 14px;flex:1">' + items.map(function (x) { return '<a href="#/admin' + (x[0] ? '/' + x[0] : '') + '" class="' + (x[0] === on ? 'on' : '') + '">' + x[1] + '</a>'; }).join('') +
      '</div><div class="row" style="margin-bottom:14px;gap:6px"><a class="btn sm ghost" href="#/admin/password">My password</a><button class="btn sm ghost" id="logout">Sign out</button></div></div>';
  }
  function bindLogout() { var b = $('#logout'); if (b) b.onclick = function () { api('logout').finally(function () { localStorage.removeItem(SKEY); localStorage.removeItem('pht-mustchange'); location.hash = '#/'; }); }; }

  /* ---------------- change my password (forced after a temporary password) ---------------- */
  function viewChangePassword() {
    var forced = localStorage.getItem('pht-mustchange') === '1';
    app.innerHTML = (forced ? '' : adminNav('')) + '<div class="card" style="max-width:420px;margin:20px auto"><h2>' + (forced ? 'Choose your password' : 'Change my password') + '</h2>' +
      (forced ? '<p class="muted">You signed in with a temporary password. Pick your own to continue.</p>' : '') +
      '<form id="cp"><label class="f">' + (forced ? 'Temporary password' : 'Current password') + '<input name="cur" type="password" required autocomplete="current-password"></label>' +
      '<label class="f">New password (6+ characters)<input name="n1" type="password" required minlength="6" autocomplete="new-password"></label>' +
      '<label class="f">New password again<input name="n2" type="password" required minlength="6" autocomplete="new-password"></label>' +
      '<button class="btn primary block">Save password</button>' + (forced ? '<p style="text-align:center;margin:12px 0 0"><button type="button" class="link" id="cpOut">Sign out</button></p>' : '') + '</form></div>';
    var out = $('#cpOut'); if (out) out.onclick = function () { api('logout').finally(function () { localStorage.removeItem(SKEY); localStorage.removeItem('pht-mustchange'); location.hash = '#/'; }); };
    if (!forced) bindLogout();
    $('#cp').onsubmit = function (e) {
      e.preventDefault(); var f = e.target;
      if (f.n1.value !== f.n2.value) return toast('The new passwords don\'t match', true);
      busy(f.querySelector('.primary'), api('changePassword', { current: f.cur.value, newPassword: f.n1.value })).then(function () {
        localStorage.removeItem('pht-mustchange'); toast('Password saved'); location.hash = '#/admin';
      });
    };
  }

  function viewAdminHome() {
    Promise.all([api('listTournaments'), api('listTemplates')]).then(function (r) {
      var list = r[0].tournaments, tps = r[1].templates;
      app.innerHTML = adminNav('') +
        '<div class="row between"><h1 style="margin:0">Tournaments</h1><div class="row"><select id="tplPick" style="width:auto"><option value="">New from template…</option>' + tps.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join('') + '</select>' +
        '<a class="btn primary" href="#/admin/new">+ New tournament</a></div></div><div style="height:12px"></div>' +
        (list.length ? '<div class="card flush"><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Name</th><th>Format</th><th class="num">Players</th><th>Status</th><th></th></tr></thead><tbody>' +
          list.map(function (t) {
            return '<tr><td>' + esc(t.date) + '</td><td><a href="#/admin/t/' + t.id + '"><b>' + esc(t.name) + '</b></a></td><td><small>' + t.config.gameType + '-ball · ' + formatName(t.config) + '</small></td><td class="num">' + t.players + '</td>' +
              '<td><span class="pill ' + (t.status === 'complete' ? 'done' : (t.status === 'registration' || t.status === 'drawn') ? '' : 'live') + '">' + esc(t.statusLabel) + '</span></td><td><a class="btn sm" href="#/admin/t/' + t.id + '">Run</a> <a class="btn sm ghost" href="#/t/' + t.id + '" target="_blank">Public</a></td></tr>';
          }).join('') + '</tbody></table></div></div>' : '<div class="card empty">No tournaments yet. Start by adding players, then create your first tournament.</div>');
      $('#tplPick').onchange = function () { if (this.value) location.hash = '#/admin/new/' + this.value; };
      bindLogout();
    }).catch(fail);
  }

  /* ---------------- tournament form ---------------- */
  function viewTournamentForm(id, tplId) {
    var loads = [api('listTemplates')];
    if (id) loads.push(api('getTournament', { id: id }));
    Promise.all(loads).then(function (r) {
      var tps = r[0].templates, T = r[1], tpl = tplId ? tps.filter(function (x) { return x.id === tplId; })[0] : null;
      var c = E.defaults(T ? T.t.config : tpl ? tpl.config : {});
      var started = T && T.t.status !== 'registration';
      var nextSat = (function () { var d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7)); return d.toISOString().slice(0, 10); })();
      var sel = function (name, opts, val) { return '<select name="' + name + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; };
      var num = function (name, val, extra) { return '<input name="' + name + '" type="number" inputmode="numeric" value="' + esc(val) + '" ' + (extra || '') + '>'; };
      app.innerHTML = adminNav('') + '<h1>' + (T ? 'Edit tournament' : 'New tournament') + '</h1>' +
        (started ? '<p class="hint">Play has started: format and game can\'t change. Race changes apply to matches that haven\'t started yet.</p>' : '') +
        '<form id="tf" class="card">' +
        (!T ? '<label class="f">Start from template' + '<select id="tpl"><option value="">— none —</option>' + tps.map(function (x) { return '<option value="' + x.id + '"' + (tpl && tpl.id === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></label>' : '') +
        '<fieldset><legend>Event</legend><div class="fgrid"><label class="f" style="grid-column:span 2">Name<input name="name" required value="' + esc(T ? T.t.name : (tpl ? tpl.name : '')) + '" placeholder="Saturday 8-Ball Crazy 8"></label>' +
        '<label class="f">Date<input name="date" type="date" value="' + esc(T ? T.t.date : nextSat) + '"></label>' +
        '<label class="f">Game' + sel('gameType', [['8', '8 ball'], ['9', '9 ball']], c.gameType) + '</label>' +
        '<label class="f">Format' + sel('format', [['RR', 'Round robin → knockout'], ['SE', 'Single knockout'], ['DE', 'Double knockout']], c.format) + '</label>' +
        '<label class="f" data-show="rr">Finals bracket' + sel('finals', [['DE', 'Double knockout'], ['SE', 'Single knockout']], c.finals) + '</label>' +
        '<label class="f" data-show="ko">Seeding' + sel('seeding', [['random', 'Random draw'], ['ranking', 'By ranking points'], ['manual', 'Manual (I\'ll set seeds)']], c.seeding) + '</label></div>' +
        '<label class="f">Notes shown to players<textarea name="notes" rows="2">' + esc(c.notes) + '</textarea></label></fieldset>' +
        '<fieldset><legend>Players or teams</legend><div class="fgrid">' +
        '<label class="f">Entry type' + sel('teamMode', [['singles', 'Singles'], ['doubles', 'Doubles (scotch)'], ['teams', 'Teams (set of singles)']], c.teamMode) + '</label>' +
        '<label class="f" data-show="teams">Team format' + sel('teamFmt', [['3-3', '3v3'], ['4-4', '4v4'], ['5-4', '5v4 (5 players, 4 rounds)'], ['5-5', '5v5']], c.playersPerSide + '-' + c.teamRounds) + '</label>' +
        '<label class="f" data-show="teams">Min players on a roster' + num('teamSize', c.teamSize, 'min="2"') + '</label>' +
        '<label class="f" data-show="teams">Team match won by' + sel('teamWin', [['wins', 'Race to X game wins'], ['points', 'Match card (points: rounds + overall)']], c.teamWin) + '</label>' +
        '<label class="f" data-show="teamsrr">RR team race (wins)' + num('raceRR', c.raceRR, 'min="1"') + '</label>' +
        '<label class="f" data-show="team">Entry fee is per' + sel('feePer', [['team', 'Team / pair'], ['player', 'Player']], c.feePer) + '</label>' +
        '<label class="f" data-show="team">Personal stats' + sel('teamStats', [['finishes', 'Count finishes & winnings only'], ['all', 'Count everything (matches, EROs)'], ['none', 'Don\'t count']], c.teamStats) + '</label></div>' +
        '<label class="chk" data-show="doubles"><input type="checkbox" name="jackJill" ' + (c.jackJill ? 'checked' : '') + '> Jack & Jill — every pair is one Jack and one Jill</label>' +
        '<p class="hint" data-show="teams">Every player plays every player on the other team once, one game each, in rounds. Home breaks rounds 1 & 3, away breaks 2 & 4. <b>Wins:</b> the races below are team game-wins (e.g. race to 11) and rounds repeat until a team gets there. <b>Match card:</b> win 10, loser = balls made; each round goes to the higher round total (points + handicap), +1 for the most total points overall, a tied total replays the last round. Team handicaps (per round) are set on the Players tab.</p></fieldset>' +
        '<fieldset data-show="rr"><legend>Round robin</legend><div class="fgrid"><label class="f" data-show="rrsingles">Games per match' + num('rrGames', c.rrGames, 'min="1" max="9"') + '</label>' +
        '<label class="f">Max entries per group' + num('groupSize', c.groupSize, 'min="3"') + '</label>' +
        '<label class="f">Groups (0 = auto)' + num('groups', c.groups, 'min="0"') + '</label>' +
        '<label class="f">Advance per group (0 = auto)' + num('advance', c.advance, 'min="0"') + '</label>' +
        '<label class="f">Wild cards (-1 = auto)' + num('wildcards', c.wildcards, 'min="-1"') + '</label></div>' +
        '<p class="hint" id="planHint"></p></fieldset>' +
        '<fieldset><legend>Knockout races</legend><div class="fgrid">' +
        '<label class="f" data-show="pts">Race type' + sel('raceType', [['wins', 'Games won (race to X)'], ['points', 'Points (first to X points)']], c.raceType) + '</label>' +
        '<label class="f">A-side race' + num('raceA', c.raceA, 'min="1"') + '</label>' +
        '<label class="f" data-show="de">B-side race' + num('raceB', c.raceB, 'min="1"') + '</label>' +
        '<label class="f" id="finalLbl">Final race' + num('raceFinal', c.raceFinal, 'min="1"') + '</label>' +
        '<label class="f" data-show="de">B-side final race (blank = same as B)' + num('raceBFinal', c.raceBFinal) + '</label></div>' +
        '<label class="chk" data-show="de"><input type="checkbox" name="gfReset" ' + (c.gfReset ? 'checked' : '') + '> Grand final reset — B-side champion must beat the A-side champion twice</label>' +
        '<p class="hint" id="raceHint"></p></fieldset>' +
        '<fieldset><legend>Tables & calling</legend><label class="f">Tables (a number, or names separated by commas)<input name="tables" value="' + esc(c.tables.join(', ')) + '"></label>' +
        '<label class="chk"><input type="checkbox" name="autoCall" ' + (c.autoCall ? 'checked' : '') + '> Automatically call the next match when a table frees up</label>' +
        '<label class="chk"><input type="checkbox" name="notifyOnCall" ' + (c.notifyOnCall ? 'checked' : '') + '> Message both players (email / text) when their match is called</label></fieldset>' +
        '<fieldset><legend>Money</legend><div class="fgrid"><label class="f">Entry fee ($)' + num('entryFee', c.entryFee, 'min="0" step="any"') + '</label>' +
        '<label class="f">Added money ($)' + num('addedMoney', c.addedMoney, 'min="0" step="any"') + '</label>' +
        '<label class="f">House / table fee (%)' + num('housePct', c.housePct, 'min="0" max="100" step="any"') + '</label>' +
        '<label class="f">Round payouts down to ($)' + num('roundTo', c.roundTo, 'min="1"') + '</label></div>' +
        '<label class="f">Payout % by place (1st, 2nd, 3rd…)<input name="payoutPct" value="' + esc(c.payoutPct.join(', ')) + '" placeholder="50, 30, 20"></label></fieldset>' +
        '<div class="row"><button class="btn primary">' + (T ? 'Save changes' : 'Create tournament') + '</button><label class="chk"><input type="checkbox" id="asTpl"> Also save as template</label><input id="tplName" placeholder="Template name" style="max-width:240px" hidden></div></form>';
      var f = $('#tf');
      if (started) ['gameType', 'format', 'finals', 'raceType', 'teamMode'].forEach(function (n) { f[n].disabled = true; });
      function readCfg() {
        var tables = f.tables.value.trim(), tl;
        if (/^\d+$/.test(tables)) { tl = []; for (var i = 1; i <= Number(tables); i++) tl.push(String(i)); } else tl = tables.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        return {
          gameType: f.gameType.value, format: f.format.value, finals: f.finals.value, seeding: f.seeding.value, notes: f.notes.value,
          teamMode: f.teamMode.value, teamSize: f.teamSize.value, playersPerSide: f.teamFmt.value.split('-')[0], teamRounds: f.teamFmt.value.split('-')[1], teamWin: f.teamWin.value, raceRR: f.raceRR.value, feePer: f.feePer.value, teamStats: f.teamStats.value, jackJill: f.jackJill.checked,
          rrGames: f.rrGames.value, groupSize: f.groupSize.value, groups: f.groups.value, advance: f.advance.value, wildcards: f.wildcards.value,
          raceType: f.raceType.value, raceA: f.raceA.value, raceB: f.raceB.value, raceFinal: f.raceFinal.value, raceBFinal: f.raceBFinal.value, gfReset: f.gfReset.checked,
          tables: tl, autoCall: f.autoCall.checked, notifyOnCall: f.notifyOnCall.checked,
          entryFee: f.entryFee.value || 0, addedMoney: f.addedMoney.value || 0, housePct: f.housePct.value || 0, roundTo: f.roundTo.value || 1, payoutPct: f.payoutPct.value
        };
      }
      function refresh() {
        var x = readCfg(), rr = x.format === 'RR', de = x.format === 'DE' || (rr && x.finals === 'DE');
        $$('[data-show]', f).forEach(function (el) {
          var k = el.getAttribute('data-show');
          el.style.display = (k === 'rr' ? rr : k === 'ko' ? !rr : k === 'de' ? de : k === 'pts' ? x.gameType === '8' :
            k === 'team' ? x.teamMode !== 'singles' : k === 'teams' ? x.teamMode === 'teams' : k === 'teamsrr' ? (x.teamMode === 'teams' && rr) : k === 'doubles' ? x.teamMode === 'doubles' :
            k === 'rrsingles' ? (rr && x.teamMode !== 'teams') : true) ? '' : 'none';
        });
        $('#finalLbl').firstChild.nodeValue = de ? 'Grand final race' : 'Final race';
        var unit = x.gameType === '8' && x.raceType === 'points' ? 'points' : 'games';
        $('#raceHint').textContent = x.gameType === '9' ? '9 ball is scored on games won only.' : (x.raceType === 'points' ? 'Points race: rack winner scores 10 (an ERO is also 10 here), loser scores the balls they made. First to the target wins.' : 'Race to the number of racks won. EROs are still tracked.');
        if (rr) {
          var dc = E.defaults(x), lines = [9, 18, 27, 36].map(function (n) { var p = E.rrPlan(dc, n); return n + ' players → ' + p.groups + ' group' + (p.groups > 1 ? 's' : '') + ', top ' + p.advance + ' + ' + p.wildcards + ' WC = ' + p.bracketPlayers + (p.byes ? ' (' + p.byes + ' byes)' : ''); });
          $('#planHint').textContent = 'With these settings: ' + lines.join(' · ');
        }
      }
      f.oninput = refresh; f.onchange = refresh; refresh();
      var tsel = $('#tpl'); if (tsel) tsel.onchange = function () { location.hash = '#/admin/new' + (tsel.value ? '/' + tsel.value : ''); };
      $('#asTpl').onchange = function () { $('#tplName').hidden = !this.checked; if (this.checked && !$('#tplName').value) $('#tplName').value = f.name.value; };
      f.onsubmit = function (e) {
        e.preventDefault();
        var cfg = readCfg(), btn = f.querySelector('button.primary');
        var p = api('saveTournament', { id: id || '', name: f.name.value, date: f.date.value, config: cfg });
        if ($('#asTpl').checked) p = p.then(function (r) { return api('saveTemplate', { name: $('#tplName').value || f.name.value, config: cfg }).then(function () { return r; }); });
        busy(btn, p).then(function (r) { toast('Saved'); location.hash = '#/admin/t/' + r.id; });
      };
      bindLogout();
    }).catch(fail);
  }

  /* =====================================================================
     DIRECTOR: run a tournament
     ===================================================================== */
  function viewControl(id, tab) {
    var D = null, players = null;
    function load(silent) {
      var ps = players ? Promise.resolve({ players: players }) : api('listPlayers');
      return Promise.all([api('getTournament', { id: id }), ps]).then(function (r) { players = r[1].players; D = derive(r[0]); draw(); })
        .catch(function (e) { if (!silent) fail(e); });
    }
    function act(btn, action, args, msg) { return busy(btn, api(action, args)).then(function (r) { if (msg) toast(typeof msg === 'function' ? msg(r) : msg); return load().then(function () { return r; }); }); }

    function draw() {
      var t = D.T.t, cfg = D.cfg, st = t.status;
      var tabs = [['players', 'Players (' + D.T.entries.length + ')'], D.T.matches.length && st !== 'complete' ? ['plan', 'Plan & times'] : null, ['tables', 'Tables'], cfg.format === 'RR' ? ['standings', 'Standings'] : null, ['bracket', 'Bracket'], ['matches', 'Matches'], ['money', 'Money']].filter(Boolean);
      var openRR = D.rr.filter(function (m) { return m.status !== 'done'; }).length;
      var steps = [];
      if (cfg.format === 'RR') {
        steps.push([D.T.entries.length >= 3, 'Add players & mark paid', '']);
        steps.push([D.T.entries.some(function (e) { return e.grp; }), 'Draw groups', st === 'registration' ? '<button class="btn sm" data-a="draw">' + (D.T.entries.some(function (e) { return e.grp; }) ? 'Redraw' : 'Draw groups') + '</button>' : '']);
        steps.push([st !== 'registration', 'Create the match schedule', st === 'registration' ? '<button class="btn sm primary" data-a="startRR">Create schedule</button>' : st === 'drawn' ? '<button class="btn sm ghost" data-a="undoDraw">Undo</button>' : '']);
        steps.push([st !== 'registration' && st !== 'drawn', 'Plan tables & times (optional), then start play', st === 'drawn' ? '<a class="btn sm" href="#/admin/t/' + id + '/plan">Plan</a><button class="btn sm primary" data-a="startPlay">Start play</button>' : '']);
        steps.push([st === 'finals' || st === 'complete', 'Generate finals' + (st === 'roundrobin' ? ' (' + openRR + ' RR matches left)' : ''), st === 'roundrobin' ? '<button class="btn sm ' + (openRR ? '' : 'primary') + '" data-a="finals">Generate finals</button>' : st === 'finals' ? '<button class="btn sm ghost" data-a="undoFinals">Undo</button>' : '']);
      } else {
        steps.push([D.T.entries.length >= 2, 'Add players & mark paid', '']);
        steps.push([st !== 'registration', 'Draw the bracket (' + ({ random: 'random draw', ranking: 'by ranking', manual: 'manual seeds' })[cfg.seeding] + ')', st === 'registration' ? '<button class="btn sm primary" data-a="startBracket">Draw bracket</button>' : st === 'drawn' ? '<button class="btn sm ghost" data-a="undoDraw">Undo</button>' : '']);
        steps.push([st !== 'registration' && st !== 'drawn', 'Plan tables & times (optional), then start play', st === 'drawn' ? '<a class="btn sm" href="#/admin/t/' + id + '/plan">Plan</a><button class="btn sm primary" data-a="startPlay">Start play</button>' : '']);
      }
      steps.push([st === 'complete', 'Finish & pay out', st === 'complete' ? '<button class="btn sm ghost" data-a="reopen">Reopen</button>' : (st === 'finals' || st === 'bracket') ? '<button class="btn sm ' + (t.champion ? 'primary' : '') + '" data-a="finalize">Finish tournament</button>' : '']);
      app.innerHTML = adminNav('') +
        '<div class="row between"><div><h1 style="margin:0">' + esc(t.name) + '</h1><div class="kv"><span>' + esc(fmtDate(t.date)) + '</span><span><b>' + cfg.gameType + '-ball</b></span><span>' + formatName(cfg) + '</span>' + raceSummary(cfg) + '</div></div>' +
        '<div class="row"><a class="btn sm" href="#/admin/edit/' + id + '">Settings</a><a class="btn sm" target="_blank" href="#/t/' + id + '">Public page ↗</a><button class="btn sm ghost" data-a="qr">QR code</button></div></div>' +
        '<div class="card" style="margin-top:12px">' + steps.map(function (s, i) { return '<div class="step ' + (s[0] ? 'done' : '') + '"><span class="n">' + (s[0] ? '✓' : i + 1) + '</span><div class="grow">' + s[1] + '</div>' + s[2] + '</div>'; }).join('') +
        (t.champion ? '<div class="banner"><small>CHAMPION</small><br><b>🏆 ' + esc(D.names[t.champion]) + '</b></div>' : '') + '</div>' +
        '<div class="tabs">' + tabs.map(function (x) { return '<a href="#/admin/t/' + id + '/' + x[0] + '" class="' + (x[0] === tab ? 'on' : '') + '">' + x[1] + '</a>'; }).join('') + '</div><div id="cbody"></div>';
      var body = $('#cbody');
      if (tab === 'players') body.innerHTML = entriesTab();
      else if (tab === 'tables') body.innerHTML = tablesTab();
      else if (tab === 'standings') body.innerHTML = groupsView(D, true) + '<button class="btn" data-a="saveTb">Save playoff order</button>';
      else if (tab === 'bracket') body.innerHTML = bracketView(D, true);
      else if (tab === 'matches') body.innerHTML = matchesTab();
      else if (tab === 'money') body.innerHTML = moneyTab();
      else if (tab === 'plan') body.innerHTML = planTab();
      bindControl();
    }

    function entriesTab() {
      var t = D.T.t, reg = t.status === 'registration', pmap = {};
      players.forEach(function (p) { pmap[p.id] = p; });
      var entered = {}; D.T.entries.forEach(function (e) { entered[e.pid] = 1; });
      var teamMode = D.cfg.teamMode !== 'singles';
      if (teamMode) return teamEntriesTab(reg);
      var list = D.T.entries.slice().sort(function (a, b) { return (a.grp || '').localeCompare(b.grp || '') || (Number(a.seed) || 999) - (Number(b.seed) || 999) || a.name.localeCompare(b.name); });
      var paid = D.T.entries.filter(function (e) { return e.paid; }).length;
      var html = '';
      if (reg) html += '<div class="card"><h3>Add players</h3><div class="row" style="align-items:flex-start"><div class="search grow"><input id="psearch" placeholder="Search the player database by name or phone…" autocomplete="off"><div class="sugg" id="psugg" hidden></div></div>' +
        '<button class="btn" data-a="quickAdd">+ New player</button></div><p class="hint" style="margin:8px 0 0">Tap a name to enter them. New players are saved to the database too.</p></div>';
      html += '<div class="card flush"><div class="row between" style="padding:12px 14px"><h3 style="margin:0">' + list.length + ' entered · ' + paid + ' paid</h3>' +
        '<div class="row"><button class="btn sm" data-a="links">Send everyone their player link</button>' + (reg ? '<button class="btn sm ghost" data-a="allPaid">Mark all paid</button>' : '') + '</div></div><div class="tbl-wrap"><table><thead><tr><th>Player</th><th>Contact</th>' +
        (D.cfg.format === 'RR' ? '<th>Group</th>' : '') + '<th>Seed</th><th>Paid</th><th class="num">Amount</th><th>Link</th>' + (reg ? '<th></th>' : '') + '</tr></thead><tbody>' +
        list.map(function (e) {
          var link = location.origin + location.pathname + '#/p/' + e.key;
          var msg = (D.T.t.name + ' — your player page (matches & scoring): ' + link);
          return '<tr><td><b>' + esc(e.name) + '</b>' + (e.wildcard ? ' <span class="pill wc">WC</span>' : '') + '</td><td><small>' + esc(e.phone || '') + (e.phone && e.email ? '<br>' : '') + esc(e.email || '') + '</small></td>' +
            (D.cfg.format === 'RR' ? '<td>' + esc(e.grp) + '</td>' : '') +
            '<td>' + (reg && D.cfg.format !== 'RR' && D.cfg.seeding === 'manual' ? '<input data-seed="' + e.id + '" value="' + esc(e.seed) + '" style="width:56px;padding:4px" inputmode="numeric">' : esc(e.seed)) + '</td>' +
            '<td><input type="checkbox" data-paid="' + e.id + '" ' + (e.paid ? 'checked' : '') + '></td><td class="num"><input data-amt="' + e.id + '" value="' + esc(e.amount) + '" placeholder="' + esc(D.cfg.entryFee || '') + '" style="width:70px;padding:4px;text-align:right" inputmode="decimal"></td>' +
            '<td class="row" style="gap:4px;flex-wrap:nowrap">' + (e.phone ? '<a class="btn sm" href="' + smsHref(e.phone, msg) + '">Text</a>' : '') + '<button class="btn sm ghost" data-copy="' + esc(link) + '">Copy</button></td>' +
            (reg ? '<td><button class="btn sm danger" data-rm="' + e.id + '">✕</button></td>' : '') + '</tr>';
        }).join('') + '</tbody></table></div></div>';
      if (reg && D.cfg.format !== 'RR' && D.cfg.seeding === 'manual') html += '<button class="btn" data-a="saveSeeds">Save seeds</button>';
      return html;
    }

    function teamEntriesTab(reg) {
      var cfg = D.cfg, jj = cfg.jackJill, word = cfg.teamMode === 'doubles' ? 'pair' : 'team';
      var need = cfg.teamMode === 'doubles' ? 2 : cfg.teamSize;
      var teams = D.T.entries.filter(function (e) { return e.size > 1; }).sort(function (a, b) { return (a.grp || '').localeCompare(b.grp || '') || (Number(a.seed) || 999) - (Number(b.seed) || 999) || a.name.localeCompare(b.name); });
      var pool = D.T.entries.filter(function (e) { return e.size === 1; }).sort(function (a, b) { return (a.role || '').localeCompare(b.role || '') || a.name.localeCompare(b.name); });
      var html = '';
      if (reg) html += '<div class="card"><h3>Add players</h3><div class="row" style="align-items:flex-start"><div class="search grow"><input id="psearch" placeholder="Search the player database by name or phone…" autocomplete="off"><div class="sugg" id="psugg" hidden></div></div>' +
        '<button class="btn" data-a="quickAdd">+ New player</button></div><p class="hint" style="margin:8px 0 0">' + (jj ? 'Add each player as a <b>Jack</b> or a <b>Jill</b>, then pair them by hand or draw random pairs.' : 'Add players, then tick them and press “Make ' + word + '”, or draw random ' + word + 's.') + '</p></div>';
      // unpaired pool
      if (reg || pool.length) {
        var jacks = pool.filter(function (e) { return e.role === 'Jack'; }).length, jills = pool.filter(function (e) { return e.role === 'Jill'; }).length;
        html += '<div class="card flush"><div class="row between" style="padding:12px 14px"><h3 style="margin:0">Not yet in a ' + word + ' (' + pool.length + ')' + (jj ? ' · ' + jacks + ' Jacks · ' + jills + ' Jills' : '') + '</h3>' +
          (reg ? '<div class="row"><input id="tname" placeholder="' + (word === 'team' ? 'Team name' : 'Pair name (optional)') + '" style="width:180px;padding:6px"><button class="btn sm primary" data-a="makeTeam">Make ' + word + ' from ticked</button><button class="btn sm" data-a="drawTeams">🎲 Draw random ' + word + 's</button></div>' : '') + '</div>' +
          (pool.length ? '<div class="tbl-wrap"><table><thead><tr>' + (reg ? '<th></th>' : '') + '<th>Player</th>' + (jj ? '<th>Role</th>' : '') + '<th>Contact</th><th>Paid</th>' + (reg ? '<th></th>' : '') + '</tr></thead><tbody>' +
            pool.map(function (e) {
              return '<tr>' + (reg ? '<td><input type="checkbox" data-pick-e="' + e.id + '"></td>' : '') + '<td><b>' + esc(e.name) + '</b></td>' + (jj ? '<td><span class="pill ' + (e.role === 'Jill' ? 'wc' : 'gold') + '">' + esc(e.role) + '</span></td>' : '') +
                '<td><small>' + esc(e.phone || e.email || '') + '</small></td><td><input type="checkbox" data-paid="' + e.id + '" ' + (e.paid ? 'checked' : '') + '></td>' + (reg ? '<td><button class="btn sm danger" data-rm="' + e.id + '">✕</button></td>' : '') + '</tr>';
            }).join('') + '</tbody></table></div>' : '<div class="empty">Everyone is in a ' + word + '.</div>') + '</div>';
      }
      // teams
      html += '<div class="card flush"><div class="row between" style="padding:12px 14px"><h3 style="margin:0">' + teams.length + ' ' + word + (teams.length === 1 ? '' : 's') + ' · ' + teams.filter(function (e) { return e.paid; }).length + ' paid</h3>' +
        '<button class="btn sm" data-a="links">Send everyone their link</button></div>' +
        (teams.length ? '<div class="tbl-wrap"><table><thead><tr><th>' + (word === 'team' ? 'Team' : 'Pair') + '</th><th>Players</th>' + (cfg.format === 'RR' ? '<th>Group</th>' : '') + '<th>Seed</th>' + (cfg.teamMode === 'teams' ? '<th>Hcp</th>' : '') + '<th>Paid</th><th class="num">Amount</th><th>Link</th>' + (reg ? '<th></th>' : '') + '</tr></thead><tbody>' +
          teams.map(function (e) {
            var link = location.origin + location.pathname + '#/p/' + e.key, msg = D.T.t.name + ' — your ' + word + ' page (matches & scoring): ' + link;
            var short = e.size < need ? ' <span class="pill">needs ' + (need - e.size) + ' more</span>' : '';
            return '<tr><td>' + (reg ? '<input data-team="' + e.id + '" value="' + esc(e.team) + '" placeholder="' + esc(e.members.map(function (x) { return x.name.split(' ')[0]; }).join(' & ')) + '" style="min-width:140px;padding:5px">' : '<b>' + esc(e.name) + '</b>') + short + '</td>' +
              '<td><small>' + e.members.map(function (x) { return esc(x.name) + (x.role ? ' <span class="dim">(' + esc(x.role) + ')</span>' : ''); }).join('<br>') + '</small></td>' +
              (cfg.format === 'RR' ? '<td>' + esc(e.grp) + '</td>' : '') +
              '<td>' + (reg && cfg.format !== 'RR' && cfg.seeding === 'manual' ? '<input data-seed="' + e.id + '" value="' + esc(e.seed) + '" style="width:56px;padding:4px" inputmode="numeric">' : esc(e.seed)) + '</td>' +
              (cfg.teamMode === 'teams' ? '<td><input data-hcp="' + e.id + '" value="' + esc(e.hcp || '') + '" placeholder="0" title="Starting wins/points" style="width:52px;padding:4px" inputmode="numeric"></td>' : '') +
              '<td><input type="checkbox" data-paid="' + e.id + '" ' + (e.paid ? 'checked' : '') + '></td><td class="num"><input data-amt="' + e.id + '" value="' + esc(e.amount) + '" placeholder="' + esc((D.cfg.entryFee || 0) * (D.cfg.feePer === 'player' ? e.size : 1) || '') + '" style="width:70px;padding:4px;text-align:right" inputmode="decimal"></td>' +
              '<td class="row" style="gap:4px;flex-wrap:nowrap">' + e.members.filter(function (x) { return x.phone; }).map(function (x) { return '<a class="btn sm" href="' + smsHref(x.phone, msg) + '">Text ' + esc(x.name.split(' ')[0]) + '</a>'; }).join('') + '<button class="btn sm ghost" data-copy="' + esc(link) + '">Copy</button></td>' +
              (reg ? '<td><button class="btn sm ghost" data-split="' + e.id + '">Split</button></td>' : '') + '</tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty">No ' + word + 's yet.</div>') + '</div>';
      if (reg && cfg.format !== 'RR' && cfg.seeding === 'manual') html += '<button class="btn" data-a="saveSeeds">Save seeds</button>';
      return html;
    }

    function planTab() {
      var cfg = D.cfg, ms = D.T.matches.filter(function (m) { return ['done', 'bye', 'void', 'live'].indexOf(m.status) < 0 && m.p1 !== 'BYE' && m.p2 !== 'BYE' && m.src1 !== 'BYE' && m.src2 !== 'BYE'; });
      if (!ms.length) return '<div class="card empty">Nothing left to plan.</div>';
      var html = '';
      if (D.T.t.status === 'drawn') html += '<div class="card row between"><div><b>Not started yet.</b> <span class="muted">Book matches onto tables and set times, then start. Nobody is messaged until you press Start play.</span></div><button class="btn primary" data-a="startPlay">▶ Start play</button></div>';
      // table queues
      html += '<div class="section-title"><h3 style="margin:0">Table queues</h3></div><div class="tables">' + cfg.tables.map(function (tb) {
        var q = ms.filter(function (m) { return String(m.plan) === String(tb); }).sort(function (a, b) { return (Number(a.planOrder) || 999) - (Number(b.planOrder) || 999) || a.seq - b.seq; });
        var liveM = D.T.matches.filter(function (m) { return m.status === 'live' && m.table === tb; })[0];
        return '<div class="tbl' + (q.length ? ' busy' : '') + '"><div class="no">Table ' + esc(tb) + '</div>' + (liveM ? '<div class="muted" style="font-size:12px">Now: ' + esc(D.nm(liveM.p1)) + ' vs ' + esc(D.nm(liveM.p2)) + '</div>' : '') +
          (q.length ? '<ol style="margin:6px 0 0;padding-left:18px;font-size:13px">' + q.map(function (m) { return '<li>' + (m.time ? '<b style="color:var(--yellow)">' + fmtTime(m.time) + '</b> ' : '') + esc(m.stage === 'RR' ? 'G' + m.grp + ' ' : 'M' + D.num[m.id] + ' ') + esc(D.nm(m.p1, m.src1)) + ' vs ' + esc(D.nm(m.p2, m.src2)) + '</li>'; }).join('') + '</ol>' : '<div class="dim" style="padding:6px 0">Nothing planned' + (cfg.autoCall ? ' — auto-call will use it' : '') + '</div>') + '</div>';
      }).join('') + '</div>';
      // rounds
      var groups = {}, order = [];
      ms.forEach(function (m) { var k = m.stage + '|' + m.round; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(m); });
      order.sort(function (a, b) { return groups[a][0].seq - groups[b][0].seq; });
      html += '<p class="hint" style="margin-top:12px">Pick a table to book a match onto it (it joins the back of that table\'s queue — change the # to reorder). Times are shown to players in the bracket and on their page. When a table frees up, its next booked match goes on first; unbooked matches fill any table.</p>';
      order.forEach(function (k) {
        var list = groups[k].sort(function (a, b) { return a.seq - b.seq; }), m0 = list[0];
        var title = m0.stage === 'RR' ? 'Round robin · Round ' + m0.round : m0.label;
        html += '<div class="card flush" style="margin-top:10px"><div class="row between" style="padding:10px 14px"><h3 style="margin:0">' + esc(title) + '</h3>' +
          '<div class="row" style="gap:6px"><small class="muted">Time for whole round</small><input type="time" data-rtime="' + m0.stage + '|' + m0.round + '" style="width:auto;padding:5px"><button class="btn sm" data-rset="' + m0.stage + '|' + m0.round + '">Set</button></div></div>' +
          '<div class="tbl-wrap"><table><thead><tr><th>Match</th><th>Players</th><th>Time</th><th>Table</th><th>#</th></tr></thead><tbody>' +
          list.map(function (m) {
            return '<tr><td><small>' + esc(m.stage === 'RR' ? 'Grp ' + m.grp : 'M' + D.num[m.id]) + '</small></td><td>' + esc(D.nm(m.p1, m.src1)) + ' <span class="dim">vs</span> ' + esc(D.nm(m.p2, m.src2)) + '</td>' +
              '<td><input type="time" data-ptime="' + m.id + '" value="' + esc(m.time || '') + '" style="width:auto;padding:4px"></td>' +
              '<td><select data-pplan="' + m.id + '" style="width:auto;padding:4px"><option value="">—</option>' + cfg.tables.map(function (tb) { return '<option value="' + esc(tb) + '"' + (String(m.plan) === String(tb) ? ' selected' : '') + '>' + esc(tb) + '</option>'; }).join('') + '</select></td>' +
              '<td>' + (m.plan ? '<input data-porder="' + m.id + '" value="' + esc(m.planOrder) + '" style="width:48px;padding:4px" inputmode="numeric">' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div></div>';
      });
      return html;
    }

    function tablesTab() {
      var t = D.T.t, cfg = D.cfg;
      if (t.status === 'registration') return '<div class="card empty">Tables come alive once play starts.</div>';
      if (t.status === 'drawn') return '<div class="card empty">Play hasn\'t started. Use the <a href="#/admin/t/' + id + '/plan">Plan & times</a> tab to book matches onto tables, then press <b>Start play</b>.</div>';
      var live = D.T.matches.filter(function (m) { return m.status === 'live'; });
      var ready = D.T.matches.filter(function (m) { return m.status === 'ready'; }).sort(function (a, b) { return a.seq - b.seq; });
      var busyP = {}; live.forEach(function (m) { busyP[m.p1] = 1; busyP[m.p2] = 1; });
      var free = cfg.tables.filter(function (tb) { return !live.some(function (m) { return m.table === tb; }); });
      var html = '<div class="row between" style="margin-bottom:10px"><div class="muted">' + live.length + ' playing · ' + ready.length + ' ready · ' + free.length + ' free table' + (free.length === 1 ? '' : 's') + (cfg.autoCall ? ' · <b>auto-call on</b>' : '') + '</div>' +
        '<button class="btn primary sm" data-a="fill"' + (free.length && ready.length ? '' : ' disabled') + '>Fill free tables</button></div><div class="tables">';
      cfg.tables.forEach(function (tb) {
        var m = live.filter(function (x) { return x.table === tb; })[0];
        if (m) html += tableCard(D, m, '<div class="row" style="margin-top:8px;gap:6px"><a class="btn sm" href="#/s/' + m.id + '/d">Score</a><button class="btn sm ghost" data-msg="' + m.id + '">Text players</button><button class="btn sm ghost" data-off="' + m.id + '">Off table</button></div>' +
          (free.length ? '<div class="row" style="margin-top:6px;gap:6px"><select data-msel="' + m.id + '" style="width:auto;padding:4px"><option value="">Move to…</option>' + free.map(function (tb) { return '<option value="' + esc(tb) + '">Table ' + esc(tb) + '</option>'; }).join('') + '</select></div>' : ''));
        else html += '<div class="tbl"><div class="no">Table ' + esc(tb) + '</div><div class="dim" style="padding:8px 0">Open</div>' + (ready.length ? '<button class="btn sm" data-callnext="' + esc(tb) + '">Call next match</button>' : '') + '</div>';
      });
      live.filter(function (m) { return !m.table || cfg.tables.indexOf(m.table) < 0; }).forEach(function (m) {
        html += tableCard(D, m, '<div class="row" style="margin-top:8px;gap:6px"><a class="btn sm" href="#/s/' + m.id + '/d">Score</a><button class="btn sm ghost" data-off="' + m.id + '">Off table</button></div>');
      });
      html += '</div><div class="section-title"><h3 style="margin:0">Ready to call</h3></div>';
      if (!ready.length) html += '<div class="empty">Nothing waiting.</div>';
      ready.sort(function (a, b) { return ((busyP[a.p1] || busyP[a.p2]) ? 1 : 0) - ((busyP[b.p1] || busyP[b.p2]) ? 1 : 0) || a.seq - b.seq; });
      if (ready.length) html += '<div class="card flush"><div class="tbl-wrap"><table><thead><tr><th>Match</th><th>Players</th><th>Race</th><th></th></tr></thead><tbody>' + ready.slice(0, 40).map(function (m) {
        var blocked = busyP[m.p1] || busyP[m.p2];
        return '<tr><td><small>' + esc(m.stage === 'RR' ? 'Grp ' + m.grp + ' R' + m.round : 'M' + D.num[m.id] + ' ' + m.label) + '</small></td><td>' + esc(D.nm(m.p1)) + ' <span class="dim">vs</span> ' + esc(D.nm(m.p2)) + (blocked ? ' <span class="pill">player busy</span>' : '') + '</td>' +
          '<td><small>' + esc(raceLabel(cfg, m)) + '</small></td><td class="row" style="gap:4px;flex-wrap:nowrap"><select data-tsel="' + m.id + '" style="width:auto;padding:4px">' + free.map(function (tb) { return '<option>' + esc(tb) + '</option>'; }).join('') + '</select><button class="btn sm primary" data-call="' + m.id + '"' + (free.length ? '' : ' disabled') + '>Call</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
      return html;
    }

    function matchesTab() {
      var ms = D.T.matches.filter(function (m) { return m.status !== 'void'; });
      if (!ms.length) return '<div class="card empty">No matches yet.</div>';
      return '<input id="mfind" placeholder="Filter by player…" style="max-width:300px;margin-bottom:10px"><div id="mlist">' + matchList(D, ms, true) + '</div>' +
        '<p class="hint">Use the Table box to put a ready match on a table (or move a live one). Use Score to correct any result. To change a race or reset a match, open it and use the director tools at the bottom.</p>';
    }

    function moneyTab() {
      var cfg = D.cfg, es = D.T.entries;
      var pv = E.payouts(cfg, es.map(function (e) { return { id: e.id, paid: e.paid, amount: e.amount, place: e.place, payoutOverride: e.payoutOverride, size: e.size }; }));
      var ranked = es.slice().sort(function (a, b) { return (Number(a.place) || 999) - (Number(b.place) || 999) || a.name.localeCompare(b.name); });
      return '<div class="grid g3" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">' +
        [[pv.paidCount + ' / ' + pv.players, 'Paid'], [money(pv.collected), 'Collected'], [money(pv.house), 'House (' + (cfg.housePct || 0) + '%)'], [money(pv.added), 'Added'], [money(pv.fund), 'Prize fund'], [money(pv.allocated), 'Allocated']]
          .map(function (x) { return '<div class="stat"><b>' + x[0] + '</b><span>' + x[1] + '</span></div>'; }).join('') + '</div>' +
        '<p class="hint" style="margin-top:10px">Payout split: ' + esc(cfg.payoutPct.join(' / ')) + '% · tied places share the combined amount · rounded down to $' + cfg.roundTo + '. Places are calculated when you press Calculate or finish.</p>' +
        '<div class="row" style="margin-bottom:10px"><button class="btn" data-a="preview">Calculate places & payouts now</button></div>' +
        '<div class="card flush"><div class="tbl-wrap"><table><thead><tr><th>Place</th><th>Player</th><th class="num">Payout</th><th class="num">Override $</th><th>Paid out</th></tr></thead><tbody>' +
        ranked.map(function (e) {
          return '<tr><td>' + esc(e.place ? ordinal(e.place) : '') + '</td><td>' + esc(e.name) + '</td><td class="num"><b>' + (pv.payouts[e.id] ? money(pv.payouts[e.id]) : '') + '</b></td>' +
            '<td class="num"><input data-ovr="' + e.id + '" value="' + esc(e.payoutOverride) + '" style="width:80px;padding:4px;text-align:right" inputmode="decimal"></td><td><input type="checkbox" data-po="' + e.id + '" ' + (e.paidOut ? 'checked' : '') + '></td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }

    function bindControl() {
      var t = D.T.t;
      bindLogout();
      $$('[data-a]').forEach(function (b) {
        var a = b.getAttribute('data-a');
        b.onclick = function () {
          if (a === 'draw') act(b, 'drawGroups', { tid: id }, function (r) { return 'Drawn: ' + r.plan.groups + ' group(s), top ' + r.plan.advance + ' + ' + r.plan.wildcards + ' wild cards'; });
          else if (a === 'startRR') { if (confirm('Create the round robin schedule? Players and groups lock in. Nobody is called until you press Start play.')) act(b, 'startRoundRobin', { tid: id }, function (r) { return r.matches + ' matches created — now plan tables & times'; }).then(function () { location.hash = '#/admin/t/' + id + '/plan'; }); }
          else if (a === 'startBracket') { if (confirm('Draw the bracket? Players lock in. Nobody is called until you press Start play.')) act(b, 'startBracket', { tid: id }, 'Bracket drawn — now plan tables & times').then(function () { location.hash = '#/admin/t/' + id + '/plan'; }); }
          else if (a === 'startPlay') { if (confirm('Start play? Planned matches go on their tables and those players get their message.')) act(b, 'startPlay', { tid: id }, function (r) { return 'Play started — ' + r.called + ' match' + (r.called === 1 ? '' : 'es') + ' called'; }).then(function () { location.hash = '#/admin/t/' + id + '/tables'; }); }
          else if (a === 'undoDraw') { if (confirm('Undo the draw? All matches, planned tables and times are removed.')) act(b, 'undoDraw', { tid: id }, 'Draw removed').then(function () { location.hash = '#/admin/t/' + id + '/players'; }); }
          else if (a === 'finals') {
            var open = D.rr.filter(function (m) { return m.status !== 'done'; }).length;
            if (open && !confirm(open + ' round robin matches aren\'t finished. Generate finals anyway? Unfinished matches will be closed.')) return;
            if (!open && !confirm('Generate the finals bracket? Wild cards will be drawn at random.')) return;
            act(b, 'generateFinals', { tid: id, force: !!open }, function (r) { return r.qualifiers + ' qualifiers + ' + r.wildcards + ' wild cards drawn'; }).then(function () { location.hash = '#/admin/t/' + id + '/bracket'; });
          }
          else if (a === 'undoFinals') { if (confirm('Delete the finals bracket and go back to the round robin?')) act(b, 'undoFinals', { tid: id }, 'Finals removed'); }
          else if (a === 'finalize') {
            if (!confirm(t.champion ? 'Finish the tournament? Places & payouts are locked in and stats update.' : 'There\'s no champion yet. Finish anyway?')) return;
            act(b, 'finalize', { tid: id, force: !t.champion }, 'Tournament complete').then(function () { location.hash = '#/admin/t/' + id + '/money'; });
          }
          else if (a === 'reopen') { if (confirm('Reopen this tournament for corrections?')) act(b, 'reopen', { tid: id }, 'Reopened'); }
          else if (a === 'fill') act(b, 'fillTables', { tid: id }, function (r) { return r.called + ' match(es) called'; });
          else if (a === 'links') { if (confirm('Send every player their personal link by email' + (DEMO ? '' : ' / text (if set up)') + '?')) act(b, 'notifyLinks', { tid: id }, function (r) { return sentSummary(r.sent, r.count); }); }
          else if (a === 'allPaid') { Promise.all(D.T.entries.filter(function (e) { return !e.paid; }).map(function (e) { return api('updateEntry', { id: e.id, paid: true }); })).then(function () { toast('All marked paid'); load(); }); }
          else if (a === 'quickAdd') playerForm(null, function (p) { return api('quickAddPlayer', Object.assign({ tid: id }, p)).then(function () { players = null; toast(p.first + ' added'); return load(); }); }, D.cfg.jackJill);
          else if (a === 'makeTeam') { var ids = $$('[data-pick-e]').filter(function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-pick-e'); });
            act(b, 'makeTeam', { tid: id, ids: ids, name: ($('#tname') || {}).value || '' }, 'Made'); }
          else if (a === 'drawTeams') { if (confirm('Randomly group everyone who isn\'t in a ' + (D.cfg.teamMode === 'doubles' ? 'pair' : 'team') + ' yet?')) act(b, 'drawTeams', { tid: id }, function (r) { return r.made + ' made' + (r.leftover ? ', ' + r.leftover + ' left over' : ''); }); }
          else if (a === 'saveSeeds') { Promise.all($$('[data-seed]').map(function (i) { return api('updateEntry', { id: i.getAttribute('data-seed'), seed: i.value }); })).then(function () { toast('Seeds saved'); load(); }); }
          else if (a === 'saveTb') { Promise.all($$('[data-tb]').map(function (i) { return api('updateEntry', { id: i.getAttribute('data-tb'), tb: i.value }); })).then(function () { toast('Playoff order saved'); load(); }); }
          else if (a === 'preview') act(b, 'previewFinish', { tid: id }, 'Places & payouts calculated');
          else if (a === 'qr') showQR();
        };
      });
      // add player search
      var ps = $('#psearch'), sg = $('#psugg');
      if (ps) {
        var entered = {}; D.T.entries.forEach(function (e) { entered[e.pid] = 1; });
        ps.oninput = function () {
          var q = ps.value.trim().toLowerCase(); if (!q) { sg.hidden = true; return; }
          var hits = players.filter(function (p) { return E.truthy(p.active) && !entered[p.id] && ((p.first + ' ' + p.last).toLowerCase().indexOf(q) >= 0 || String(p.phone).indexOf(q) >= 0); }).slice(0, 12);
          var jj = D.cfg.jackJill;
          sg.innerHTML = hits.length ? hits.map(function (p) {
            return jj ? '<div class="row between" style="cursor:default"><span><b>' + esc(p.first + ' ' + p.last) + '</b> <small>' + esc(p.phone || p.email) + '</small></span><span class="row" style="gap:4px"><button class="btn sm" data-pick="' + p.id + '" data-role="Jack">+ Jack</button><button class="btn sm" data-pick="' + p.id + '" data-role="Jill">+ Jill</button></span></div>'
              : '<div data-pick="' + p.id + '"><b>' + esc(p.first + ' ' + p.last) + '</b> <small>' + esc(p.phone || p.email) + '</small></div>'; }).join('') : '<div class="dim">No match — use “+ New player”</div>';
          sg.hidden = false;
          $$('[data-pick]', sg).forEach(function (d) { d.onclick = function () { api('addEntries', { tid: id, pids: [d.getAttribute('data-pick')], role: d.getAttribute('data-role') || '' }).then(function () { ps.value = ''; sg.hidden = true; load().then(function () { var n = $('#psearch'); if (n) n.focus(); }); }, function (e) { toast(e.message, true); }); }; });
        };
      }
      $$('[data-paid]').forEach(function (c) { c.onchange = function () { api('updateEntry', { id: c.getAttribute('data-paid'), paid: c.checked }).then(function () { load(true); }, function (e) { toast(e.message, true); }); }; });
      $$('[data-amt]').forEach(function (c) { c.onchange = function () { api('updateEntry', { id: c.getAttribute('data-amt'), amount: c.value }).catch(function (e) { toast(e.message, true); }); }; });
      $$('[data-split]').forEach(function (b) { b.onclick = function () { if (confirm('Split this back into individual players?')) act(b, 'splitTeam', { id: b.getAttribute('data-split') }, 'Split'); }; });
      $$('[data-hcp]').forEach(function (c) { c.onchange = function () { api('updateEntry', { id: c.getAttribute('data-hcp'), hcp: Number(c.value) || 0 }).then(function () { toast('Handicap saved'); load(true); }, function (e) { toast(e.message, true); }); }; });
      $$('[data-team]').forEach(function (c) { c.onchange = function () { api('updateEntry', { id: c.getAttribute('data-team'), team: c.value.trim() }).then(function () { toast('Name saved'); load(true); }, function (e) { toast(e.message, true); }); }; });
      $$('[data-rm]').forEach(function (b) { b.onclick = function () { if (confirm('Remove this player from the tournament?')) act(b, 'removeEntry', { id: b.getAttribute('data-rm') }, 'Removed'); }; });
      $$('[data-copy]').forEach(function (b) { b.onclick = function () { copy(b.getAttribute('data-copy')); }; });
      $$('[data-call]').forEach(function (b) { b.onclick = function () { var mid = b.getAttribute('data-call'), sel = $('[data-tsel="' + mid + '"]'); act(b, 'callMatch', { id: mid, table: sel ? sel.value : '' }, function (r) { return 'Called to table ' + r.table; }); }; });
      $$('[data-callnext]').forEach(function (b) {
        b.onclick = function () {
          var tb = b.getAttribute('data-callnext'), live = D.T.matches.filter(function (m) { return m.status === 'live'; }), busyP = {};
          live.forEach(function (m) { busyP[m.p1] = 1; busyP[m.p2] = 1; });
          var cand = D.T.matches.filter(function (x) { return x.status === 'ready' && !busyP[x.p1] && !busyP[x.p2]; });
          var m = cand.filter(function (x) { return String(x.plan) === String(tb); }).sort(function (a, c) { return (Number(a.planOrder) || 999) - (Number(c.planOrder) || 999) || a.seq - c.seq; })[0] ||
            cand.filter(function (x) { return !x.plan; }).sort(function (a, c) { return a.seq - c.seq; })[0] ||
            cand.sort(function (a, c) { return a.seq - c.seq; })[0];
          if (!m) return toast('Every ready match has a player who is still playing', true);
          act(b, 'callMatch', { id: m.id, table: tb }, 'Called to table ' + tb);
        };
      });
      var planSave = function (args, msg) { return api('setPlan', args).then(function () { if (msg) toast(msg); load(true); }, function (e) { toast(e.message, true); load(true); }); };
      $$('[data-pplan]').forEach(function (sl) { sl.onchange = function () { planSave({ id: sl.getAttribute('data-pplan'), plan: sl.value }, sl.value ? 'Booked on table ' + sl.value : 'Unbooked'); }; });
      $$('[data-ptime]').forEach(function (inp) { inp.onchange = function () { planSave({ id: inp.getAttribute('data-ptime'), time: inp.value }, inp.value ? 'Time set: ' + fmtTime(inp.value) : 'Time cleared'); }; });
      $$('[data-porder]').forEach(function (inp) { inp.onchange = function () { planSave({ id: inp.getAttribute('data-porder'), planOrder: inp.value }, 'Queue order saved'); }; });
      $$('[data-rset]').forEach(function (b) {
        b.onclick = function () {
          var k = b.getAttribute('data-rset'), inp = $('[data-rtime="' + k + '"]'), parts = k.split('|');
          if (!inp.value) return toast('Pick a time first', true);
          busy(b, api('setRoundTime', { tid: id, stage: parts[0], round: Number(parts[1]), time: inp.value })).then(function (r) { toast(r.updated + ' matches set to ' + fmtTime(inp.value)); load(true); });
        };
      });
      $$('[data-msel],[data-assign]').forEach(function (sl) {
        sl.onchange = function () {
          if (!sl.value) return;
          var mid = sl.getAttribute('data-msel') || sl.getAttribute('data-assign'), mm = D.by[mid];
          var moving = mm && mm.status === 'live';
          var notify = confirm((moving ? 'Move this match to table ' : 'Call this match to table ') + sl.value + '?\n\nOK = also message the players\nCancel = just ' + (moving ? 'move it' : 'assign it') + ' quietly');
          busy(null, api('callMatch', { id: mid, table: sl.value, notify: notify })).then(function () { toast((moving ? 'Moved to table ' : 'On table ') + sl.value); load(); }, function () { load(); });
        };
      });
      $$('[data-off]').forEach(function (b) { b.onclick = function () { act(b, 'uncallMatch', { id: b.getAttribute('data-off') }, 'Taken off the table'); }; });
      $$('[data-msg]').forEach(function (b) { b.onclick = function () { api('matchMessages', { id: b.getAttribute('data-msg') }).then(function (r) { showMessages(D.by[b.getAttribute('data-msg')], r.messages); }); }; });
      $$('[data-ovr]').forEach(function (c) { c.onchange = function () { api('updateEntry', { id: c.getAttribute('data-ovr'), payoutOverride: c.value }).then(function () { load(); }); }; });
      $$('[data-po]').forEach(function (c) { c.onchange = function () { api('updateEntry', { id: c.getAttribute('data-po'), paidOut: c.checked }); }; });
      var mf = $('#mfind'); if (mf) mf.oninput = function () { var q = mf.value.toLowerCase(); $$('#mlist tbody tr').forEach(function (tr) { tr.style.display = tr.textContent.toLowerCase().indexOf(q) >= 0 ? '' : 'none'; }); };
    }

    function showMessages(m, msgs) {
      modal('<h2>Text the players</h2><p class="muted">Opens your phone\'s messaging app with the message ready to send.</p>' + msgs.map(function (x) {
        var text = D.T.t.name + ': your match is on TABLE ' + m.table + '. Score it here: ' + x.link;
        return '<div class="card"><b>' + esc(x.name) + '</b><div class="row" style="margin-top:8px">' + (x.phone ? '<a class="btn primary sm" href="' + smsHref(x.phone, text) + '">Text ' + esc(x.phone) + '</a>' : '<span class="dim">No phone</span>') +
          (x.email ? '<a class="btn sm" href="mailto:' + esc(x.email) + '?subject=' + encodeURIComponent('Table ' + m.table) + '&body=' + encodeURIComponent(text) + '">Email</a>' : '') + '</div></div>';
      }).join('') + '<button class="btn block" data-close>Close</button>');
    }
    function showQR() {
      var url = location.origin + location.pathname + '#/t/' + id;
      var img = 'https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=20&data=' + encodeURIComponent(url);
      var home = 'https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=20&data=' + encodeURIComponent(location.origin + location.pathname);
      modal('<h2>QR codes</h2><div class="grid g2"><div style="text-align:center"><img src="' + img + '" style="width:100%;background:#fff;border-radius:8px"><small>This tournament</small></div>' +
        '<div style="text-align:center"><img src="' + home + '" style="width:100%;background:#fff;border-radius:8px"><small>All tournaments (for the wall)</small></div></div>' +
        '<p class="hint" style="margin-top:10px">Long-press or right-click to save and print. The wall code never changes, so it can stay up permanently.</p><button class="btn block" data-close>Close</button>');
    }
    load(); poll(function () { if (!document.querySelector('input:focus')) load(true); }, 10);
  }

  function sentSummary(sent, count) {
    if (DEMO) return 'Demo mode: ' + count + ' messages would be sent (see browser console)';
    var e = (sent || []).filter(function (x) { return x.email; }).length, s = (sent || []).filter(function (x) { return x.sms; }).length;
    return 'Sent ' + e + ' email' + (e === 1 ? '' : 's') + (s ? ' and ' + s + ' text' + (s === 1 ? '' : 's') : '') + ' for ' + count + ' players';
  }
  function copy(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast('Link copied'); }, function () { prompt('Copy this link:', text); });
    else prompt('Copy this link:', text);
  }

  /* ---------------- player form (modal) ---------------- */
  function playerForm(p, onSave, askRole) {
    p = p || {};
    modal('<h2>' + (p.id ? 'Edit player' : 'New player') + '</h2><form id="pf"><div class="fgrid"><label class="f">First name<input name="first" required value="' + esc(p.first) + '"></label><label class="f">Last name<input name="last" required value="' + esc(p.last) + '"></label></div>' +
      '<label class="f">Mobile phone<input name="phone" type="tel" inputmode="tel" value="' + esc(p.phone) + '" placeholder="204-555-1234"></label>' +
      '<label class="f">Email<input name="email" type="email" value="' + esc(p.email) + '"></label><p class="hint">Phone and/or email — used to send match calls and their player link.</p>' +
      '<label class="f">Notes (directors only)<input name="notes" value="' + esc(p.notes) + '"></label>' +
      (p.id ? '<label class="chk"><input type="checkbox" name="active" ' + (E.truthy(p.active) ? 'checked' : '') + '> Active (shows in search)</label>' : '') +
      (askRole ? '<label class="f">Enter as<select name="role"><option>Jack</option><option>Jill</option></select></label>' : '') +
      '<div class="row"><button class="btn primary">Save</button><button type="button" class="btn ghost" data-close>Cancel</button></div></form>', function (c) {
        var f = $('#pf', c); f.first.focus();
        f.onsubmit = function (e) {
          e.preventDefault();
          var data = { id: p.id, first: f.first.value, last: f.last.value, phone: f.phone.value, email: f.email.value, notes: f.notes.value };
          if (f.active) data.active = f.active.checked;
          if (f.role) data.role = f.role.value;
          var b = f.querySelector('button.primary');
          busy(b, onSave(data)).then(closeModal, function (err) {
            if (/already exists/.test(err.message) && confirm(err.message + '. Add anyway?')) { data.allowDuplicate = true; onSave(data).then(closeModal); }
          });
        };
      });
  }

  /* ---------------- players DB ---------------- */
  function viewPlayers() {
    api('listPlayers').then(function (r) {
      var list = r.players.slice().sort(function (a, b) { return (a.last + a.first).localeCompare(b.last + b.first); });
      app.innerHTML = adminNav('players') + '<div class="row between"><h1 style="margin:0">Player database</h1><button class="btn primary" id="np">+ New player</button></div>' +
        '<div class="row" style="margin:12px 0"><input id="pq" placeholder="Search name, phone or email…" style="max-width:340px"><label class="chk"><input type="checkbox" id="showInactive"> Show inactive</label><span class="muted">' + list.length + ' players</span></div>' +
        '<div class="card flush"><div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th class="hide-sm">Notes</th><th></th></tr></thead><tbody id="pb">' +
        list.map(function (p) {
          return '<tr data-s="' + esc((p.first + ' ' + p.last + ' ' + p.phone + ' ' + p.email).toLowerCase()) + '" data-active="' + (E.truthy(p.active) ? 1 : 0) + '"><td><b>' + esc(p.last) + ', ' + esc(p.first) + '</b>' + (E.truthy(p.active) ? '' : ' <span class="pill">inactive</span>') + '</td><td>' + esc(p.phone) + '</td><td>' + esc(p.email) + '</td><td class="hide-sm"><small>' + esc(p.notes) + '</small></td>' +
            '<td class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn sm" data-edit="' + p.id + '">Edit</button><a class="btn sm ghost" href="#/player/' + p.id + '">Stats</a></td></tr>';
        }).join('') + '</tbody></table></div></div>';
      var by = {}; r.players.forEach(function (p) { by[p.id] = p; });
      var save = function (d) { return api('savePlayer', d).then(function () { toast('Saved'); historyCache = null; viewPlayers(); }); };
      $('#np').onclick = function () { playerForm(null, save); };
      $$('[data-edit]').forEach(function (b) { b.onclick = function () { playerForm(by[b.getAttribute('data-edit')], save); }; });
      function filter() { var q = $('#pq').value.toLowerCase(), all = $('#showInactive').checked; $$('#pb tr').forEach(function (tr) { tr.style.display = (tr.getAttribute('data-s').indexOf(q) >= 0 && (all || tr.getAttribute('data-active') === '1')) ? '' : 'none'; }); }
      $('#pq').oninput = filter; $('#showInactive').onchange = filter; filter();
      bindLogout();
    }).catch(fail);
  }

  /* ---------------- directors ---------------- */
  function tempPassword() {
    var words = ['cue', 'rack', 'chalk', 'bank', 'break', 'pocket', 'eight', 'nine', 'rail', 'spin'];
    return words[Math.floor(Math.random() * words.length)] + '-' + (1000 + Math.floor(Math.random() * 9000));
  }
  function viewDirectors() {
    Promise.all([api('listDirectors'), api('listInvites')]).then(function (rr) {
      var r = rr[0], invites = rr[1].invites, canManage = r.you.owner || !r.ownerSet;
      app.innerHTML = adminNav('directors') + '<div class="row between"><h1 style="margin:0">Directors</h1>' + (canManage ? '<button class="btn primary" id="nd">+ Add director</button>' : '') + '</div>' +
        '<p class="muted">Directors can create and run tournaments, manage players and fix scores.' + (r.ownerSet ? ' Only the owner can add or change directors.' : '') + '</p>' +
        (r.you.owner ? '<div class="card" style="padding:10px 14px"><b>' + esc(r.you.name) + '</b> <span class="pill gold">Owner</span> <span class="muted" style="font-size:13px">· your login is kept in the Apps Script, not on this list</span></div>' : '') +
        (invites.length ? '<h3>Pending invite links</h3><div class="card flush" style="margin-bottom:14px"><table><tbody>' +
          invites.map(function (i) { return '<tr><td>' + esc(i.name) + '</td><td>' + esc(i.email) + '</td><td>' + (i.expired ? '<span class="pill">expired</span>' : 'Waiting') + '</td><td>' + (canManage ? '<button class="btn sm danger" data-revoke="' + i.id + '">Cancel</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') +
        '<div class="card flush"><div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Status</th>' + (canManage ? '<th></th>' : '') + '</tr></thead><tbody>' +
        (r.directors.length ? r.directors.map(function (d) {
          var st = !d.active ? '<span class="pill">Disabled</span>' : d.mustChange ? '<span class="pill wc">Temporary password</span>' : '<span class="pill done">Active</span>';
          return '<tr><td><b>' + esc(d.name) + '</b></td><td>' + esc(d.username) + '</td><td>' + esc(d.email) + '</td><td>' + st + '</td>' +
            (canManage ? '<td class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn sm" data-ed="' + d.id + '">Edit</button><button class="btn sm ghost" data-reset="' + d.id + '">Reset password</button></td>' : '') + '</tr>';
        }).join('') : '<tr><td colspan="5" class="empty">No other directors yet.</td></tr>') + '</tbody></table></div></div>';
      var by = {}; r.directors.forEach(function (d) { by[d.id] = d; });

      function done(res, d) {
        var msg = res.message || '';
        modal('<h2>' + (res.emailed ? 'Login sent ✉' : 'Login ready') + '</h2>' +
          (res.emailed ? '<p>An email with the username and temporary password is on its way to <b>' + esc(d.email) + '</b>.</p>' :
            '<p>' + (d.email && d.sendEmail ? (DEMO ? 'Demo mode doesn\'t send email.' : 'The email couldn\'t be sent (daily email limit?).') + ' ' : '') + 'Send them these details yourself:</p>') +
          '<div class="card" style="font-size:14px">Username: <b>' + esc(res.username) + '</b><br>Temporary password: <b>' + esc(d.password) + '</b><br>Sign in: ' + esc(location.origin + location.pathname + '#/admin') + '</div>' +
          '<p class="hint">They\'ll be asked to choose their own password the first time they sign in.</p>' +
          '<div class="row"><button class="btn" id="cpyMsg">Copy message</button><button class="btn primary" data-close>Done</button></div>', function (c) {
            $('#cpyMsg', c).onclick = function () { copy(msg || ('Username: ' + res.username + '\nTemporary password: ' + d.password + '\nSign in: ' + location.origin + location.pathname + '#/admin')); };
            $$('[data-close]', c).forEach(function (b) { b.onclick = function () { closeModal(); viewDirectors(); }; });
          });
      }
      function addForm() {
        modal('<h2>Add a director</h2><form id="df"><label class="f">Name<input name="name" required></label>' +
          '<label class="f">Email<input name="email" type="email" placeholder="for their login email"></label>' +
          '<label class="f">Username<input name="username" required autocapitalize="off" placeholder="e.g. marvin"></label>' +
          '<label class="f">Temporary password<input name="password" required minlength="6" value="' + tempPassword() + '"></label>' +
          '<label class="chk"><input type="checkbox" name="send" checked> Email them their username, temporary password and the sign-in link</label>' +
          '<p class="hint">They must change the temporary password the first time they sign in.</p>' +
          '<div class="row"><button class="btn primary">Create login</button><button type="button" class="btn ghost" data-close>Cancel</button></div></form>', function (c) {
            var f = $('#df', c); f.name.focus();
            f.name.oninput = function () { if (!f.username._touched) f.username.value = f.name.value.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9._-]/g, ''); };
            f.username.oninput = function () { f.username._touched = true; };
            f.onsubmit = function (e) {
              e.preventDefault();
              if (f.send.checked && !f.email.value) return toast('Add an email, or untick “Email them”', true);
              var d = { name: f.name.value, email: f.email.value, username: f.username.value, password: f.password.value, temporary: true, sendEmail: f.send.checked, hallName: CFG.HALL_NAME };
              busy(f.querySelector('.primary'), api('saveDirector', d)).then(function (res) { done(res, d); });
            };
          });
      }
      function editForm(d) {
        modal('<h2>Edit director</h2><form id="df"><label class="f">Name<input name="name" required value="' + esc(d.name) + '"></label><label class="f">Username<input name="username" required value="' + esc(d.username) + '" autocapitalize="off"></label>' +
          '<label class="f">Email<input name="email" type="email" value="' + esc(d.email) + '"></label><label class="chk"><input type="checkbox" name="active" ' + (d.active ? 'checked' : '') + '> Active (untick to block their sign-in)</label>' +
          '<div class="row"><button class="btn primary">Save</button><button type="button" class="btn ghost" data-close>Cancel</button></div></form>', function (c) {
            var f = $('#df', c); f.onsubmit = function (e) {
              e.preventDefault();
              busy(f.querySelector('.primary'), api('saveDirector', { id: d.id, name: f.name.value, username: f.username.value, email: f.email.value, active: f.active.checked })).then(function () { closeModal(); toast('Saved'); viewDirectors(); });
            };
          });
      }
      function resetForm(d) {
        modal('<h2>Reset password</h2><p class="muted">' + esc(d.name) + ' gets a new temporary password and must change it when they next sign in.</p><form id="df">' +
          '<label class="f">New temporary password<input name="password" required minlength="6" value="' + tempPassword() + '"></label>' +
          (d.email ? '<label class="chk"><input type="checkbox" name="send" checked> Email it to ' + esc(d.email) + '</label>' : '<p class="hint">No email on file — you\'ll get the details to send yourself.</p>') +
          '<div class="row"><button class="btn primary">Reset</button><button type="button" class="btn ghost" data-close>Cancel</button></div></form>', function (c) {
            var f = $('#df', c); f.onsubmit = function (e) {
              e.preventDefault();
              var args = { id: d.id, name: d.name, username: d.username, email: d.email, password: f.password.value, temporary: true, sendEmail: !!(f.send && f.send.checked), hallName: CFG.HALL_NAME };
              busy(f.querySelector('.primary'), api('saveDirector', args)).then(function (res) { done(res, Object.assign({}, d, { password: args.password, sendEmail: args.sendEmail })); });
            };
          });
      }
      var nd = $('#nd'); if (nd) nd.onclick = addForm;
      $$('[data-ed]').forEach(function (b) { b.onclick = function () { editForm(by[b.getAttribute('data-ed')]); }; });
      $$('[data-reset]').forEach(function (b) { b.onclick = function () { resetForm(by[b.getAttribute('data-reset')]); }; });
      $$('[data-revoke]').forEach(function (b) { b.onclick = function () { if (confirm('Cancel this invite? The link will stop working.')) busy(b, api('revokeInvite', { id: b.getAttribute('data-revoke') })).then(viewDirectors); }; });
      bindLogout();
    }).catch(fail);
  }

  /* ---------------- accept a director invite (#/invite/TOKEN) ---------------- */
  function viewInvite(token) {
    api('getInvite', { token: token }).then(function (inv) {
      app.innerHTML = '<div class="card" style="max-width:420px;margin:30px auto"><h2>Welcome, ' + esc(inv.name) + '</h2><p class="muted">You\'ve been invited to be a tournament director. Choose how you\'ll sign in.</p>' +
        '<form id="af"><label class="f">Your name<input name="name" required value="' + esc(inv.name) + '"></label>' +
        '<label class="f">Username<input name="username" required autocapitalize="off" autocomplete="username" placeholder="e.g. ' + esc(inv.name.split(' ')[0].toLowerCase()) + '"></label>' +
        '<label class="f">Password (6+ characters)<input name="password" type="password" required minlength="6" autocomplete="new-password"></label>' +
        '<label class="f">Password again<input name="password2" type="password" required minlength="6" autocomplete="new-password"></label>' +
        '<button class="btn primary block">Create my login</button></form></div>';
      $('#af').onsubmit = function (e) {
        e.preventDefault(); var f = e.target;
        if (f.password.value !== f.password2.value) return toast('The passwords don\'t match', true);
        busy(f.querySelector('button'), api('acceptInvite', { token: token, name: f.name.value, username: f.username.value, password: f.password.value }))
          .then(function (r) { localStorage.setItem(SKEY, r.session); toast('Welcome aboard, ' + r.name + '!'); location.hash = '#/admin'; });
      };
    }).catch(fail);
  }

  /* ---------------- templates ---------------- */
  function viewTemplates() {
    api('listTemplates').then(function (r) {
      app.innerHTML = adminNav('templates') + '<h1>Templates</h1><p class="muted">Save your regular Saturday and Sunday setups once, then create each week\'s event from them. To make a template, tick “Also save as template” when creating or editing a tournament.</p>' +
        (r.templates.length ? '<div class="grid g2">' + r.templates.map(function (t) {
          var c = E.defaults(t.config);
          return '<div class="card"><h2>' + esc(t.name) + '</h2><div class="kv"><span><b>' + c.gameType + '-ball</b></span><span>' + formatName(c) + '</span>' + raceSummary(c) + '<span>Entry ' + money(c.entryFee) + '</span></div>' +
            '<div class="row" style="margin-top:10px"><a class="btn primary sm" href="#/admin/new/' + t.id + '">Create tournament</a><button class="btn sm danger" data-del="' + t.id + '">Delete</button></div></div>';
        }).join('') + '</div>' : '<div class="card empty">No templates yet.</div>');
      $$('[data-del]').forEach(function (b) { b.onclick = function () { if (confirm('Delete this template?')) busy(b, api('deleteTemplate', { id: b.getAttribute('data-del') })).then(viewTemplates); }; });
      bindLogout();
    }).catch(fail);
  }

  /* ---------------- director tools on the scoring page ---------------- */
  // Adds race change / reset controls under the scoresheet when a director opens a match.
  function addDirectorTools() {
    var m = location.hash.match(/^#\/s\/([^/]+)\/d$/); if (!m || !session()) return;
    if ($('#dirTools')) return;
    var mid = m[1];
    var box = document.createElement('div'); box.id = 'dirTools'; box.className = 'card';
    box.innerHTML = '<h3>Director tools</h3><div class="row"><label class="f" style="margin:0;width:140px">Race / games<input id="dtRace" type="number" min="1"></label><button class="btn sm" id="dtSaveRace">Change race</button>' +
      '<button class="btn sm danger" id="dtReset">Reset match (clear all scores)</button></div><p class="hint" style="margin-top:8px">Resetting is blocked if the next match in the bracket has already started — reset that one first.</p>';
    app.appendChild(box);
    $('#dtSaveRace').onclick = function () { var v = $('#dtRace').value; if (!v) return; busy(this, api('editMatch', { id: mid, race: v })).then(function () { toast('Race updated'); route(); }); };
    $('#dtReset').onclick = function () { if (confirm('Clear every rack/game in this match?')) busy(this, api('editMatch', { id: mid, reset: true })).then(function () { toast('Match reset'); route(); }); };
  }
  new MutationObserver(function () { addDirectorTools(); }).observe(app, { childList: true });

  route();
})();
