/* =====================================================================
   TOURNAMENT SERVICE  (shared file)
   All app actions. Runs inside Apps Script (paste a copy as Service.gs)
   and inside the website's demo mode. Needs Engine.
   store:  list(table) / insert(table,obj) / update(table,obj) / remove(table,id) / commit()
   P (platform): now, uuid, token, hash, sessionGet/Put/Del, notify, siteUrl, cacheGet/Put/Del, lock
   ===================================================================== */
var Service = (function () {

  var SCHEMA = {
    Players: ['id', 'first', 'last', 'phone', 'email', 'notes', 'active', 'created'],
    Directors: ['id', 'username', 'name', 'email', 'salt', 'hash', 'active', 'created'],
    Tournaments: ['id', 'name', 'date', 'status', 'gameType', 'format', 'config', 'champion', 'created', 'createdBy', 'updated'],
    Entries: ['id', 'tid', 'pid', 'paid', 'amount', 'grp', 'seed', 'wildcard', 'tb', 'place', 'payout', 'payoutOverride', 'paidOut', 'rankPts', 'key', 'created'],
    Matches: ['id', 'tid', 'seq', 'stage', 'grp', 'round', 'pos', 'label', 'src1', 'src2', 'p1', 'p2', 'race', 'table', 'status', 'games',
      's1', 's2', 'e1', 'e2', 'winner', 'loser', 'calledAt', 'startedAt', 'doneAt', 'updated', 'updatedBy'],
    MatchHistory: null,
    Templates: ['id', 'name', 'config', 'created'],
    Log: ['id', 'ts', 'who', 'action', 'detail']
  };
  SCHEMA.MatchHistory = SCHEMA.Matches;
  var JSON_FIELDS = { config: 1, games: 1 };
  var STATUS_LABEL = { registration: 'Registration', roundrobin: 'Round robin', finals: 'Finals', bracket: 'In progress', complete: 'Complete' };

  function create(store, P) {
    var E = Engine;
    function err(msg) { var e = new Error(msg); e.userError = true; throw e; }
    function byId(table, id) { var r = store.list(table).filter(function (x) { return String(x.id) === String(id); })[0]; return r; }
    function need(table, id) { var r = byId(table, id); if (!r) err(table.replace(/s$/, '') + ' not found'); return r; }
    function cfgOf(t) { return E.defaults(t.config || {}); }
    function tMatches(tid) { return store.list('Matches').filter(function (m) { return m.tid === tid; }); }
    function tEntries(tid) { return store.list('Entries').filter(function (e) { return e.tid === tid; }); }
    function playerName(p) { return p ? (p.first + ' ' + p.last).trim() : '?'; }
    function log(who, action, detail) { store.insert('Log', { id: P.uuid(), ts: P.now(), who: who || 'player', action: action, detail: String(detail || '').slice(0, 400) }); }
    function touch(t) { t.updated = P.now(); store.update('Tournaments', t); P.cacheDel('t:' + t.id); P.cacheDel('list'); }

    /* ---------------- auth ---------------- */
    function director(session) {
      if (!session) err('Please sign in');
      var s = P.sessionGet(session); if (!s) err('Your sign-in has expired — please sign in again');
      P.sessionPut(session, s);
      return s;
    }
    function isDirector(session) { try { return session ? !!director(session) : false; } catch (e) { return false; } }

    function login(a) {
      var u = String(a.username || '').trim().toLowerCase();
      var d = store.list('Directors').filter(function (x) { return String(x.username).toLowerCase() === u && E.truthy(x.active); })[0];
      if (!d || P.hash(d.salt + ':' + a.password) !== d.hash) err('Wrong username or password');
      var tok = P.token();
      P.sessionPut(tok, { did: d.id, name: d.name || d.username });
      return { session: tok, name: d.name || d.username };
    }

    function saveDirector(a, me) {
      var d = a.id ? need('Directors', a.id) : null;
      var uname = String(a.username || '').trim().toLowerCase();
      if (!uname) err('Username is required');
      var clash = store.list('Directors').filter(function (x) { return String(x.username).toLowerCase() === uname && (!d || x.id !== d.id); })[0];
      if (clash) err('That username is taken');
      if (!d) {
        if (!a.password || String(a.password).length < 6) err('Password must be at least 6 characters');
        d = { id: P.uuid(), username: uname, name: a.name || uname, email: a.email || '', active: true, created: P.now() };
        d.salt = P.token(); d.hash = P.hash(d.salt + ':' + a.password);
        store.insert('Directors', d);
      } else {
        d.username = uname; d.name = a.name || uname; d.email = a.email || ''; if (a.active !== undefined) d.active = !!a.active;
        if (a.password) { if (String(a.password).length < 6) err('Password must be at least 6 characters'); d.salt = P.token(); d.hash = P.hash(d.salt + ':' + a.password); }
        store.update('Directors', d);
      }
      log(me && me.name, 'saveDirector', uname);
      return { id: d.id };
    }

    /* ---------------- players ---------------- */
    function savePlayer(a, me) {
      var first = String(a.first || '').trim(), last = String(a.last || '').trim();
      if (!first || !last) err('First and last name are required');
      if (!a.phone && !a.email) err('Add a phone number or an email');
      var p = a.id ? need('Players', a.id) : null;
      var dupe = store.list('Players').filter(function (x) {
        return E.truthy(x.active) && (!p || x.id !== p.id) && x.first.toLowerCase() === first.toLowerCase() && x.last.toLowerCase() === last.toLowerCase();
      })[0];
      if (dupe && !a.allowDuplicate) err('A player called ' + first + ' ' + last + ' already exists');
      if (!p) { p = { id: P.uuid(), created: P.now(), active: true }; }
      p.first = first; p.last = last; p.phone = String(a.phone || '').trim(); p.email = String(a.email || '').trim(); p.notes = a.notes || '';
      if (a.active !== undefined) p.active = !!a.active;
      if (a.id) store.update('Players', p); else store.insert('Players', p);
      log(me.name, 'savePlayer', playerName(p));
      return { player: p };
    }

    /* ---------------- tournament payloads ---------------- */
    function tPublic(t) {
      return { id: t.id, name: t.name, date: t.date, status: t.status, statusLabel: STATUS_LABEL[t.status] || t.status, config: cfgOf(t), champion: t.champion || '', updated: t.updated };
    }

    function tournamentPayload(tid, dir) {
      var t = need('Tournaments', tid), players = {};
      store.list('Players').forEach(function (p) { players[p.id] = p; });
      var entries = tEntries(tid).map(function (e) {
        var p = players[e.pid], o = { id: e.id, pid: e.pid, name: playerName(p), first: p ? p.first : '', last: p ? p.last : '',
          grp: e.grp, seed: e.seed, wildcard: E.truthy(e.wildcard), tb: e.tb, place: e.place, payout: e.payout };
        if (dir) { o.paid = E.truthy(e.paid); o.amount = e.amount; o.payoutOverride = e.payoutOverride; o.paidOut = E.truthy(e.paidOut);
          o.key = e.key; o.phone = p ? p.phone : ''; o.email = p ? p.email : ''; }
        return o;
      });
      var matches = tMatches(tid).map(function (m) { var o = {}; for (var k in m) o[k] = m[k]; return o; })
        .sort(function (a, b) { return a.seq - b.seq; });
      if (t.status === 'complete' && !matches.length) {
        matches = store.list('MatchHistory').filter(function (m) { return m.tid === tid; }).sort(function (a, b) { return a.seq - b.seq; });
      }
      return { t: tPublic(t), entries: entries, matches: matches, serverTime: P.now() };
    }

    /* ---------------- tournament setup ---------------- */
    function saveTournament(a, me) {
      var t = a.id ? need('Tournaments', a.id) : null;
      if (!a.name) err('Tournament name is required');
      var cfg = E.defaults(a.config || {});
      if (!t) {
        t = { id: 'T' + P.token().slice(0, 6).toUpperCase(), status: 'registration', created: P.now(), createdBy: me.name };
        t.name = a.name; t.date = a.date || ''; t.config = cfg; t.gameType = cfg.gameType; t.format = cfg.format; t.updated = P.now();
        store.insert('Tournaments', t);
      } else {
        var started = t.status !== 'registration';
        var old = cfgOf(t);
        if (started && (old.format !== cfg.format || old.gameType !== cfg.gameType || old.raceType !== cfg.raceType)) err('Format, game and race type can\'t change once play has started');
        t.name = a.name; t.date = a.date || ''; t.config = cfg; t.gameType = cfg.gameType; t.format = cfg.format;
        // push race changes onto matches that haven't started
        if (started) tMatches(t.id).forEach(function (m) {
          if (m.stage === 'RR' || (m.games || []).length || m.status === 'done') return;
          var nr = raceForMatch(cfg, m, tMatches(t.id));
          if (nr !== Number(m.race)) { m.race = nr; store.update('Matches', m); }
        });
        touch(t);
      }
      log(me.name, 'saveTournament', t.name);
      return { id: t.id };
    }

    function raceForMatch(cfg, m, all) {
      if (m.stage === 'GF') return cfg.raceFinal || cfg.raceA;
      if (m.stage === 'L') {
        var maxL = Math.max.apply(null, all.filter(function (x) { return x.stage === 'L'; }).map(function (x) { return x.round; }));
        return m.round === maxL ? (cfg.raceBFinal || cfg.raceB || cfg.raceA) : (cfg.raceB || cfg.raceA);
      }
      if (m.stage === 'SE') {
        var maxS = Math.max.apply(null, all.filter(function (x) { return x.stage === 'SE'; }).map(function (x) { return x.round; }));
        return m.round === maxS ? (cfg.raceFinal || cfg.raceA) : cfg.raceA;
      }
      return cfg.raceA;
    }

    function addEntries(a, me) {
      var t = need('Tournaments', a.tid);
      if (t.status !== 'registration' && !(t.format !== 'RR' && false)) err('Players can only be added during registration');
      var have = {}; tEntries(t.id).forEach(function (e) { have[e.pid] = 1; });
      var added = 0;
      (a.pids || []).forEach(function (pid) {
        if (have[pid] || !byId('Players', pid)) return;
        store.insert('Entries', { id: P.uuid(), tid: t.id, pid: pid, paid: !!a.paid, amount: '', grp: '', seed: '', wildcard: false, tb: '', place: '', payout: '',
          payoutOverride: '', paidOut: false, rankPts: '', key: P.token().slice(0, 10), created: P.now() });
        have[pid] = 1; added++;
      });
      touch(t);
      return { added: added };
    }

    function removeEntry(a, me) {
      var e = need('Entries', a.id), t = need('Tournaments', e.tid);
      if (t.status !== 'registration') err('Players can\'t be removed after play has started');
      store.remove('Entries', e.id); touch(t);
      return { ok: true };
    }

    function updateEntry(a, me) {
      var e = need('Entries', a.id), t = need('Tournaments', e.tid);
      ['paid', 'amount', 'seed', 'tb', 'payoutOverride', 'paidOut', 'grp'].forEach(function (k) { if (a[k] !== undefined) e[k] = a[k]; });
      if (a.payoutOverride !== undefined || a.paid !== undefined || a.amount !== undefined) recalcPayouts(t);
      store.update('Entries', e); touch(t);
      return { ok: true };
    }

    function drawGroups(a, me) {
      var t = need('Tournaments', a.tid), cfg = cfgOf(t);
      if (t.status !== 'registration') err('Groups are already locked in');
      var es = tEntries(t.id); if (es.length < 3) err('Need at least 3 players');
      var plan = E.rrPlan(cfg, es.length), map = E.dealGroups(es.map(function (e) { return e.id; }), plan.groups, P.random);
      es.forEach(function (e) { e.grp = map[e.id]; store.update('Entries', e); });
      touch(t); log(me.name, 'drawGroups', t.name);
      return { plan: plan };
    }

    function startRoundRobin(a, me) {
      var t = need('Tournaments', a.tid), cfg = cfgOf(t);
      if (cfg.format !== 'RR') err('This tournament is not a round robin');
      if (t.status !== 'registration') err('Round robin has already started');
      var es = tEntries(t.id);
      if (es.some(function (e) { return !e.grp; })) err('Draw the groups first');
      var groups = {}; es.forEach(function (e) { (groups[e.grp] = groups[e.grp] || []).push(e.id); });
      var seq = 1;
      Object.keys(groups).sort().forEach(function (g) {
        E.roundRobinPairs(groups[g]).forEach(function (pr, i) {
          store.insert('Matches', { id: t.id + '-' + g + '-' + (i + 1), tid: t.id, seq: seq++, stage: 'RR', grp: g, round: pr.round, pos: i, label: 'Group ' + g + ' · Match ' + (i + 1),
            src1: 'E:' + pr.a, src2: 'E:' + pr.b, p1: pr.a, p2: pr.b, race: cfg.rrGames, table: '', status: 'ready', games: [], s1: 0, s2: 0, e1: 0, e2: 0,
            winner: '', loser: '', calledAt: '', startedAt: '', doneAt: '', updated: P.now(), updatedBy: '' });
        });
      });
      // interleave groups so early matches spread across all groups
      var ms = tMatches(t.id), idx = {};
      ms.sort(function (x, y) { return (x.round - y.round) || (x.pos - y.pos); });
      ms.forEach(function (m) { var k = m.grp + '|' + m.round; idx[k] = (idx[k] || 0) + 1; m._i = idx[k]; });
      ms.sort(function (x, y) { return (x.round - y.round) || (x._i - y._i) || (x.grp < y.grp ? -1 : 1); });
      ms.forEach(function (m) { delete m._i; });
      ms.forEach(function (m, i) { m.seq = i + 1; store.update('Matches', m); });
      t.status = 'roundrobin'; touch(t); log(me.name, 'startRoundRobin', t.name);
      var called = cfg.autoCall ? fillTables(t, me.name) : [];
      return { matches: ms.length, called: called.length };
    }

    function rankingFor(pids) {
      var cutoff = new Date(Date.now() - 365 * 864e5).toISOString(), done = {};
      store.list('Tournaments').forEach(function (t) { if (t.status === 'complete' && String(t.created) >= cutoff) done[t.id] = 1; });
      var pts = {}; pids.forEach(function (p) { pts[p] = 0; });
      store.list('Entries').forEach(function (e) { if (done[e.tid] && pts[e.pid] !== undefined) pts[e.pid] += Number(e.rankPts) || 0; });
      return pts;
    }

    function startBracket(a, me) {
      var t = need('Tournaments', a.tid), cfg = cfgOf(t);
      if (cfg.format === 'RR') err('Use "Generate finals" for round robin tournaments');
      if (t.status !== 'registration') err('The bracket has already started');
      var es = tEntries(t.id); if (es.length < 2) err('Need at least 2 players');
      var ordered;
      if (cfg.seeding === 'manual') {
        ordered = es.slice().sort(function (x, y) { return (Number(x.seed) || 999) - (Number(y.seed) || 999); });
      } else if (cfg.seeding === 'ranking') {
        var rp = rankingFor(es.map(function (e) { return e.pid; }));
        ordered = E.shuffle(es, P.random).sort(function (x, y) { return rp[y.pid] - rp[x.pid]; });
      } else ordered = E.shuffle(es, P.random);
      ordered.forEach(function (e, i) { e.seed = i + 1; store.update('Entries', e); });
      var ms = E.buildBracket(t.id, ordered.map(function (e) { return e.id; }), cfg, cfg.format, 1000);
      E.resolve(ms, cfg);
      ms.forEach(function (m) { finishFields(m); store.insert('Matches', m); });
      t.status = 'bracket'; touch(t); log(me.name, 'startBracket', t.name);
      var called = cfg.autoCall ? fillTables(t, me.name) : [];
      return { matches: ms.length, called: called.length };
    }

    function finishFields(m) {
      m.s1 = m.s1 || 0; m.s2 = m.s2 || 0; m.e1 = m.e1 || 0; m.e2 = m.e2 || 0;
      m.calledAt = m.calledAt || ''; m.startedAt = m.startedAt || ''; m.doneAt = m.doneAt || ''; m.updated = P.now(); m.updatedBy = m.updatedBy || '';
    }

    function generateFinals(a, me) {
      var t = need('Tournaments', a.tid), cfg = cfgOf(t);
      if (t.status !== 'roundrobin') err('Round robin is not in progress');
      var es = tEntries(t.id), ms = tMatches(t.id);
      var open = ms.filter(function (m) { return m.stage === 'RR' && m.status !== 'done'; });
      if (open.length && !a.force) err(open.length + ' round robin matches are not finished yet');
      var st = E.standings(cfg, es, ms), plan = E.rrPlan(cfg, es.length);
      var groups = Object.keys(st).sort(), qual = [], tiers = [];
      if (!a.force) groups.forEach(function (g) {
        var cut = st[g][plan.advance - 1], next = st[g][plan.advance];
        if (cut && next && cut.tied && next.tied && cut.pts === next.pts) err('Group ' + g + ' has an unbroken tie at the qualifying line — set the tie-break order on the Standings tab (one game playoff)');
      });
      for (var pos = 0; pos < plan.advance; pos++) {
        var tier = [];
        groups.forEach(function (g) { if (st[g][pos]) tier.push(st[g][pos]); });
        tier.sort(function (x, y) { return (y.pts - x.pts) || (y.wins - x.wins) || (y.eros - x.eros); });
        tier.forEach(function (r) { qual.push(r.id); });
      }
      var qset = {}; qual.forEach(function (id) { qset[id] = 1; });
      var pool = es.filter(function (e) { return !qset[e.id]; }).map(function (e) { return e.id; });
      var wild = E.shuffle(pool, P.random).slice(0, plan.wildcards);
      var seeds = qual.concat(wild);
      es.forEach(function (e) {
        var i = seeds.indexOf(e.id);
        e.seed = i >= 0 ? i + 1 : ''; e.wildcard = wild.indexOf(e.id) >= 0; store.update('Entries', e);
      });
      var ko = E.buildBracket(t.id, seeds, cfg, cfg.finals, 1000);
      E.resolve(ko, cfg);
      ko.forEach(function (m) { finishFields(m); store.insert('Matches', m); });
      // any RR match never played is closed out
      open.forEach(function (m) { m.status = 'done'; m.table = ''; store.update('Matches', m); });
      t.status = 'finals'; touch(t); log(me.name, 'generateFinals', t.name + ' wild cards: ' + wild.length);
      var called = cfg.autoCall ? fillTables(t, me.name) : [];
      return { qualifiers: qual.length, wildcards: wild.length, called: called.length };
    }

    function undoFinals(a, me) {
      var t = need('Tournaments', a.tid);
      if (t.status !== 'finals') err('Finals have not been generated');
      var ko = tMatches(t.id).filter(function (m) { return m.stage !== 'RR'; });
      if (ko.some(function (m) { return (m.games || []).length; })) err('A finals match already has scores — can\'t undo');
      ko.forEach(function (m) { store.remove('Matches', m.id); });
      tEntries(t.id).forEach(function (e) { e.seed = ''; e.wildcard = false; store.update('Entries', e); });
      t.status = 'roundrobin'; touch(t); log(me.name, 'undoFinals', t.name);
      return { ok: true };
    }

    /* ---------------- tables & calling ---------------- */
    function busyPlayers(ms) {
      var b = {}; ms.forEach(function (m) { if (m.status === 'live') { b[m.p1] = 1; b[m.p2] = 1; } }); return b;
    }
    function freeTables(cfg, ms) {
      var used = {}; ms.forEach(function (m) { if (m.status === 'live' && m.table) used[m.table] = 1; });
      return cfg.tables.filter(function (tb) { return !used[tb]; });
    }
    function nextReady(ms, busy) {
      return ms.filter(function (m) { return m.status === 'ready' && m.p1 && m.p2 && !busy[m.p1] && !busy[m.p2]; })
        .sort(function (a, b) { return a.seq - b.seq; })[0];
    }

    function fillTables(t, who, onlyTable) {
      var cfg = cfgOf(t), ms = tMatches(t.id), called = [];
      var tables = onlyTable ? [onlyTable] : freeTables(cfg, ms);
      tables.forEach(function (tb) {
        if (!freeTables(cfg, ms).some(function (x) { return x === tb; })) return;
        var m = nextReady(ms, busyPlayers(ms)); if (!m) return;
        callOne(t, cfg, m, tb, who, true); called.push(m);
      });
      return called;
    }

    function callOne(t, cfg, m, table, who, notify) {
      m.status = 'live'; m.table = String(table); m.calledAt = P.now(); m.updated = P.now(); m.updatedBy = who || '';
      store.update('Matches', m);
      if (notify && cfg.notifyOnCall) notifyMatch(t, m);
    }

    function portalLink(e) { return P.siteUrl() + '#/p/' + e.key; }

    function notifyMatch(t, m) {
      var es = {}, ps = {}; tEntries(t.id).forEach(function (e) { es[e.id] = e; });
      store.list('Players').forEach(function (p) { ps[p.id] = p; });
      var msgs = [];
      [[m.p1, m.p2], [m.p2, m.p1]].forEach(function (pair) {
        var e = es[pair[0]], o = es[pair[1]]; if (!e) return;
        var p = ps[e.pid], op = o ? ps[o.pid] : null;
        var text = t.name + ': your match vs ' + playerName(op) + ' is on TABLE ' + m.table + ' (' + (m.stage === 'RR' ? m.race + '-game round robin match' : E.raceText(cfgOf(t), m.race)) + '). Score it here: ' + portalLink(e);
        msgs.push({ name: playerName(p), email: p && p.email, phone: p && p.phone, subject: 'Table ' + m.table + ' — your match is up', text: text });
      });
      try { return P.notify(msgs); } catch (x) { return []; }
    }

    function callMatch(a, me) {
      var m = need('Matches', a.id), t = need('Tournaments', m.tid), cfg = cfgOf(t);
      if (m.status !== 'ready' && m.status !== 'live') err('This match isn\'t ready to be called');
      var table = String(a.table || '');
      if (!table) { var ft = freeTables(cfg, tMatches(t.id)); if (!ft.length) err('No free tables'); table = ft[0]; }
      var clash = tMatches(t.id).filter(function (x) { return x.status === 'live' && x.table === table && x.id !== m.id; })[0];
      if (clash) err('Table ' + table + ' is in use (' + clash.label + ')');
      callOne(t, cfg, m, table, me.name, a.notify !== false);
      touch(t);
      return { ok: true, table: table, messages: messagesFor(t, m) };
    }

    function messagesFor(t, m) {
      var es = {}; tEntries(t.id).forEach(function (e) { es[e.id] = e; });
      var ps = {}; store.list('Players').forEach(function (p) { ps[p.id] = p; });
      return [m.p1, m.p2].map(function (id) { var e = es[id]; if (!e) return null; var p = ps[e.pid];
        return { name: playerName(p), phone: p && p.phone, email: p && p.email, link: portalLink(e) }; }).filter(Boolean);
    }

    function uncallMatch(a, me) {
      var m = need('Matches', a.id), t = need('Tournaments', m.tid);
      if (m.status !== 'live') err('Match is not on a table');
      m.status = 'ready'; m.table = ''; store.update('Matches', m); touch(t);
      return { ok: true };
    }

    function fillTablesAction(a, me) {
      var t = need('Tournaments', a.tid); var c = fillTables(t, me.name); touch(t); return { called: c.length };
    }

    function notifyLinks(a, me) {
      var t = need('Tournaments', a.tid), ps = {};
      store.list('Players').forEach(function (p) { ps[p.id] = p; });
      var es = tEntries(t.id).filter(function (e) { return !a.ids || a.ids.indexOf(e.id) >= 0; });
      var msgs = es.map(function (e) { var p = ps[e.pid];
        return { name: playerName(p), email: p && p.email, phone: p && p.phone, subject: t.name + ' — your player link',
          text: 'You\'re entered in ' + t.name + '. Your matches, table calls and scoring are all here: ' + portalLink(e) + ' — keep this link handy.' }; });
      var res = []; try { res = P.notify(msgs); } catch (x) { }
      return { sent: res, count: msgs.length };
    }

    /* ---------------- scoring ---------------- */
    function canScore(m, key, session) {
      if (isDirector(session)) return 'director';
      if (!key) return '';
      var e = store.list('Entries').filter(function (x) { return x.key === key && x.tid === m.tid; })[0];
      if (e && (e.id === m.p1 || e.id === m.p2)) return e.id;
      return '';
    }

    function scoreMatch(a, session) {
      var m = need('Matches', a.id), t = need('Tournaments', m.tid), cfg = cfgOf(t);
      var who = canScore(m, a.key, session);
      if (!who) err('You can only score your own matches');
      var dir = who === 'director';
      if (t.status === 'complete') err('This tournament is finished');
      if (!m.p1 || !m.p2 || m.p1 === 'BYE' || m.p2 === 'BYE') err('This match is not ready yet');
      if (m.status === 'void') err('This match is not needed');
      if (m.status === 'waiting') err('This match is not ready yet');
      var all = tMatches(t.id);
      var games = sanitizeGames(a.games || [], m.stage);
      var test = { stage: m.stage, race: m.race, games: games }, c = E.computeMatch(test, cfg);
      if (c.error) err(c.error);
      var wasDone = m.status === 'done';
      // block edits that would change an already-started downstream match
      if (m.stage !== 'RR' && wasDone) {
        var newWin = c.complete ? (c.winnerSide === 1 ? m.p1 : m.p2) : '';
        if (newWin !== m.winner) {
          var down = all.filter(function (x) { return (x.src1 === 'W:' + m.id || x.src2 === 'W:' + m.id || x.src1 === 'L:' + m.id || x.src2 === 'L:' + m.id || x.src1 === 'RESET:' + m.id) && (x.games || []).length; });
          if (down.length) err('The next match (' + down[0].label + ') has already started — ask the director to reset it first');
        }
      }
      m.games = games;
      if (!m.startedAt && games.length) m.startedAt = P.now();
      if (m.status === 'ready' && games.length) { m.status = 'live'; }
      m.s1 = c.s1; m.s2 = c.s2; m.e1 = c.e1; m.e2 = c.e2; m.updated = P.now(); m.updatedBy = dir ? 'director' : who;
      var freed = '';
      if (m.stage === 'RR') {
        E.refreshRR(m, cfg);
        if (m.status === 'done') { if (!wasDone) { m.doneAt = P.now(); freed = m.table; } }
        store.update('Matches', m);
      } else {
        var oldStatuses = {}; all.forEach(function (x) { oldStatuses[x.id] = x.status + '|' + x.p1 + '|' + x.p2; });
        E.resolve(all, cfg);
        if (m.status === 'done' && !wasDone) { m.doneAt = P.now(); freed = m.table; }
        if (m.status !== 'done' && wasDone) m.doneAt = '';
        all.forEach(function (x) { if (x === m || oldStatuses[x.id] !== x.status + '|' + x.p1 + '|' + x.p2) { if (x.status === 'bye' || x.status === 'void') x.table = ''; store.update('Matches', x); } });
      }
      if (freed && m.status === 'done') {
        if (cfg.autoCall) { var mm = tMatches(t.id); var tbl = freed; var nx = nextReady(mm, busyPlayers(mm)); if (nx) callOne(t, cfg, nx, tbl, 'auto', true); }
      }
      if (m.stage !== 'RR') {
        var ch = E.champion(tMatches(t.id)); if (ch && t.champion !== ch) t.champion = ch; else if (!ch) t.champion = '';
      }
      touch(t);
      log(dir ? 'director' : 'player', 'score', m.id + ' ' + c.s1 + '-' + c.s2);
      return { match: m };
    }

    function sanitizeGames(g, stage) {
      if (!Array.isArray(g)) return [];
      return g.slice(0, 200).map(function (x) {
        if (stage === 'RR') return { a: side(x.a), b: side(x.b) };
        return { w: Number(x.w) === 2 ? 2 : (Number(x.w) === 1 ? 1 : 0), e: x.e ? 1 : 0, n: Math.max(0, Math.min(7, Number(x.n) || 0)) };
      });
      function side(s) { s = s || {}; var r = ['W', 'E', 'R', 'L'].indexOf(s.r) >= 0 ? s.r : 'L'; return { r: r, n: r === 'L' ? Math.max(0, Math.min(7, Number(s.n) || 0)) : 0 }; }
    }

    function editMatch(a, me) {
      var m = need('Matches', a.id), t = need('Tournaments', m.tid);
      if (a.race !== undefined && a.race !== '') { m.race = Number(a.race); }
      if (a.table !== undefined) m.table = String(a.table);
      if (a.reset) {
        var all = tMatches(t.id);
        var down = all.filter(function (x) { return (x.src1 === 'W:' + m.id || x.src2 === 'W:' + m.id || x.src1 === 'L:' + m.id || x.src2 === 'L:' + m.id || x.src1 === 'RESET:' + m.id) && (x.games || []).length; });
        if (down.length) err('Reset ' + down[0].label + ' first');
        m.games = []; m.s1 = m.s2 = m.e1 = m.e2 = 0; m.doneAt = ''; m.startedAt = '';
        if (m.stage === 'RR') { m.status = m.table ? 'live' : 'ready'; m.winner = m.loser = ''; store.update('Matches', m); }
        else { if (m.status === 'done') m.status = m.table ? 'live' : 'ready'; E.resolve(all, cfgOf(t)); all.forEach(function (x) { store.update('Matches', x); }); }
      } else store.update('Matches', m);
      touch(t); log(me.name, 'editMatch', m.id);
      return { ok: true };
    }

    /* ---------------- finish ---------------- */
    function recalcPayouts(t) {
      var cfg = cfgOf(t), es = tEntries(t.id), res = E.payouts(cfg, es);
      es.forEach(function (e) { var v = res.payouts[e.id]; e.payout = v ? v : ''; store.update('Entries', e); });
      return res;
    }

    function computePlaces(t) {
      var cfg = cfgOf(t), es = tEntries(t.id), ms = tMatches(t.id);
      var st = cfg.format === 'RR' ? E.standings(cfg, es, ms) : null;
      var pl = E.placements(cfg, es, ms, st);
      es.forEach(function (e) { e.place = pl[e.id] || ''; e.rankPts = E.rankPoints(e.place); store.update('Entries', e); });
      return pl;
    }

    function previewFinish(a, me) {
      var t = need('Tournaments', a.tid); computePlaces(t); var r = recalcPayouts(t); touch(t); return r;
    }

    function finalize(a, me) {
      var t = need('Tournaments', a.tid);
      var ms = tMatches(t.id), ch = E.champion(ms);
      if (!ch && !a.force) err('There is no champion yet');
      computePlaces(t); recalcPayouts(t);
      t.champion = ch || ''; t.status = 'complete';
      ms.forEach(function (m) { if (m.status === 'live') { m.status = m.games && m.games.length ? 'done' : 'ready'; } m.table = m.status === 'live' ? '' : m.table; store.insert('MatchHistory', m); store.remove('Matches', m.id); });
      touch(t); log(me.name, 'finalize', t.name);
      return { ok: true };
    }

    function reopen(a, me) {
      var t = need('Tournaments', a.tid);
      if (t.status !== 'complete') err('Tournament is not complete');
      store.list('MatchHistory').filter(function (m) { return m.tid === t.id; }).forEach(function (m) { store.insert('Matches', m); store.remove('MatchHistory', m.id); });
      t.status = cfgOf(t).format === 'RR' ? 'finals' : 'bracket'; touch(t); log(me.name, 'reopen', t.name);
      return { ok: true };
    }

    function deleteTournament(a, me) {
      var t = need('Tournaments', a.id);
      if (a.confirm !== t.name) err('Type the tournament name exactly to confirm');
      tMatches(t.id).forEach(function (m) { store.remove('Matches', m.id); });
      store.list('MatchHistory').filter(function (m) { return m.tid === t.id; }).forEach(function (m) { store.remove('MatchHistory', m.id); });
      tEntries(t.id).forEach(function (e) { store.remove('Entries', e.id); });
      store.remove('Tournaments', t.id); P.cacheDel('t:' + t.id); P.cacheDel('list'); log(me.name, 'deleteTournament', t.name);
      return { ok: true };
    }

    /* ---------------- history ---------------- */
    function history() {
      var players = store.list('Players').map(function (p) { return { id: p.id, name: playerName(p), active: E.truthy(p.active) }; });
      var ts = store.list('Tournaments').filter(function (t) { return t.status === 'complete'; }).map(tPublic);
      var tset = {}; ts.forEach(function (t) { tset[t.id] = 1; });
      var entries = store.list('Entries').filter(function (e) { return tset[e.tid]; }).map(function (e) {
        return { id: e.id, tid: e.tid, pid: e.pid, place: e.place, payout: e.payout, rankPts: e.rankPts, wildcard: E.truthy(e.wildcard), seed: e.seed }; });
      var matches = store.list('MatchHistory').filter(function (m) { return tset[m.tid] && m.status === 'done'; }).map(function (m) {
        return { id: m.id, tid: m.tid, stage: m.stage, round: m.round, p1: m.p1, p2: m.p2, s1: m.s1, s2: m.s2, e1: m.e1, e2: m.e2, winner: m.winner, games: m.games, race: m.race, doneAt: m.doneAt }; });
      return { players: players, tournaments: ts, entries: entries, matches: matches };
    }

    /* ---------------- router ---------------- */
    var PUBLIC = {
      ping: function () { return { ok: true, time: P.now() }; },
      login: login,
      listTournaments: function (a, s) {
        var dir = isDirector(s);
        var list = store.list('Tournaments').map(tPublic).sort(function (x, y) { return String(y.date).localeCompare(String(x.date)) || String(y.updated).localeCompare(String(x.updated)); });
        var counts = {}; store.list('Entries').forEach(function (e) { counts[e.tid] = (counts[e.tid] || 0) + 1; });
        list.forEach(function (t) { t.players = counts[t.id] || 0; });
        return { tournaments: dir ? list : list.slice(0, 60) };
      },
      getTournament: function (a, s) {
        var dir = isDirector(s);
        if (!dir) { var c = P.cacheGet('t:' + a.id); if (c) return c; }
        var r = tournamentPayload(a.id, dir);
        if (!dir) P.cachePut('t:' + a.id, r);
        return r;
      },
      portal: function (a) {
        var e = store.list('Entries').filter(function (x) { return x.key === a.key; })[0];
        if (!e) err('This player link is not valid');
        var r = tournamentPayload(e.tid, false); r.me = e.id; return r;
      },
      scoreMatch: function (a, s) { return scoreMatch(a, s); },
      history: function () { return history(); },
      logout: function (a, s) { if (s) P.sessionDel(s); return { ok: true }; }
    };
    var DIRECTOR = {
      me: function (a, me) { return { name: me.name }; },
      listPlayers: function () { return { players: store.list('Players') }; },
      savePlayer: savePlayer,
      listDirectors: function () { return { directors: store.list('Directors').map(function (d) { return { id: d.id, username: d.username, name: d.name, email: d.email, active: E.truthy(d.active) }; }) }; },
      saveDirector: saveDirector,
      listTemplates: function () { return { templates: store.list('Templates') }; },
      saveTemplate: function (a, me) {
        if (!a.name) err('Template name is required');
        var tp = a.id ? need('Templates', a.id) : { id: P.uuid(), created: P.now() };
        tp.name = a.name; tp.config = E.defaults(a.config || {});
        if (a.id) store.update('Templates', tp); else store.insert('Templates', tp);
        return { id: tp.id };
      },
      deleteTemplate: function (a) { need('Templates', a.id); store.remove('Templates', a.id); return { ok: true }; },
      saveTournament: saveTournament, deleteTournament: deleteTournament,
      addEntries: addEntries, removeEntry: removeEntry, updateEntry: updateEntry,
      quickAddPlayer: function (a, me) { var r = savePlayer(a, me); addEntries({ tid: a.tid, pids: [r.player.id], paid: a.paid }, me); return r; },
      drawGroups: drawGroups, startRoundRobin: startRoundRobin, startBracket: startBracket,
      generateFinals: generateFinals, undoFinals: undoFinals,
      callMatch: callMatch, uncallMatch: uncallMatch, fillTables: fillTablesAction, editMatch: editMatch,
      notifyLinks: notifyLinks, matchMessages: function (a) { var m = need('Matches', a.id); return { messages: messagesFor(need('Tournaments', m.tid), m) }; },
      previewFinish: previewFinish, finalize: finalize, reopen: reopen
    };
    var WRITES = { login: 0, scoreMatch: 1 };

    function handle(action, args, session) {
      args = args || {};
      var fn = PUBLIC[action], dirFn = DIRECTOR[action];
      if (!fn && !dirFn) err('Unknown action: ' + action);
      var write = !!dirFn && !/^(me|list)/.test(action) || WRITES[action];
      return P.lock(write, function () {
        var res = fn ? fn(args, session) : dirFn(args, director(session));
        if (write) store.commit();
        return res;
      });
    }

    return { handle: handle };
  }

  return { create: create, SCHEMA: SCHEMA, JSON_FIELDS: JSON_FIELDS };
})();
if (typeof module !== 'undefined') module.exports = Service;
