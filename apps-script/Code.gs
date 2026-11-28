/* =====================================================================
   POOL HALL TOURNAMENTS — Google Apps Script backend
   Files in this Apps Script project:
     Code.gs     (this file)
     Engine.gs   (copy of site/engine.js — paste unchanged)
     Service.gs  (copy of site/service.js — paste unchanged)
   Deploy:  Deploy > New deployment > Web app
            Execute as: Me    Who has access: Anyone
   ===================================================================== */

/* ------------ ONE-TIME SETUP: run these from the editor ------------ */

// 1) Run setup() once. It creates every tab with headers.
function setup() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(Service.SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = Service.SCHEMA[name];
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#7a0f14').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, sh.getMaxRows() - 1, cols.length).setNumberFormat('@');   // keep phone numbers & ids as text
  });
  var s1 = ss.getSheetByName('Sheet1'); if (s1 && ss.getSheets().length > 1 && s1.getLastRow() === 0) ss.deleteSheet(s1);
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SITE_URL')) props.setProperty('SITE_URL', 'https://YOUR-SITE.netlify.app/');
  Logger.log('Setup complete. Now put your details in setOwnerLogin() and run it.');
}

// 2) YOUR OWNER LOGIN — kept in this script's private settings, never in the Directors tab.
//    Put your username + password below, Run it once, then change the password here back to 'CHANGE-ME' and save.
//    (Run it again any time to reset your own password.)
function setOwnerLogin() {
  var username = 'larinda';          // what you type to sign in
  var name     = 'Larinda';          // shown in the app
  var password = 'CHANGE-ME';        // at least 6 characters

  if (password === 'CHANGE-ME' || password.length < 6) throw new Error('Type your real password into setOwnerLogin first');
  var P = Platform(), salt = P.token();
  PropertiesService.getScriptProperties().setProperty('OWNER_LOGIN',
    JSON.stringify({ username: username.trim().toLowerCase(), name: name, salt: salt, hash: P.hash(salt + ':' + password) }));
  Logger.log('✅ Owner login saved for "' + username + '". Now set the password in this file back to CHANGE-ME and save.');
}

// 3) Optional: texting through Twilio. Fill these in and run once.
function setTwilio() {
  PropertiesService.getScriptProperties().setProperties({
    TWILIO_SID: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    TWILIO_TOKEN: 'your-auth-token',
    TWILIO_FROM: '+12045550000'
  });
}

/* ------------------------------ web app ------------------------------ */
function doGet(e) {
  return json({ ok: true, app: 'pool-hall-tournaments' });
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (x) { return json({ ok: false, error: 'Bad request' }); }
  try {
    var svc = Service.create(SheetStore(), Platform());
    var data = svc.handle(body.action, body.args || {}, body.session || '');
    return json({ ok: true, data: data });
  } catch (err) {
    if (!err.userError) console.error(err && err.stack || err);
    return json({ ok: false, error: err.userError ? err.message : ('Server error: ' + (err && err.message)) });
  }
}

function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ------------------------------ platform ------------------------------ */
function Platform() {
  var cache = CacheService.getScriptCache(), props = PropertiesService.getScriptProperties();
  return {
    now: function () { return new Date().toISOString(); },
    uuid: function () { return Utilities.getUuid(); },
    token: function () { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); },
    random: Math.random,
    hash: function (s) {
      return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
        .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
    },
    sessionGet: function (t) { var v = cache.get('s:' + t); return v ? JSON.parse(v) : null; },
    sessionPut: function (t, v) { cache.put('s:' + t, JSON.stringify(v), 21600); },      // 6 hours, refreshed on use
    sessionDel: function (t) { cache.remove('s:' + t); },
    cacheGet: function (k) { var v = cache.get('c:' + k); return v ? JSON.parse(v) : null; },
    cachePut: function (k, v) { try { cache.put('c:' + k, JSON.stringify(v), 20); } catch (x) { } },
    cacheDel: function (k) { cache.remove('c:' + k); },
    ownerGet: function () { var v = props.getProperty('OWNER_LOGIN'); return v ? JSON.parse(v) : null; },
    ownerSet: function (o) { props.setProperty('OWNER_LOGIN', JSON.stringify(o)); },
    siteUrl: function () { var u = props.getProperty('SITE_URL') || ''; return u.slice(-1) === '/' ? u : u + '/'; },
    lock: function (write, fn) {
      if (!write) return fn();
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(20000)) { var e = new Error('The system is busy — try again in a moment'); e.userError = true; throw e; }
      try { return fn(); } finally { lock.releaseLock(); }
    },
    notify: function (msgs) {
      var sid = props.getProperty('TWILIO_SID'), tok = props.getProperty('TWILIO_TOKEN'), from = props.getProperty('TWILIO_FROM');
      return msgs.map(function (m) {
        var r = { name: m.name, email: false, sms: false };
        if (m.email) {
          try { if (MailApp.getRemainingDailyQuota() > 0) { MailApp.sendEmail({ to: m.email, subject: m.subject, body: m.text, name: 'Tournament Desk' }); r.email = true; } } catch (x) { r.emailError = String(x); }
        }
        if (m.phone && sid && tok && from) {
          try {
            var res = UrlFetchApp.fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', {
              method: 'post', muteHttpExceptions: true,
              headers: { Authorization: 'Basic ' + Utilities.base64Encode(sid + ':' + tok) },
              payload: { To: normalizePhone(m.phone), From: from, Body: m.text }
            });
            r.sms = res.getResponseCode() < 300;
          } catch (x) { r.smsError = String(x); }
        }
        return r;
      });
    }
  };
}

