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
    Directors: ['id', 'username', 'name', 'email', 'salt', 'hash', 'active', 'created', 'mustChange'],
    Tournaments: ['id', 'name', 'date', 'status', 'gameType', 'format', 'config', 'champion', 'created', 'createdBy', 'updated'],
    Entries: ['id', 'tid', 'pid', 'paid', 'amount', 'grp', 'seed', 'wildcard', 'tb', 'place', 'payout', 'payoutOverride', 'paidOut', 'rankPts', 'key', 'created', 'members', 'team', 'role', 'hcp'],
    Matches: ['id', 'tid', 'seq', 'stage', 'grp', 'round', 'pos', 'label', 'src1', 'src2', 'p1', 'p2', 'race', 'table', 'status', 'games',
      's1', 's2', 'e1', 'e2', 'winner', 'loser', 'calledAt', 'startedAt', 'doneAt', 'updated', 'updatedBy', 'lineup', 'plan', 'planOrder', 'time'],
    MatchHistory: null,
    Templates: ['id', 'name', 'config', 'created'],
    Invites: ['id', 'token', 'name', 'email', 'invitedBy', 'created', 'expires', 'usedBy', 'usedAt'],
    Log: ['id', 'ts', 'who', 'action', 'detail']
  };
  SCHEMA.MatchHistory = SCHEMA.Matches;
  var JSON_FIELDS = { config: 1, games: 1, members: 1, lineup: 1 };
  var STATUS_LABEL = { registration: 'Registration', drawn: 'Drawn — starting soon', roundrobin: 'Round robin', finals: 'Finals', bracket: 'In progress', complete: 'Complete' };

  function create(store, P) {
    var E = Engine;
    function err(msg) { var e = new Error(msg); e.userError = true; throw e; }
    function byId(table, id) { var r = store.list(table).filter(function (x) { return String(x.id) === String(id); })[0]; return r; }
    function need(table, id) { var r = byId(table, id); if (!r) err(table.replace(/s$/, '') + ' not found'); return r; }
    function cfgOf(t) { return E.defaults(t.config || {}); }
    function tMatches(tid) { return store.list('Matches').filter(function (m) { return m.tid === tid; }); }
    function tEntries(tid) { return store.list('Entries').filter(function (e) { return e.tid === tid; }); }
    function playerName(p) { return p ? (p.first + ' ' + p.last).trim() : '?'; }
    function membersOf(e) { return Array.isArray(e.members) && e.members.length ? e.members : [{ pid: e.pid, role: e.role || '' }]; }
    function playersMap() { var m = {}; store.list('Players').forEach(function (p) { m[p.id] = p; }); return m; }
    function entryName(e, ps) {
      if (e.team) return e.team;
      var mem = membersOf(e);
      if (mem.length <= 2) return mem.map(function (x) { return playerName(ps[x.pid]); }).join(' / ');
      var f = mem.map(function (x) { var p = ps[x.pid]; return p ? p.first : '?'; });
      return f.slice(0, -1).join(', ') + ' & ' + f[f.length - 1];
    }
    function requiredSize(cfg) { return cfg.teamMode === 'doubles' ? 2 : cfg.teamMode === 'teams' ? (cfg.teamSize || 2) : 1; }
    function checkTeamsReady(cfg, es) {
      if (cfg.teamMode === 'singles') return;
      var need = requiredSize(cfg), bad = es.filter(function (e) { var n = membersOf(e).length; return cfg.teamMode === 'doubles' ? n !== 2 : n < need; });
      if (bad.length) err(bad.length + ' entr' + (bad.length === 1 ? 'y is' : 'ies are') + ' not in a full ' + (cfg.teamMode === 'doubles' ? 'pair' : 'team') + ' yet — pair them up or remove them first');
    }
    function log(who, action, detail) { store.insert('Log', { id: P.uuid(), ts: P.now(), who: who || 'player', action: action, detail: String(detail || '').slice(0, 400) }); }
    function touch(t) { t.updated = P.now(); store.update('Tournaments', t); P.cacheDel('t:' + t.id); P.cacheDel('list'); }

    /* ---------------- auth ----------------
       The OWNER login (you) lives in Apps Script's private settings — never in the Directors tab.
       Other directors live in the Directors tab. New directors get a temporary password and must change it. */
    function owner() { try { return P.ownerGet ? P.ownerGet() : null; } catch (x) { return null; } }
    function director(session) {
      if (!session) err('Please sign in');
      var s = P.sessionGet(session); if (!s) err('Your sign-in has expired — please sign in again');
      P.sessionPut(session, s);
      return s;
    }
    function isDirector(session) { try { var s = session ? director(session) : null; return !!s && !s.mustChange; } catch (e) { return false; } }
    function checkPw(pw) { if (!pw || String(pw).length < 6) err('Password must be at least 6 characters'); }
    function setPw(d, pw) { checkPw(pw); d.salt = P.token(); d.hash = P.hash(d.salt + ':' + pw); }

    function login(a) {
      var u = String(a.username || '').trim().toLowerCase(), o = owner(), tok = P.token();
      if (o && String(o.username).toLowerCase() === u) {
        if (P.hash(o.salt + ':' + a.password) !== o.hash) err('Wrong username or password');
        P.sessionPut(tok, { did: 'owner', name: o.name || o.username, owner: true });
        return { session: tok, name: o.name || o.username, owner: true, mustChange: false };
      }
      var d = store.list('Directors').filter(function (x) { return String(x.username).toLowerCase() === u && E.truthy(x.active); })[0];
      if (!d || P.hash(d.salt + ':' + a.password) !== d.hash) err('Wrong username or password');
      var mc = E.truthy(d.mustChange);
      P.sessionPut(tok, { did: d.id, name: d.name || d.username, owner: false, mustChange: mc });
      return { session: tok, name: d.name || d.username, owner: false, mustChange: mc };
    }

    function changePassword(a, me, session) {
      checkPw(a.newPassword);
      if (a.newPassword === a.current) err('Choose a new password that is different from the temporary one');
      if (me.owner) {
        var o = owner(); if (!o) err('Owner login not found');
        if (P.hash(o.salt + ':' + a.current) !== o.hash) err('Your current password is wrong');
        o.salt = P.token(); o.hash = P.hash(o.salt + ':' + a.newPassword); P.ownerSet(o);
      } else {
        var d = need('Directors', me.did);
        if (P.hash(d.salt + ':' + a.current) !== d.hash) err('Your current password is wrong');
        setPw(d, a.newPassword); d.mustChange = false; store.update('Directors', d);
      }
      me.mustChange = false; P.sessionPut(session, me);
      log(me.name, 'changePassword', '');
      return { ok: true };
    }

    function loginEmail(d, tempPw, me, hallName) {
      var link = P.siteUrl() + '#/admin', hall = hallName || 'the pool hall';
      var text = 'Hi ' + (d.name || d.username) + ',\n\n' + me.name + ' has set you up as a tournament director for ' + hall + '.\n\n' +
        'Sign in here: ' + link + '\n\nUsername: ' + d.username + '\nTemporary password: ' + tempPw + '\n\n' +
        'The first time you sign in you\'ll be asked to choose your own password.';
      var res = [];
      if (d.email) { try { res = P.notify([{ name: d.name, email: d.email, subject: 'Your ' + hall + ' tournament director login', text: text }]); } catch (x) { } }
      return { emailed: !!(res[0] && res[0].email), message: text };
    }

    function ownerOnly(me) { if (!me.owner) err('Only the owner can add or change directors'); }

    function saveDirector(a, me) {
      var d = a.id ? need('Directors', a.id) : null;
      var uname = String(a.username || '').trim().toLowerCase();
      if (!uname) err('Username is required');
      if (!/^[a-z0-9._-]{3,30}$/.test(uname)) err('Username: 3–30 letters/numbers, no spaces');
      var o = owner();
      var clash = (o && String(o.username).toLowerCase() === uname) || store.list('Directors').some(function (x) { return String(x.username).toLowerCase() === uname && (!d || x.id !== d.id); });
      if (clash) err('That username is taken');
      var out = { };
      if (!d) {
        d = { id: P.uuid(), username: uname, name: a.name || uname, email: String(a.email || '').trim(), active: true, created: P.now(), mustChange: !!a.temporary };
        setPw(d, a.password);
        store.insert('Directors', d);
        if (a.sendEmail) out = loginEmail(d, a.password, me, a.hallName);
      } else {
        d.username = uname; d.name = a.name || uname; d.email = String(a.email || '').trim(); if (a.active !== undefined) d.active = !!a.active;
        if (a.password) { setPw(d, a.password); d.mustChange = !!a.temporary; if (a.sendEmail) out = loginEmail(d, a.password, me, a.hallName); }
        store.update('Directors', d);
      }
      log(me && me.name, 'saveDirector', uname);
      out.id = d.id; out.username = d.username;
      return out;
    }

    /* ---------------- director invites ---------------- */
    function inviteDirector(a, me) {
      var name = String(a.name || '').trim(), email = String(a.email || '').trim();
      if (!name) err('Name is required');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) err('Enter a valid email address');
      var inv = { id: P.uuid(), token: P.token(), name: name, email: email, invitedBy: me.name, created: P.now(),
        expires: new Date(Date.now() + 7 * 864e5).toISOString(), usedBy: '', usedAt: '' };
      store.insert('Invites', inv);
      var link = P.siteUrl() + '#/invite/' + inv.token;
      var text = 'Hi ' + name + ',\n\n' + me.name + ' has invited you to be a tournament director.\n\n' +
        'Open this link to choose your username and password:\n' + link + '\n\nThe link works once and expires in 7 days.';
      var sent = [];
      try { sent = P.notify([{ name: name, email: email, subject: 'You\'re invited to be a tournament director', text: text }]); } catch (x) { }
      log(me.name, 'inviteDirector', email);
      return { link: link, emailed: !!(sent[0] && sent[0].email) };
    }
    function findInvite(token) {
      var inv = store.list('Invites').filter(function (x) { return x.token === token; })[0];
      if (!inv) err('This invite link is not valid');
      if (inv.usedBy) err('This invite has already been used — sign in under Director');
      if (String(inv.expires) < P.now()) err('This invite has expired — ask for a new one');
      return inv;
    }
    function acceptInvite(a) {
      var inv = findInvite(a.token);
      var r = saveDirector({ username: a.username, name: a.name || inv.name, email: inv.email, password: a.password }, { name: 'invite' });
      inv.usedBy = String(a.username).trim().toLowerCase(); inv.usedAt = P.now(); store.update('Invites', inv);
      var tok = P.token(); P.sessionPut(tok, { did: r.id, name: a.name || inv.name });
      return { session: tok, name: a.name || inv.name };
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
      var t = need('Tournaments', tid), players = playersMap();
      var entries = tEntries(tid).map(function (e) {
        var mem = membersOf(e), p = players[mem[0].pid];
        var o = { id: e.id, pid: mem[0].pid, name: entryName(e, players), first: e.team ? e.team : (mem.length > 1 ? entryName(e, players) : (p ? p.first : '')), last: p ? p.last : '',
          team: e.team || '', size: mem.length, role: mem.length === 1 ? (mem[0].role || '') : '',
          members: mem.map(function (x) { var mp = players[x.pid]; var mo = { pid: x.pid, name: playerName(mp), role: x.role || '' };
            if (dir) { mo.phone = mp ? mp.phone : ''; mo.email = mp ? mp.email : ''; } return mo; }),
          grp: e.grp, seed: e.seed, wildcard: E.truthy(e.wildcard), tb: e.tb, place: e.place, payout: e.payout, hcp: Number(e.hcp) || 0 };
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
        if (started && (old.format !== cfg.format || old.gameType !== cfg.gameType || old.raceType !== cfg.raceType || old.teamMode !== cfg.teamMode)) err('Format, game, entry type and race type can\'t change once play has started');
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
      var have = {}; tEntries(t.id).forEach(function (e) { membersOf(e).forEach(function (x) { have[x.pid] = 1; }); });
      var added = 0, role = a.role === 'Jack' || a.role === 'Jill' ? a.role : '';
      if (cfgOf(t).jackJill && !role) err('Choose Jack or Jill for this player');
      (a.pids || []).forEach(function (pid) {
        if (have[pid] || !byId('Players', pid)) return;
        store.insert('Entries', { id: P.uuid(), tid: t.id, pid: pid, paid: !!a.paid, amount: '', grp: '', seed: '', wildcard: false, tb: '', place: '', payout: '',
          payoutOverride: '', paidOut: false, rankPts: '', key: P.token().slice(0, 10), created: P.now(), members: [{ pid: pid, role: role }], team: '', role: role });
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
      ['paid', 'amount', 'seed', 'tb', 'payoutOverride', 'paidOut', 'grp', 'team', 'hcp'].forEach(function (k) { if (a[k] !== undefined) e[k] = a[k]; });
      if (a.payoutOverride !== undefined || a.paid !== undefined || a.amount !== undefined) recalcPayouts(t);
      store.update('Entries', e); touch(t);
      return { ok: true };
    }

    /* ---------------- pairs & teams ---------------- */
    function mergeEntries(t, list, name) {
      var cfg = cfgOf(t), first = list[0], mem = [];
      list.forEach(function (e) { mem = mem.concat(membersOf(e)); });
      if (cfg.teamMode === 'doubles' && mem.length !== 2) err('A pair needs exactly 2 players');
      if (cfg.jackJill) {
        var jk = mem.filter(function (x) { return x.role === 'Jack'; }).length, jl = mem.filter(function (x) { return x.role === 'Jill'; }).length;
        if (jk !== 1 || jl !== 1) err('A Jack & Jill pair needs one Jack and one Jill');
      }
      var amounts = list.filter(function (e) { return e.amount !== '' && e.amount != null; });
      first.members = mem; first.pid = mem[0].pid; first.role = ''; first.team = name || '';
      first.paid = list.every(function (e) { return E.truthy(e.paid); });
      first.amount = amounts.length ? amounts.reduce(function (s, e) { return s + Number(e.amount); }, 0) : '';
      store.update('Entries', first);
      list.slice(1).forEach(function (e) { store.remove('Entries', e.id); });
      return first;
    }

    function makeTeam(a, me) {
      var t = need('Tournaments', a.tid);
      if (t.status !== 'registration') err('Teams can only change during registration');
      if (cfgOf(t).teamMode === 'singles') err('This is a singles tournament — change "Entry type" in Settings first');
      var list = (a.ids || []).map(function (id) { return need('Entries', id); });
      if (list.length < 2) err('Select at least 2 players or teams');
      var e = mergeEntries(t, list, String(a.name || '').trim());
      touch(t); log(me.name, 'makeTeam', e.id);
      return { id: e.id };
    }

    function splitTeam(a, me) {
      var e = need('Entries', a.id), t = need('Tournaments', e.tid);
      if (t.status !== 'registration') err('Teams can only change during registration');
      var mem = membersOf(e); if (mem.length < 2) err('Nothing to split');
      var paid = E.truthy(e.paid);
      mem.slice(1).forEach(function (x) {
        store.insert('Entries', { id: P.uuid(), tid: t.id, pid: x.pid, paid: paid, amount: '', grp: '', seed: '', wildcard: false, tb: '', place: '', payout: '',
          payoutOverride: '', paidOut: false, rankPts: '', key: P.token().slice(0, 10), created: P.now(), members: [x], team: '', role: x.role || '' });
      });
      e.members = [mem[0]]; e.pid = mem[0].pid; e.role = mem[0].role || ''; e.team = ''; e.amount = '';
      store.update('Entries', e); touch(t); log(me.name, 'splitTeam', e.id);
      return { ok: true };
    }

    function drawTeams(a, me) {
      var t = need('Tournaments', a.tid), cfg = cfgOf(t);
      if (t.status !== 'registration') err('Teams can only change during registration');
      if (cfg.teamMode === 'singles') err('This is a singles tournament');
      var pool = tEntries(t.id).filter(function (e) { return membersOf(e).length === 1; }), made = 0;
      if (cfg.jackJill) {
        var jacks = E.shuffle(pool.filter(function (e) { return membersOf(e)[0].role === 'Jack'; }), P.random);
        var jills = E.shuffle(pool.filter(function (e) { return membersOf(e)[0].role === 'Jill'; }), P.random);
        for (var i = 0; i < Math.min(jacks.length, jills.length); i++) { mergeEntries(t, [jacks[i], jills[i]], ''); made++; }
      } else {
        var size = requiredSize(cfg), sh = E.shuffle(pool, P.random);
        for (var j = 0; j + size <= sh.length; j += size) { mergeEntries(t, sh.slice(j, j + size), ''); made++; }
      }
      var left = tEntries(t.id).filter(function (e) { return membersOf(e).length === 1; }).length;
      touch(t); log(me.name, 'drawTeams', made + ' made');
      return { made: made, leftover: left };
    }

    function drawGroups(a, me) {
      var t = need('Tournaments', a.tid), cfg = cfgOf(t);
      if (t.status !== 'registration') err('Groups are already locked in');
      var es = tEntries(t.id); checkTeamsReady(cfg, es); if (es.length < 3) err('Need at least 3 entries');
      var plan = E.rrPlan(cfg, es.length), map = E.dealGroups(es.map(function (e) { return e.id; }), plan.groups, P.random);
      es.forEach(function (e) { e.grp = map[e.id]; store.update('Entries', e); });
      touch(t); log(me.name, 'drawGroups', t.name);
      return { plan: plan };
    }

    function startRoundRobin(a, me) {
      var t = need('Tournaments', a.tid), cfg = cfgOf(t);
      if (cfg.format !== 'RR') err('This tournament is not a round robin');
      if (t.status !== 'registration') err('Round robin has already started');
      var es = tEntries(t.id); checkTeamsReady(cfg, es);
      if (es.some(function (e) { return !e.grp; })) err('Draw the groups first');
      var groups = {}; es.forEach(function (e) { (groups[e.grp] = groups[e.grp] || []).push(e.id); });
      var seq = 1;
      Object.keys(groups).sort().forEach(function (g) {
        E.roundRobinPairs(groups[g]).forEach(function (pr, i) {
          store.insert('Matches', { id: t.id + '-' + g + '-' + (i + 1), tid: t.id, seq: seq++, stage: 'RR', grp: g, round: pr.round, pos: i, label: 'Group ' + g + ' · Match ' + (i + 1),
            src1: 'E:' + pr.a, src2: 'E:' + pr.b, p1: pr.a, p2: pr.b, race: cfg.teamMode === 'teams' ? cfg.raceRR : cfg.rrGames, table: '', status: 'ready', games: [], s1: 0, s2: 0, e1: 0, e2: 0,
            winner: '', loser: '', calledAt: '', startedAt: '', doneAt: '', updated: P.now(), updatedBy: '', plan: '', planOrder: '', time: '' });
        });
      });
      // interleave groups so early matches spread across all groups
      var ms = tMatches(t.id), idx = {};
      ms.sort(function (x, y) { return (x.round - y.round) || (x.pos - y.pos); });
      ms.forEach(function (m) { var k = m.grp + '|' + m.round; idx[k] = (idx[k] || 0) + 1; m._i = idx[k]; });
      ms.sort(function (x, y) { return (x.round - y.round) || (x._i - y._i) || (x.grp < y.grp ? -1 : 1); });
      ms.forEach(function (m) { delete m._i; });
      ms.forEach(function (m, i) { m.seq = i + 1; store.update('Matches', m); });
      t.status = 'drawn'; touch(t); log(me.name, 'drawSchedule', t.name);
      return { matches: ms.length };
    }

    function rankingFor(pids) {
      var cutoff = new Date(Date.now() - 365 * 864e5).toISOString(), done = {};
      store.list('Tournaments').forEach(function (t) { if (t.status === 'complete' && String(t.created) >= cutoff) done[t.id] = 1; });
      var pts = {}; pids.forEach(function (p) { pts[p] = 0; });
      store.list('Entries').forEach(function (e) { if (done[e.tid]) membersOf(e).forEach(function (x) { if (pts[x.pid] !== undefined) pts[x.pid] += Number(e.rankPts) || 0; }); });
      return pts;
    }

    function startBracket(a, me) {
      var t = need('Tournaments', a.tid), cfg = cfgOf(t);
      if (cfg.format === 'RR') err('Use "Generate finals" for round robin tournaments');
      if (t.status !== 'registration') err('The bracket has already started');
      var es = tEntries(t.id); checkTeamsReady(cfg, es); if (es.length < 2) err('Need at least 2 entries');
      var ordered;
      if (cfg.seeding === 'manual') {
        ordered = es.slice().sort(function (x, y) { return (Number(x.seed) || 999) - (Number(y.seed) || 999); });
      } else if (cfg.seeding === 'ranking') {
        var all = []; es.forEach(function (e) { membersOf(e).forEach(function (x) { all.push(x.pid); }); });
        var rp = rankingFor(all), score = function (e) { return membersOf(e).reduce(function (s, x) { return s + (rp[x.pid] || 0); }, 0); };
        ordered = E.shuffle(es, P.random).sort(function (x, y) { return score(y) - score(x); });
      } else ordered = E.shuffle(es, P.random);
      ordered.forEach(function (e, i) { e.seed = i + 1; store.update('Entries', e); });
      var ms = E.buildBracket(t.id, ordered.map(function (e) { return e.id; }), cfg, cfg.format, 1000);
      E.resolve(ms, cfg);
      ms.forEach(function (m) { finishFields(m); store.insert('Matches', m); });
      t.status = 'drawn'; touch(t); log(me.name, 'drawBracket', t.name);
      return { matches: ms.length };
    }

    function finishFields(m) {
      m.s1 = m.s1 || 0; m.s2 = m.s2 || 0; m.e1 = m.e1 || 0; m.e2 = m.e2 || 0;
      m.calledAt = m.calledAt || ''; m.startedAt = m.startedAt || ''; m.doneAt = m.doneAt || ''; m.updated = P.now(); m.updatedBy = m.updatedBy || '';
      m.plan = m.plan || ''; m.planOrder = m.planOrder || ''; m.time = m.time || '';
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
    /* next match for a table: matches planned for this table first (queue order), then unplanned ones.
       Matches planned for a different table are left for that table. */
    function nextReady(ms, busy, table) {
      var free = ms.filter(function (m) { return m.status === 'ready' && m.p1 && m.p2 && !busy[m.p1] && !busy[m.p2]; });
      var mine = free.filter(function (m) { return table && String(m.plan) === String(table); })
        .sort(function (a, b) { return (Number(a.planOrder) || 999) - (Number(b.planOrder) || 999) || a.seq - b.seq; });
      if (mine.length) return mine[0];
      return free.filter(function (m) { return !m.plan; }).sort(function (a, b) { return a.seq - b.seq; })[0];
    }

    function fillTables(t, who, onlyTable) {
      var cfg = cfgOf(t), ms = tMatches(t.id), called = [];
      var tables = onlyTable ? [onlyTable] : freeTables(cfg, ms);
      tables.forEach(function (tb) {
        if (!freeTables(cfg, ms).some(function (x) { return x === tb; })) return;
        var m = nextReady(ms, busyPlayers(ms), tb); if (!m) return;
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

    /* Email/text sent when a match is put on a table.
       Subject & first line:  "Player vs Player - Table 3 - Race to 5"  */
    function matchLine(t, m, ps, es) {
      var cfg = cfgOf(t), a = es[m.p1], b = es[m.p2];
      var race = (m.stage === 'RR' && cfg.teamMode !== 'teams') ? m.race + ' games' : E.raceText(cfg, m.race);
      return (a ? entryName(a, ps) : '?') + ' vs ' + (b ? entryName(b, ps) : '?') + ' - Table ' + m.table + ' - ' + race;
    }
    function notifyMatch(t, m) {
      var es = {}, ps = playersMap(); tEntries(t.id).forEach(function (e) { es[e.id] = e; });
      var line = matchLine(t, m, ps, es), msgs = [];
      [m.p1, m.p2].forEach(function (id) {
        var e = es[id]; if (!e) return;
        var text = line + '\n\n' + t.name + (m.label ? ' · ' + m.label : '') + '\nPlease head to Table ' + m.table + ' now.\n\nScore your match here: ' + portalLink(e);
        membersOf(e).forEach(function (x) { var p = ps[x.pid];
          msgs.push({ name: playerName(p), email: p && p.email, phone: p && p.phone, subject: line, text: text }); });
      });
      try { return P.notify(msgs); } catch (x) { return []; }
    }

    function callMatch(a, me) {
      var m = need('Matches', a.id), t = need('Tournaments', m.tid), cfg = cfgOf(t);
      if (t.status === 'drawn') err('Press "Start play" first — until then you can plan tables on the Plan tab');
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
      var ps = playersMap(), out = [];
      [m.p1, m.p2].forEach(function (id) { var e = es[id]; if (!e) return;
        membersOf(e).forEach(function (x) { var p = ps[x.pid]; out.push({ name: playerName(p), phone: p && p.phone, email: p && p.email, link: portalLink(e) }); }); });
      return out;
    }

    function uncallMatch(a, me) {
      var m = need('Matches', a.id), t = need('Tournaments', m.tid);
      if (m.status !== 'live') err('Match is not on a table');
      m.status = 'ready'; m.table = ''; store.update('Matches', m); touch(t);
      return { ok: true };
    }

    function fillTablesAction(a, me) {
      var t = need('Tournaments', a.tid); if (t.status === 'drawn') err('Press "Start play" first');
      var c = fillTables(t, me.name); touch(t); return { called: c.length };
    }

    function notifyLinks(a, me) {
      var t = need('Tournaments', a.tid), ps = playersMap();
      var es = tEntries(t.id).filter(function (e) { return !a.ids || a.ids.indexOf(e.id) >= 0; });
      var msgs = [];
      es.forEach(function (e) { var nm = membersOf(e).length > 1 ? ' as ' + entryName(e, ps) : '';
        membersOf(e).forEach(function (x) { var p = ps[x.pid];
          msgs.push({ name: playerName(p), email: p && p.email, phone: p && p.phone, subject: t.name + ' — your player link',
            text: 'You\'re entered in ' + t.name + nm + '. Your matches, table calls and scoring are all here: ' + portalLink(e) + ' — keep this link handy.' }); }); });
      var res = []; try { res = P.notify(msgs); } catch (x) { }
      return { sent: res, count: msgs.length };
    }

    /* ---------------- planning: tables, queue order, times ---------------- */
    function setPlan(a, me) {
      var m = need('Matches', a.id), t = need('Tournaments', m.tid);
      if (m.status === 'done' || t.status === 'complete') err('That match is already finished');
      if (a.plan !== undefined) { if (a.plan && cfgOf(t).tables.indexOf(String(a.plan)) < 0) err('Unknown table'); m.plan = String(a.plan || ''); if (!m.plan) m.planOrder = ''; }
      if (a.planOrder !== undefined) m.planOrder = a.planOrder === '' ? '' : Math.max(1, Number(a.planOrder) || 1);
      if (a.time !== undefined) m.time = cleanTime(a.time);
      if (m.plan && (a.planOrder === undefined || a.planOrder === '') && !m.planOrder) {      // put it at the back of that table's queue
        var q = tMatches(t.id).filter(function (x) { return x !== m && String(x.plan) === m.plan && x.status !== 'done'; });
        m.planOrder = q.reduce(function (mx, x) { return Math.max(mx, Number(x.planOrder) || 0); }, 0) + 1;
      }
      store.update('Matches', m); touch(t);
      return { ok: true, planOrder: m.planOrder };
    }
    function cleanTime(v) { v = String(v || '').trim(); if (!v) return ''; if (!/^\d{1,2}:\d{2}$/.test(v)) err('Use a time like 13:30'); return v.length === 4 ? '0' + v : v; }
    function setRoundTime(a, me) {
      var t = need('Tournaments', a.tid), time = cleanTime(a.time), n = 0;
      tMatches(t.id).forEach(function (m) {
        if (m.status === 'done' || m.status === 'bye' || m.status === 'void') return;
        if (m.stage !== a.stage || Number(m.round) !== Number(a.round) || (a.grp && m.grp !== a.grp)) return;
        m.time = time; store.update('Matches', m); n++;
      });
      touch(t); return { updated: n };
    }
    function startPlay(a, me) {
      var t = need('Tournaments', a.tid), cfg = cfgOf(t);
      if (t.status !== 'drawn') err('The tournament isn\'t waiting to start');
      t.status = cfg.format === 'RR' ? 'roundrobin' : 'bracket';
      var ms = tMatches(t.id), called = [];
      // 1) every table with a planned match gets its first one
      cfg.tables.forEach(function (tb) {
        var m = nextReady(ms, busyPlayers(ms), tb);
        if (m && String(m.plan) === String(tb)) { callOne(t, cfg, m, tb, me.name, true); called.push(m); }
      });
      // 2) auto-call fills the rest with unplanned matches
      if (cfg.autoCall) called = called.concat(fillTables(t, me.name));
      touch(t); log(me.name, 'startPlay', t.name + ' · ' + called.length + ' called');
      return { called: called.length };
    }
    function undoDraw(a, me) {
      var t = need('Tournaments', a.tid), cfg = cfgOf(t);
      if (t.status !== 'drawn') err('Play has already started');
      tMatches(t.id).forEach(function (m) { store.remove('Matches', m.id); });
      if (cfg.format !== 'RR' && cfg.seeding !== 'manual') tEntries(t.id).forEach(function (e) { e.seed = ''; store.update('Entries', e); });
      t.status = 'registration'; touch(t); log(me.name, 'undoDraw', t.name);
      return { ok: true };
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
      if (t.status === 'drawn' || t.status === 'registration') err('The tournament hasn\'t started yet');
      if (!m.p1 || !m.p2 || m.p1 === 'BYE' || m.p2 === 'BYE') err('This match is not ready yet');
      if (m.status === 'void') err('This match is not needed');
      if (m.status === 'waiting') err('This match is not ready yet');
      var all = tMatches(t.id);
      var games = sanitizeGames(a.games || [], m.stage, cfg.teamMode === 'teams');
      if (cfg.teamMode === 'teams') {
        var started = (m.games || []).some(function (x) { return x && x.w; });
        var es = {}; tEntries(t.id).forEach(function (e) { es[e.id] = e; });
        var L = a.lineup || m.lineup || {}, N = E.teamSide(cfg);
        var okSide = function (list, e) {
          var ids = membersOf(e).map(function (x) { return x.pid; });
          return Array.isArray(list) && list.length === N && list.every(function (p) { return ids.indexOf(p) >= 0; }) &&
            list.filter(function (p, i) { return list.indexOf(p) === i; }).length === N;
        };
        if (games.some(function (x) { return x; })) {
          if (!okSide(L.h, es[m.p1]) || !okSide(L.a, es[m.p2])) err('Set both line-ups first (' + N + ' different players per side)');
        }
        var oldL = m.lineup || {};
        if (started && !dir && (JSON.stringify(oldL.h) !== JSON.stringify(L.h) || JSON.stringify(oldL.a) !== JSON.stringify(L.a))) err('Line-ups are locked once play starts — ask the director');
        m.lineup = { h: (L.h || []).slice(0, N), a: (L.a || []).slice(0, N), hcp1: Number(es[m.p1].hcp) || 0, hcp2: Number(es[m.p2].hcp) || 0 };
      }
      var test = { stage: m.stage, race: m.race, games: games, lineup: m.lineup }, c = E.computeMatch(test, cfg);
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
        if (cfg.autoCall) { var mm = tMatches(t.id); var tbl = freed; var nx = nextReady(mm, busyPlayers(mm), tbl); if (nx) callOne(t, cfg, nx, tbl, 'auto', true); }
      }
      if (m.stage !== 'RR') {
        var ch = E.champion(tMatches(t.id)); if (ch && t.champion !== ch) t.champion = ch; else if (!ch) t.champion = '';
      }
      touch(t);
      log(dir ? 'director' : 'player', 'score', m.id + ' ' + c.s1 + '-' + c.s2);
      return { match: m };
    }

    function sanitizeGames(g, stage, team) {
      if (!Array.isArray(g)) return [];
      var rack = function (x) { return { w: Number(x.w) === 2 ? 2 : (Number(x.w) === 1 ? 1 : 0), e: x.e ? 1 : 0, n: Math.max(0, Math.min(7, Number(x.n) || 0)) }; };
      var tag = function (t) { return ['ERO', 'BRO', '1ST'].indexOf(t) >= 0 ? t : ''; };
      if (team) return g.slice(0, 400).map(function (x) { return x && (Number(x.w) === 1 || Number(x.w) === 2) ? { w: Number(x.w), n: Math.max(0, Math.min(7, Number(x.n) || 0)), t1: tag(x.t1), t2: tag(x.t2) } : null; });
      return g.slice(0, 200).map(function (x) {
        if (stage === 'RR') return { a: side(x.a), b: side(x.b) };
        return rack(x);
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
        m.games = []; m.lineup = {}; m.s1 = m.s2 = m.e1 = m.e2 = 0; m.doneAt = ''; m.startedAt = '';
        if (m.stage === 'RR') { m.status = m.table ? 'live' : 'ready'; m.winner = m.loser = ''; store.update('Matches', m); }
        else { if (m.status === 'done') m.status = m.table ? 'live' : 'ready'; E.resolve(all, cfgOf(t)); all.forEach(function (x) { store.update('Matches', x); }); }
      } else store.update('Matches', m);
      touch(t); log(me.name, 'editMatch', m.id);
      return { ok: true };
    }

    /* ---------------- finish ---------------- */
    function recalcPayouts(t) {
      var cfg = cfgOf(t), es = tEntries(t.id);
      es.forEach(function (e) { e.size = membersOf(e).length; });
      var res = E.payouts(cfg, es);
      es.forEach(function (e) { delete e.size; });
      es.forEach(function (e) { var v = res.payouts[e.id]; e.payout = v ? v : ''; store.update('Entries', e); });
      return res;
    }

    function computePlaces(t) {
      var cfg = cfgOf(t), es = tEntries(t.id), ms = tMatches(t.id);
      if (!ms.length) ms = store.list('MatchHistory').filter(function (m) { return m.tid === t.id; });
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
        return { id: e.id, tid: e.tid, pid: e.pid, members: membersOf(e), team: e.team || '', place: e.place, payout: e.payout, rankPts: e.rankPts, wildcard: E.truthy(e.wildcard), seed: e.seed }; });
      var matches = store.list('MatchHistory').filter(function (m) { return tset[m.tid] && m.status === 'done'; }).map(function (m) {
        return { id: m.id, tid: m.tid, stage: m.stage, round: m.round, p1: m.p1, p2: m.p2, s1: m.s1, s2: m.s2, e1: m.e1, e2: m.e2, winner: m.winner, games: m.games, lineup: m.lineup, race: m.race, doneAt: m.doneAt }; });
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
      logout: function (a, s) { if (s) P.sessionDel(s); return { ok: true }; },
      changePassword: function () { err('Please sign in'); },
      getInvite: function (a) { var inv = findInvite(a.token); return { name: inv.name, email: inv.email }; },
      acceptInvite: acceptInvite
    };
    var DIRECTOR = {
      me: function (a, me) { return { name: me.name, owner: !!me.owner, mustChange: !!me.mustChange }; },
      listPlayers: function () { return { players: store.list('Players') }; },
      savePlayer: savePlayer,
      listDirectors: function (a, me) { var o = owner(); return { you: { name: me.name, owner: !!me.owner }, ownerSet: !!o,
        directors: store.list('Directors').map(function (d) { return { id: d.id, username: d.username, name: d.name, email: d.email, active: E.truthy(d.active), mustChange: E.truthy(d.mustChange) }; }) }; },
      saveDirector: function (a, me) { if (owner()) ownerOnly(me); return saveDirector(a, me); },
      inviteDirector: function (a, me) { if (owner()) ownerOnly(me); return inviteDirector(a, me); },
      listInvites: function () { return { invites: store.list('Invites').filter(function (x) { return !x.usedBy; })
        .map(function (x) { return { id: x.id, name: x.name, email: x.email, invitedBy: x.invitedBy, created: x.created, expires: x.expires, expired: String(x.expires) < P.now() }; }) }; },
      revokeInvite: function (a, me) { need('Invites', a.id); store.remove('Invites', a.id); log(me.name, 'revokeInvite', a.id); return { ok: true }; },
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
      quickAddPlayer: function (a, me) { var r = savePlayer(a, me); addEntries({ tid: a.tid, pids: [r.player.id], paid: a.paid, role: a.role }, me); return r; },
      makeTeam: makeTeam, splitTeam: splitTeam, drawTeams: drawTeams,
      drawGroups: drawGroups, startRoundRobin: startRoundRobin, startBracket: startBracket,
      generateFinals: generateFinals, undoFinals: undoFinals,
      callMatch: callMatch, uncallMatch: uncallMatch, setPlan: setPlan, setRoundTime: setRoundTime, startPlay: startPlay, undoDraw: undoDraw, fillTables: fillTablesAction, editMatch: editMatch,
      notifyLinks: notifyLinks, matchMessages: function (a) { var m = need('Matches', a.id); return { messages: messagesFor(need('Tournaments', m.tid), m) }; },
      previewFinish: previewFinish, finalize: finalize, reopen: reopen
    };
    var WRITES = { login: 0, scoreMatch: 1, acceptInvite: 1 };

    function handle(action, args, session) {
      args = args || {};
      var fn = PUBLIC[action], dirFn = DIRECTOR[action];
      if (!fn && !dirFn) err('Unknown action: ' + action);
      var write = !!dirFn && !/^(me|list)/.test(action) || WRITES[action] || action === 'changePassword';
      return P.lock(write, function () {
        if (action === 'changePassword') { var res0 = changePassword(args, director(session), session); store.commit(); return res0; }
        var me = dirFn ? director(session) : null;
        if (me && me.mustChange && action !== 'me') err('Please choose your own password first');
        var res = fn ? fn(args, session) : dirFn(args, me);
        if (write) store.commit();
        return res;
      });
    }

    return { handle: handle };
  }

  return { create: create, SCHEMA: SCHEMA, JSON_FIELDS: JSON_FIELDS };
})();
if (typeof module !== 'undefined') module.exports = Service;
