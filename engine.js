/* =====================================================================
   TOURNAMENT ENGINE  (shared file)
   Used by the website AND by Apps Script (paste a copy as Engine.gs).
   Pure logic only — no DOM, no Google calls.
   ===================================================================== */
var Engine = (function () {

  var RANK_POINTS = [[1, 100], [2, 75], [3, 60], [4, 50], [8, 35], [16, 20], [32, 12], [9999, 8]];

  function nextPow2(n) { var p = 1; while (p < n) p *= 2; return p; }
  function log2(n) { return Math.round(Math.log(n) / Math.log(2)); }

  function shuffle(arr, rnd) {
    rnd = rnd || Math.random;
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* Bracket seed positions, e.g. 8 -> [1,8,4,5,2,7,3,6] */
  function seedOrder(size) {
    var order = [1, 2];
    while (order.length < size) {
      var n = order.length * 2 + 1, next = [];
      order.forEach(function (s) { next.push(s, n - s); });
      order = next;
    }
    return order.slice(0, size);
  }

  function groupLetter(i) { return String.fromCharCode(65 + i); }

  /* ---------- default config ---------- */
  function defaults(cfg) {
    var c = {
      gameType: '8', format: 'RR', finals: 'DE', raceType: 'wins',
      raceA: 5, raceB: 4, raceFinal: 7, raceBFinal: '', gfReset: true,
      rrGames: 2, groupSize: 9, groups: 0, advance: 0, wildcards: -1,
      seeding: 'random', tables: ['1', '2', '3', '4', '5', '6', '7', '8'],
      autoCall: true, notifyOnCall: true,
      entryFee: 0, addedMoney: 0, housePct: 0, payoutPct: [50, 30, 20], roundTo: 5,
      notes: ''
    };
    cfg = cfg || {};
    for (var k in cfg) if (cfg[k] !== undefined && cfg[k] !== null) c[k] = cfg[k];
    if (c.gameType === '9') c.raceType = 'wins';     // 9 ball is purely games won
    if (typeof c.tables === 'string') c.tables = c.tables.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (typeof c.payoutPct === 'string') c.payoutPct = c.payoutPct.split(/[ ,\/]+/).map(Number).filter(function (x) { return x > 0; });
    ['raceA', 'raceB', 'raceFinal', 'rrGames', 'groupSize', 'groups', 'advance', 'wildcards', 'entryFee', 'addedMoney', 'housePct', 'roundTo']
      .forEach(function (k) { if (c[k] !== '' && c[k] !== undefined) c[k] = Number(c[k]); });
    if (c.raceBFinal !== '' && c.raceBFinal !== undefined) c.raceBFinal = Number(c.raceBFinal);
    return c;
  }

  /* How many groups / qualifiers / wild cards for n players (mirrors the Crazy 8 workbook) */
  function rrPlan(cfg, n) {
    var groups = cfg.groups > 0 ? cfg.groups : Math.max(1, Math.ceil(n / (cfg.groupSize || 9)));
    var advance = cfg.advance > 0 ? cfg.advance : (groups === 1 ? Math.min(8, Math.max(1, n - 1)) : (groups >= 4 ? 3 : 4));
    var wild = cfg.wildcards >= 0 ? cfg.wildcards : (groups === 1 ? 0 : 4);
    var qualifiers = groups * advance;
    var pool = Math.max(0, n - qualifiers);
    wild = Math.min(wild, pool);
    var total = qualifiers + wild;
    return { groups: groups, advance: advance, wildcards: wild, bracketPlayers: total, bracketSize: nextPow2(Math.max(2, total)), byes: nextPow2(Math.max(2, total)) - total };
  }

  /* Deal shuffled players into groups like WRAPROWS: 1->A, 2->B ... */
  function dealGroups(ids, groups, rnd) {
    var s = shuffle(ids, rnd), out = {};
    s.forEach(function (id, i) { out[id] = groupLetter(i % groups); });
    return out;
  }

  /* Circle-method round robin: everyone plays everyone, spread over rounds */
  function roundRobinPairs(ids) {
    var arr = ids.slice(); if (arr.length % 2) arr.push(null);
    var n = arr.length, out = [];
    for (var r = 0; r < n - 1; r++) {
      for (var i = 0; i < n / 2; i++) {
        var a = arr[i], b = arr[n - 1 - i];
        if (a && b) out.push({ round: r + 1, a: (r % 2 ? b : a), b: (r % 2 ? a : b) });
      }
      arr.splice(1, 0, arr.pop());
    }
    return out;
  }

  /* =================== SCORING ===================
     Round robin game:  { a:{r,n}, b:{r,n} }
        r: 'W' win, 'E' ERO, 'R' response ERO (8 ball RR only), 'L' lost (n = balls made)
     Knockout rack:     { w:1|2, e:0|1, n: loser balls (points races only) }
  ================================================== */
  function rrSidePts(gameType, s) {
    if (!s) return { pts: 0, w: 0, e: 0 };
    if (gameType === '9') return { pts: (s.r === 'W' || s.r === 'E') ? 1 : 0, w: (s.r === 'W' || s.r === 'E') ? 1 : 0, e: s.r === 'E' ? 1 : 0 };
    if (s.r === 'W') return { pts: 10, w: 1, e: 0 };
    if (s.r === 'E') return { pts: 13, w: 1, e: 1 };
    if (s.r === 'R') return { pts: 13, w: 0, e: 1 };
    var n = Math.max(0, Math.min(7, Number(s.n) || 0));
    return { pts: n, w: 0, e: 0 };
  }

  function validRRGame(gameType, g) {
    if (!g || !g.a || !g.b) return 'Both players need a result';
    var a = g.a.r, b = g.b.r, win = { W: 1, E: 1 };
    if (gameType === '9') {
      if (a === 'R' || b === 'R') return 'No response run-out in 9 ball';
      if (!!win[a] === !!win[b]) return 'Exactly one player wins each game';
      return '';
    }
    if (a === 'R' && b !== 'E') return 'A response ERO is only possible after the opponent ERO';
    if (b === 'R' && a !== 'E') return 'A response ERO is only possible after the opponent ERO';
    var wins = (win[a] ? 1 : 0) + (win[b] ? 1 : 0);
    if (wins !== 1) return 'Exactly one player wins each game';
    return '';
  }

  function rackPts(cfg, rack, side) {
    var won = rack.w === side;
    if (cfg.raceType === 'points' && cfg.gameType !== '9') {
      if (won) return rack.e ? 13 : 10;
      return Math.max(0, Math.min(7, Number(rack.n) || 0));
    }
    return won ? 1 : 0;
  }

  function matchRace(m) { return Number(m.race) || 0; }

  /* Totals + completion for any match */
  function computeMatch(m, cfg) {
    var games = m.games || [], r = { s1: 0, s2: 0, w1: 0, w2: 0, e1: 0, e2: 0, played: games.length, complete: false, winnerSide: 0, error: '' };
    if (m.stage === 'RR') {
      games.forEach(function (g, i) {
        var err = validRRGame(cfg.gameType, g); if (err && !r.error) r.error = 'Game ' + (i + 1) + ': ' + err;
        var a = rrSidePts(cfg.gameType, g.a), b = rrSidePts(cfg.gameType, g.b);
        r.s1 += a.pts; r.s2 += b.pts; r.w1 += a.w; r.w2 += b.w; r.e1 += a.e; r.e2 += b.e;
      });
      r.complete = !r.error && games.length >= (cfg.rrGames || 2);
      if (r.complete) r.winnerSide = r.s1 > r.s2 ? 1 : (r.s2 > r.s1 ? 2 : 0);
      return r;
    }
    var race = matchRace(m);
    for (var i = 0; i < games.length; i++) {
      var g = games[i];
      if (r.complete) { r.error = 'Rack ' + (i + 1) + ' was entered after the match ended'; break; }
      if (g.w !== 1 && g.w !== 2) { r.error = 'Rack ' + (i + 1) + ' has no winner'; break; }
      r.s1 += rackPts(cfg, g, 1); r.s2 += rackPts(cfg, g, 2);
      if (g.w === 1) { r.w1++; if (g.e) r.e1++; } else { r.w2++; if (g.e) r.e2++; }
      if (race && (r.s1 >= race || r.s2 >= race)) {
        r.complete = true;
        if (r.s1 >= race && r.s2 >= race) r.winnerSide = g.w;      // both crossed: rack winner takes it
        else r.winnerSide = r.s1 >= race ? 1 : 2;
      }
    }
    return r;
  }

  /* =================== STANDINGS ===================
     entries: [{id,grp,tb}]  matches: RR matches (done ones count)
     Tiebreakers (from the workbook): score -> head-to-head score -> wins -> EROs -> playoff (director sets tb)
  ================================================== */
  function standings(cfg, entries, matches) {
    var rows = {}, h2h = {};
    entries.forEach(function (e) { rows[e.id] = { id: e.id, grp: e.grp, tb: Number(e.tb) || 0, played: 0, pts: 0, wins: 0, eros: 0, mw: 0 }; });
    matches.forEach(function (m) {
      if (m.stage !== 'RR' || m.status !== 'done') return;
      var c = computeMatch(m, cfg), a = rows[m.p1], b = rows[m.p2]; if (!a || !b) return;
      a.played++; b.played++; a.pts += c.s1; b.pts += c.s2; a.wins += c.w1; b.wins += c.w2; a.eros += c.e1; b.eros += c.e2;
      if (c.s1 > c.s2) a.mw++; else if (c.s2 > c.s1) b.mw++;
      h2h[m.p1 + '|' + m.p2] = (h2h[m.p1 + '|' + m.p2] || 0) + c.s1;
      h2h[m.p2 + '|' + m.p1] = (h2h[m.p2 + '|' + m.p1] || 0) + c.s2;
    });
    var byGroup = {};
    Object.keys(rows).forEach(function (id) { var r = rows[id]; (byGroup[r.grp] = byGroup[r.grp] || []).push(r); });
    Object.keys(byGroup).forEach(function (g) {
      var list = byGroup[g];
      list.sort(function (x, y) { return y.pts - x.pts; });
      var out = [], i = 0;
      while (i < list.length) {
        var j = i; while (j < list.length && list[j].pts === list[i].pts) j++;
        var cluster = list.slice(i, j);
        if (cluster.length > 1) {
          cluster.forEach(function (r) { r.h2h = 0; cluster.forEach(function (o) { if (o !== r) r.h2h += h2h[r.id + '|' + o.id] || 0; }); });
          cluster.sort(function (x, y) {
            return (y.h2h - x.h2h) || (y.wins - x.wins) || (y.eros - x.eros) || ((x.tb || 99) - (y.tb || 99));
          });
          for (var k = 0; k < cluster.length; k++) {
            var nb = cluster[k + 1];
            if (nb && nb.h2h === cluster[k].h2h && nb.wins === cluster[k].wins && nb.eros === cluster[k].eros && (nb.tb || 99) === (cluster[k].tb || 99)) { nb.tied = true; cluster[k].tied = true; }
          }
        }
        out = out.concat(cluster); i = j;
      }
      out.forEach(function (r, idx) { r.pos = idx + 1; });
      byGroup[g] = out;
    });
    return byGroup;
  }

  /* =================== BRACKETS =================== */
  function mk(tid, stage, round, pos, seq, src1, src2, race, label) {
    return { id: tid + '-' + stage + round + '-' + (pos + 1), tid: tid, seq: seq, stage: stage, grp: '', round: round, pos: pos, label: label,
      src1: src1, src2: src2, p1: '', p2: '', race: race, table: '', status: 'waiting', games: [], winner: '', loser: '' };
  }

  function roundName(stage, round, totalRounds) {
    if (stage === 'GF') return round === 1 ? 'Grand Final' : 'Grand Final (reset)';
    if (stage === 'W' || stage === 'SE') {
      var left = totalRounds - round;
      var pre = stage === 'W' ? 'A-side ' : '';
      if (left === 0) return pre + 'Final';
      if (left === 1) return pre + 'Semi-final';
      if (left === 2) return pre + 'Quarter-final';
      return pre + 'Round ' + round;
    }
    if (round === totalRounds) return 'B-side Final';
    if (round === totalRounds - 1) return 'B-side Semi-final';
    return 'B-side Round ' + round;
  }

  /* seeds: array of entry ids in seed order (index 0 = seed 1) */
  function buildBracket(tid, seeds, cfg, kind, seqStart) {
    var P = nextPow2(Math.max(2, seeds.length)), n = log2(P), order = seedOrder(P), out = [], seq = seqStart || 1000;
    if (kind === 'DE' && P < 4) P = 4, n = 2, order = seedOrder(4);
    var stageW = kind === 'DE' ? 'W' : 'SE';
    var src = function (s) { return s <= seeds.length ? 'E:' + seeds[s - 1] : 'BYE'; };
    var finalRaceA = kind === 'DE' ? cfg.raceA : (cfg.raceFinal || cfg.raceA);
    var wb = [];
    for (var r = 1; r <= n; r++) {
      wb[r] = [];
      var cnt = P / Math.pow(2, r);
      for (var i = 0; i < cnt; i++) {
        var s1 = r === 1 ? src(order[2 * i]) : 'W:' + wb[r - 1][2 * i].id;
        var s2 = r === 1 ? src(order[2 * i + 1]) : 'W:' + wb[r - 1][2 * i + 1].id;
        var race = (r === n) ? finalRaceA : cfg.raceA;
        var m = mk(tid, stageW, r, i, seq++, s1, s2, race, roundName(stageW, r, n));
        wb[r].push(m); out.push(m);
      }
    }
    if (kind !== 'DE') return out;

    var lb = [], LR = 2 * n - 2, bRace = cfg.raceB || cfg.raceA, bFinal = (cfg.raceBFinal || bRace);
    var raceFor = function (k) { return k === LR ? bFinal : bRace; };
    lb[1] = [];
    for (var i1 = 0; i1 < P / 4; i1++) {
      var m1 = mk(tid, 'L', 1, i1, seq++, 'L:' + wb[1][2 * i1].id, 'L:' + wb[1][2 * i1 + 1].id, raceFor(1), roundName('L', 1, LR));
      lb[1].push(m1); out.push(m1);
    }
    for (var r2 = 2; r2 <= n; r2++) {
      var k = 2 * r2 - 2, cnt2 = P / Math.pow(2, r2);
      lb[k] = [];
      for (var i2 = 0; i2 < cnt2; i2++) {
        var idx = (r2 % 2 === 0) ? cnt2 - 1 - i2 : i2;     // flip drop order to avoid instant rematches
        var m2 = mk(tid, 'L', k, i2, seq++, 'W:' + lb[k - 1][i2].id, 'L:' + wb[r2][idx].id, raceFor(k), roundName('L', k, LR));
        lb[k].push(m2); out.push(m2);
      }
      if (r2 < n) {
        var k2 = 2 * r2 - 1, cnt3 = P / Math.pow(2, r2 + 1);
        lb[k2] = [];
        for (var i3 = 0; i3 < cnt3; i3++) {
          var m3 = mk(tid, 'L', k2, i3, seq++, 'W:' + lb[k][2 * i3].id, 'W:' + lb[k][2 * i3 + 1].id, raceFor(k2), roundName('L', k2, LR));
          lb[k2].push(m3); out.push(m3);
        }
      }
    }
    var gfRace = cfg.raceFinal || cfg.raceA;
    var gf = mk(tid, 'GF', 1, 0, seq++, 'W:' + wb[n][0].id, 'W:' + lb[LR][0].id, gfRace, 'Grand Final');
    out.push(gf);
    if (cfg.gfReset) {
      var gf2 = mk(tid, 'GF', 2, 0, seq++, 'RESET:' + gf.id, 'RESET:' + gf.id, gfRace, 'Grand Final (reset)');
      out.push(gf2);
    }
    return out;
  }

  /* Re-derive players / winners for every knockout match from results.
     Returns list of conflicts (match whose players changed after games were entered). */
  function resolve(matches, cfg) {
    var by = {}, conflicts = [];
    matches.forEach(function (m) { by[m.id] = m; });
    var ko = matches.filter(function (m) { return m.stage !== 'RR'; }).sort(function (a, b) { return a.seq - b.seq; });
    var val = function (s) {
      if (!s) return '';
      if (s === 'BYE') return 'BYE';
      var t = s.split(':'), ref = by[t.slice(1).join(':')];
      if (t[0] === 'E') return t.slice(1).join(':');
      if (!ref) return '';
      if (t[0] === 'W') return ref.winner || '';
      if (t[0] === 'L') return ref.loser || '';
      return '';
    };
    ko.forEach(function (m) {
      var p1, p2, reset = (m.src1 || '').indexOf('RESET:') === 0;
      if (reset) {
        var g1 = by[m.src1.slice(6)];
        if (g1 && g1.status === 'done' && g1.winner === g1.p2 && g1.p2) { p1 = g1.p1; p2 = g1.p2; }
        else if (g1 && (g1.status === 'done' || g1.status === 'bye')) { p1 = ''; p2 = ''; setVoid(m); return; }
        else { p1 = ''; p2 = ''; }
      } else { p1 = val(m.src1); p2 = val(m.src2); }
      if ((m.p1 !== p1 || m.p2 !== p2) && (m.games || []).length) conflicts.push(m.id);
      m.p1 = p1; m.p2 = p2;
      if (m.status === 'void' && !reset) m.status = 'waiting';
      if (p1 && p2) {
        if (p1 === 'BYE' || p2 === 'BYE') {
          m.status = 'bye'; m.winner = p1 === 'BYE' ? p2 : p1; m.loser = 'BYE'; m.table = '';
          return;
        }
        var c = computeMatch(m, cfg);
        if (c.complete && c.winnerSide) {
          m.status = 'done'; m.winner = c.winnerSide === 1 ? p1 : p2; m.loser = c.winnerSide === 1 ? p2 : p1;
        } else {
          m.winner = ''; m.loser = '';
          if (m.status !== 'live') m.status = 'ready';
        }
      } else { m.status = 'waiting'; m.winner = ''; m.loser = ''; }
    });
    function setVoid(m) { m.p1 = ''; m.p2 = ''; m.status = 'void'; m.winner = ''; m.loser = ''; m.table = ''; }
    return conflicts;
  }

  /* Status for RR matches */
  function refreshRR(m, cfg) {
    var c = computeMatch(m, cfg);
    if (c.complete) m.status = 'done';
    else if (m.status === 'done') m.status = m.table ? 'live' : 'ready';
    m.winner = c.complete ? (c.winnerSide === 1 ? m.p1 : c.winnerSide === 2 ? m.p2 : '') : '';
    m.loser = c.complete ? (c.winnerSide === 1 ? m.p2 : c.winnerSide === 2 ? m.p1 : '') : '';
    return c;
  }

  function koStages(matches) { return matches.filter(function (m) { return m.stage !== 'RR'; }); }

  function champion(matches) {
    var ko = koStages(matches); if (!ko.length) return '';
    var gf2 = ko.filter(function (m) { return m.stage === 'GF' && m.round === 2; })[0];
    var gf1 = ko.filter(function (m) { return m.stage === 'GF' && m.round === 1; })[0];
    if (gf1) {
      if (gf1.status !== 'done') return '';
      if (gf1.winner === gf1.p1) return gf1.winner;
      if (!gf2) return gf1.winner;
      return gf2.status === 'done' ? gf2.winner : '';
    }
    var maxR = Math.max.apply(null, ko.map(function (m) { return m.round; }));
    var f = ko.filter(function (m) { return m.round === maxR; })[0];
    return f && (f.status === 'done' || f.status === 'bye') ? f.winner : '';
  }

  /* Finishing places. entries need {id, grp}; rrStand = standings() result (optional) */
  function placements(cfg, entries, matches, rrStand) {
    var ko = koStages(matches), key = {}, inBracket = {};
    ko.forEach(function (m) {
      [m.p1, m.p2].forEach(function (p) { if (p && p !== 'BYE') inBracket[p] = true; });
    });
    Object.keys(inBracket).forEach(function (p) { key[p] = 10000; });
    var maxL = 0; ko.forEach(function (m) { if (m.stage === 'L') maxL = Math.max(maxL, m.round); });
    ko.forEach(function (m) {
      if (m.status !== 'done' || !m.loser || m.loser === 'BYE') return;
      var k;
      if (m.stage === 'SE') k = m.round;
      else if (m.stage === 'W') return;
      else if (m.stage === 'L') k = m.round;
      else if (m.stage === 'GF') {
        if (m.round === 1 && m.winner === m.p2 && ko.some(function (x) { return x.stage === 'GF' && x.round === 2; })) return;
        k = maxL + m.round;
      }
      key[m.loser] = k;
    });
    var champ = champion(matches); if (champ) key[champ] = 20000;
    var place = {}, ids = Object.keys(key);
    ids.forEach(function (id) { place[id] = 1 + ids.filter(function (o) { return key[o] > key[id]; }).length; });
    var B = ids.length;
    if (rrStand) {
      var rest = [];
      Object.keys(rrStand).forEach(function (g) { rrStand[g].forEach(function (r) { if (!inBracket[r.id]) rest.push(r); }); });
      rest.forEach(function (r) {
        place[r.id] = B + 1 + rest.filter(function (o) { return o.pos < r.pos || (o.pos === r.pos && o.pts > r.pts); }).length;
      });
    }
    return place;
  }

  function rankPoints(place) {
    if (!place) return 0;
    for (var i = 0; i < RANK_POINTS.length; i++) if (place <= RANK_POINTS[i][0]) return RANK_POINTS[i][1];
    return 0;
  }

  /* Prize fund + payouts. entries need {id, paid, amount, place, payoutOverride} */
  function payouts(cfg, entries) {
    var collected = 0, paidCount = 0;
    entries.forEach(function (e) { if (truthy(e.paid)) { paidCount++; collected += (e.amount !== '' && e.amount != null) ? Number(e.amount) : Number(cfg.entryFee || 0); } });
    var house = collected * (Number(cfg.housePct) || 0) / 100;
    var fund = collected - house + (Number(cfg.addedMoney) || 0);
    var pct = (cfg.payoutPct || []).map(Number), out = {}, roundTo = Number(cfg.roundTo) || 1;
    var byPlace = {};
    entries.forEach(function (e) { if (e.place) (byPlace[e.place] = byPlace[e.place] || []).push(e.id); });
    Object.keys(byPlace).forEach(function (p) {
      p = Number(p); var ids = byPlace[p], share = 0;
      for (var i = 0; i < ids.length; i++) share += pct[p - 1 + i] || 0;
      if (!share) return;
      var each = fund * share / 100 / ids.length;
      each = Math.floor(each / roundTo) * roundTo;
      if (each <= 0) return;
      ids.forEach(function (id) { out[id] = each; });
    });
    entries.forEach(function (e) { if (e.payoutOverride !== '' && e.payoutOverride != null && !isNaN(Number(e.payoutOverride))) out[e.id] = Number(e.payoutOverride); });
    var paidOutTotal = 0; Object.keys(out).forEach(function (k) { paidOutTotal += out[k]; });
    return { players: entries.length, paidCount: paidCount, collected: collected, house: house, added: Number(cfg.addedMoney) || 0, fund: fund, payouts: out, allocated: paidOutTotal };
  }

  function truthy(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1' || v === 'yes'; }

  function raceText(cfg, race) {
    if (cfg.raceType === 'points' && cfg.gameType !== '9') return 'Race to ' + race + ' pts';
    return 'Race to ' + race;
  }

  return {
    defaults: defaults, rrPlan: rrPlan, dealGroups: dealGroups, roundRobinPairs: roundRobinPairs, shuffle: shuffle,
    seedOrder: seedOrder, nextPow2: nextPow2, groupLetter: groupLetter,
    rrSidePts: rrSidePts, validRRGame: validRRGame, rackPts: rackPts, computeMatch: computeMatch,
    standings: standings, buildBracket: buildBracket, resolve: resolve, refreshRR: refreshRR, roundName: roundName,
    champion: champion, placements: placements, rankPoints: rankPoints, payouts: payouts, truthy: truthy, raceText: raceText
  };
})();
if (typeof module !== 'undefined') module.exports = Engine;