function normalizePhone(p) {
  var d = String(p).replace(/[^\d+]/g, '');
  if (d.charAt(0) === '+') return d;
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.charAt(0) === '1') return '+' + d;
  return d;
}

/* ------------------------------ sheet store ------------------------------
   Reads each tab once per request, tracks changes, writes them back in commit(). */
function SheetStore() {
  var ss = SpreadsheetApp.getActive(), tables = {};
  function load(name) {
    if (tables[name]) return tables[name];
    var sh = ss.getSheetByName(name); if (!sh) throw new Error('Missing tab "' + name + '" — run setup()');
    var cols = Service.SCHEMA[name], last = sh.getLastRow(), rows = [];
    if (last > 1) {
      var vals = sh.getRange(2, 1, last - 1, cols.length).getValues();
      vals.forEach(function (v, i) {
        if (v[0] === '' || v[0] === null) return;
        var o = {}; cols.forEach(function (c, j) { o[c] = parse(c, v[j]); });
        o.__row = i + 2; rows.push(o);
      });
    }
    tables[name] = { sh: sh, cols: cols, rows: rows, dirty: {}, added: [], removed: [] };
    return tables[name];
  }
  function parse(col, v) {
    if (Service.JSON_FIELDS[col]) { if (v === '' || v === null) return col === 'games' ? [] : {}; try { return JSON.parse(v); } catch (x) { return col === 'games' ? [] : {}; } }
    if (v === 'TRUE') return true; if (v === 'FALSE') return false;
    if (v instanceof Date) return v.toISOString();
    if (['seq', 'round', 'pos', 'race', 's1', 's2', 'e1', 'e2'].indexOf(col) >= 0 && v !== '') return Number(v);
    return v;
  }
  function ser(col, v) {
    if (Service.JSON_FIELDS[col]) return JSON.stringify(v || (col === 'games' ? [] : {}));
    if (v === true) return 'TRUE'; if (v === false) return 'FALSE';
    if (v === undefined || v === null) return '';
    return v;
  }
  return {
    list: function (name) { return load(name).rows; },
    insert: function (name, obj) { var t = load(name); t.rows.push(obj); t.added.push(obj); },
    update: function (name, obj) { var t = load(name); if (obj.__row) t.dirty[obj.__row] = obj; },
    remove: function (name, id) {
      var t = load(name);
      for (var i = 0; i < t.rows.length; i++) if (String(t.rows[i].id) === String(id)) {
        var o = t.rows.splice(i, 1)[0];
        if (o.__row) { t.removed.push(o.__row); delete t.dirty[o.__row]; }
        else t.added = t.added.filter(function (x) { return x !== o; });
        return;
      }
    },
    commit: function () {
      Object.keys(tables).forEach(function (name) {
        var t = tables[name], cols = t.cols;
        if (t.removed.length) {                      // rows removed: rewrite the whole tab in one go (fast)
          var data = t.rows.map(function (o) { return cols.map(function (c) { return ser(c, o[c]); }); });
          var lastRow = t.sh.getLastRow();
          if (lastRow > 1) t.sh.getRange(2, 1, lastRow - 1, cols.length).clearContent();
          if (data.length) t.sh.getRange(2, 1, data.length, cols.length).setNumberFormat('@').setValues(data);
          return;
        }
        Object.keys(t.dirty).forEach(function (r) {
          var o = t.dirty[r];
          t.sh.getRange(Number(r), 1, 1, cols.length).setValues([cols.map(function (c) { return ser(c, o[c]); })]);
        });
        if (t.added.length) {
          var start = t.sh.getLastRow() + 1;
          t.sh.getRange(start, 1, t.added.length, cols.length).setNumberFormat('@')
            .setValues(t.added.map(function (o) { return cols.map(function (c) { return ser(c, o[c]); }); }));
        }
      });
    }
  };
}
