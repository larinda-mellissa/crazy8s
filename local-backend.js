/* Demo mode backend: runs the real Service in the browser and saves to localStorage.
   Used automatically when API_URL in config.js is blank. */
var LocalBackend = (function () {
  function hash(s) { // FNV-1a x2 — fine for demo mode only (real backend uses SHA-256)
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < s.length; i++) { h1 ^= s.charCodeAt(i); h1 = Math.imul(h1, 16777619); h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519); }
    return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
  }
  function rid() { return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10); }

  function MemStore(data, save) {
    Object.keys(Service.SCHEMA).forEach(function (k) { data[k] = data[k] || []; });
    return {
      list: function (t) { return data[t]; },
      insert: function (t, o) { data[t].push(o); },
      update: function () { },
      remove: function (t, id) { data[t] = data[t].filter(function (x) { return String(x.id) !== String(id); }); },
      commit: function () { if (save) save(data); },
      data: data
    };
  }

  function Platform(opts) {
    var sessions = opts.sessions || {};
    return {
      now: function () { return new Date().toISOString(); },
      uuid: rid, token: function () { return rid() + rid(); }, random: opts.random || Math.random, hash: hash,
      sessionGet: function (t) { return sessions[t] || null; }, sessionPut: function (t, v) { sessions[t] = v; if (opts.saveSessions) opts.saveSessions(sessions); },
      sessionDel: function (t) { delete sessions[t]; if (opts.saveSessions) opts.saveSessions(sessions); },
      cacheGet: function () { return null; }, cachePut: function () { }, cacheDel: function () { },
      siteUrl: function () { return opts.siteUrl || ''; },
      lock: function (w, fn) { return fn(); },
      notify: function (msgs) { if (opts.onNotify) opts.onNotify(msgs); return msgs.map(function (m) { return { name: m.name, email: false, sms: false, demo: true }; }); }
    };
  }

  function seed(store, P) {
    if (store.list('Directors').length) return;
    var salt = P.token();
    store.insert('Directors', { id: P.uuid(), username: 'demo', name: 'Demo Director', email: '', active: true, created: P.now(), salt: salt, hash: P.hash(salt + ':demo123') });
    var names = ['Alex Martin', 'Brooke Chen', 'Carlos Diaz', 'Dana Wells', 'Eli Fraser', 'Faye Moreau', 'Gord Penner', 'Holly Dyck', 'Ivan Kowal', 'Jess Thiessen',
      'Kyle Bouchard', 'Lena Friesen', 'Marc Roy', 'Nina Sinclair', 'Owen Klassen', 'Pam Lavoie', 'Quinn Harper', 'Rick Unger', 'Sara Wiebe', 'Tom Boyko',
      'Uma Patel', 'Vic Nault', 'Wes Bergen', 'Xena Ross'];
    names.forEach(function (n, i) {
      var p = n.split(' ');
      store.insert('Players', { id: P.uuid(), first: p[0], last: p[1], phone: '204555' + String(1000 + i), email: p[0].toLowerCase() + '@example.com', notes: '', active: true, created: P.now() });
    });
    store.commit();
  }

  function browser() {
    var KEY = 'pht-demo-db', SK = 'pht-demo-sessions';
    function fresh() {   // re-read every call so several tabs (phone + desktop) share the same demo data
      var data = {}; try { data = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { }
      var sessions = {}; try { sessions = JSON.parse(localStorage.getItem(SK) || '{}'); } catch (e) { }
      var store = MemStore(data, function (d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { } });
      var P = Platform({ sessions: sessions, saveSessions: function (s) { try { localStorage.setItem(SK, JSON.stringify(s)); } catch (e) { } },
        siteUrl: location.origin + location.pathname, onNotify: function (m) { console.log('[demo] would send', m); } });
      seed(store, P);
      return Service.create(store, P);
    }
    fresh();
    return {
      call: function (action, args, session) {
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            try { resolve(JSON.parse(JSON.stringify(fresh().handle(action, args, session)))); }
            catch (e) { reject(e); }
          }, 60);
        });
      },
      reset: function () { localStorage.removeItem(KEY); localStorage.removeItem(SK); }
    };
  }

  return { MemStore: MemStore, Platform: Platform, seed: seed, browser: browser };
})();
if (typeof module !== 'undefined') module.exports = LocalBackend;
