const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../backend/Code.gs'), 'utf8');
const TRACK = '4iV5W9uYEdYUVa79Axb7Rh';
const PLAYLIST = '3cEYpjA9oz9GiPac4AsH4n';
const OTHER = '1301WleyT98MSxVHPZCA6M';
const ADMIN_EMAIL = 'teacher@example.com';
const ADMIN_COMMANDS = ['setupCrowdSpot', 'showSpotifyAuthorization', 'processQueue', 'disconnectSpotify'];
const HEADERS = ['received_at', 'class_id', 'playlist_id', 'track_id', 'status', 'attempts', 'retry_after', 'detail'];

function fixture(overrides = {}) {
  const properties = {
    PUBLIC_ORIGIN: 'https://muk-labs.github.io',
    CLASSES_JSON: JSON.stringify({seminar: {playlistId: PLAYLIST, open: true}}),
    SHEET_ID: 'private-sheet', CLIENT_ID: 'fake-client', CLIENT_SECRET: 'fake-secret',
    ADMIN_EMAIL,
    REDIRECT_URI: 'https://script.google.com/macros/s/deployment-test/exec', ...overrides
  };
  const store = {
    getProperties: () => ({...properties}), getProperty: k => properties[k] || null,
    setProperty: (k, v) => {properties[k] = v; return store;},
    deleteProperty: k => {delete properties[k]; return store;}
  };
  const rows = [HEADERS.slice()];
  const sheet = {
    getLastRow: () => rows.length,
    getRange(r, c, nr, nc) {
      return {
        getValues: () => rows.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc)),
        setValues: values => values.forEach((row, i) => row.forEach((v, j) => {rows[r - 1 + i][c - 1 + j] = v;}))
      };
    },
    appendRow: row => rows.push(Array.from(row)), setName() {}, setFrozenRows() {}
  };
  const logs = [], requests = [], triggers = [];
  // Real Apps Script web apps may execute as the owner even when the visitor
  // is anonymous. Keep active and effective identities independently mutable.
  const identities = {active: ADMIN_EMAIL, effective: ADMIN_EMAIL, throwActive: false, throwEffective: false};
  let responder = () => {throw new Error('Unexpected network request');};
  let locked = false;
  const context = vm.createContext({
    console: {log: msg => logs.push(String(msg))},
    PropertiesService: {getScriptProperties: () => store},
    Session: {
      getActiveUser: () => ({getEmail() {if (identities.throwActive) throw new Error('Identity unavailable'); return identities.active;}}),
      getEffectiveUser: () => ({getEmail() {if (identities.throwEffective) throw new Error('Identity unavailable'); return identities.effective;}})
    },
    LockService: {getScriptLock: () => ({tryLock: () => {assert.equal(locked, false, 'Nested lock'); locked = true; return true;}, releaseLock: () => {locked = false;}})},
    SpreadsheetApp: {openById: id => {assert.equal(id, 'private-sheet'); return {getSheetByName: name => name === 'Queue' ? sheet : null};}, flush() {}, create: () => ({getSheets: () => [sheet], getId: () => 'private-sheet', getUrl: () => 'https://docs.google.com/private-sheet'})},
    HtmlService: {XFrameOptionsMode: {ALLOWALL: 'ALLOWALL'}, createHtmlOutput: html => ({html, setXFrameOptionsMode(mode) {this.frameMode = mode; return this;}})},
    Utilities: {getUuid: () => crypto.randomUUID(), base64Encode: str => Buffer.from(str).toString('base64')},
    ScriptApp: {getProjectTriggers: () => triggers, newTrigger: name => ({timeBased() {return this;}, everyMinutes(n) {assert.equal(n, 1); return this;}, create() {triggers.push({getHandlerFunction: () => name});}})},
    UrlFetchApp: {fetch(url, options) {requests.push({url, options}); return responder(url, options);}}
  });
  vm.runInContext(source, context, {filename: 'Code.gs'});
  return {context, properties, rows, requests, logs, triggers, identities, respond: fn => {responder = fn;}};
}
function http(status, body, headers = {}) {
  return {getResponseCode: () => status, getContentText: () => JSON.stringify(body), getAllHeaders: () => headers};
}
function event(values = {}) {
  const parameter = {action: 'submit', classId: 'seminar', track: `https://open.spotify.com/track/${TRACK}?si=tracking-value`, requestId: crypto.randomUUID(), website: '', ...values};
  return {parameter, postData: {contents: new URLSearchParams(parameter).toString()}};
}
function payload(output) {
  const match = output.html.match(/window\.top\.postMessage\((\{.*\}),"https:\/\/muk-labs.github.io"\);/);
  assert.ok(match, 'Expected exact-origin acknowledgement');
  return JSON.parse(match[1]);
}
function token(f, overrides = {}) {
  f.properties.SPOTIFY_TOKEN = JSON.stringify({access_token: 'fake-access', refresh_token: 'fake-refresh', owner_id: 'teacher', expires_at: Date.now() + 3600000, authorized_at: Date.now(), ...overrides});
}
function queued(f, values = {}) {
  f.rows.push([new Date().toISOString(), 'seminar', PLAYLIST, TRACK, values.status || 'pending', values.attempts || 0, '', '']);
}

test('accepts canonical, localized and URI track links and strips tracking parameters', () => {
  const f = fixture();
  [`https://open.spotify.com/track/${TRACK}?si=abc`, `https://open.spotify.com/intl-de/track/${TRACK}`, `spotify:track:${TRACK}`, ` https://open.spotify.com/track/${TRACK} `].forEach(link => assert.equal(f.context.parseTrack_(link), TRACK));
});
test('rejects albums, playlists, credentials, spoofed hosts, script URLs, shortlinks and huge inputs', () => {
  const f = fixture();
  [null, {}, `https://open.spotify.com/playlist/${PLAYLIST}`, `https://open.spotify.com/album/${TRACK}`, `https://open.spotify.com@evil.test/track/${TRACK}`, `https://open.spotify.com.evil.test/track/${TRACK}`, `https://evil.test/open.spotify.com/track/${TRACK}`, `http://open.spotify.com/track/${TRACK}`, `javascript:alert(1)`, `https://spotify.link/short`, 'a'.repeat(3000), `spotify:track:${TRACK}extra`].forEach(link => assert.equal(f.context.parseTrack_(link), null));
});
test('anonymous submission durably queues only normalized track and class data', () => {
  const f = fixture(); const e = event({email: 'do-not-save@example.com', name: 'Do not save'});
  const out = f.context.doPost(e); const ack = payload(out);
  assert.equal(ack.ok, true); assert.equal(ack.requestId, e.parameter.requestId);
  assert.equal(f.rows.length, 2); assert.equal(f.rows[1][3], TRACK); assert.equal(f.rows[1][4], 'pending');
  assert.equal(JSON.stringify(f.rows).includes('do-not-save'), false);
  assert.equal(JSON.stringify(f.rows).includes('tracking-value'), false);
  assert.equal(out.html.includes(PLAYLIST), false); assert.equal(f.requests.length, 0);
});
test('retries and duplicates return the same receipt without revealing earlier submissions', () => {
  const f = fixture(); const e = event(); const first = payload(f.context.doPost(e));
  const again = payload(f.context.doPost(e));
  assert.deepEqual(again, first); assert.equal(f.rows.length, 2);
  const other = payload(f.context.doPost(event())); assert.equal(other.message, first.message);
  assert.equal(f.rows.length, 2);
});
test('rejects invalid input, closed or missing classes and honeypot before network or storage mutation', () => {
  const cases = [{track: `https://open.spotify.com/album/${TRACK}`}, {classId: '__proto__'}, {classId: 'missing'}, {action: 'admin'}, {requestId: '</script>'}, {website: 'spam'}];
  cases.forEach(values => {const f = fixture(); assert.equal(payload(f.context.doPost(event(values))).ok, false); assert.equal(f.rows.length, 1); assert.equal(f.requests.length, 0);});
  const f = fixture({CLASSES_JSON: JSON.stringify({seminar: {playlistId: PLAYLIST, open: false}})});
  assert.equal(payload(f.context.doPost(event())).ok, false); assert.equal(f.rows.length, 1);
});
test('queue cap returns identical errors for new tracks and duplicates', () => {
  const f = fixture({MAX_DAILY_SUBMISSIONS: '1'});
  assert.equal(payload(f.context.doPost(event())).ok, true);
  const oldTrack = payload(f.context.doPost(event()));
  const newTrack = payload(f.context.doPost(event({track: `spotify:track:${OTHER}`})));
  assert.equal(newTrack.ok, false); assert.equal(oldTrack.ok, false); assert.equal(newTrack.message, oldTrack.message);
  assert.equal(f.rows.length, 2);
});
test('response cannot inject script via payload or origin', () => {
  const f = fixture();
  const out = f.context.response_('https://muk-labs.github.io', 'x</script><script>evil()', false, '</script><img src=x onerror=evil()>');
  assert.equal(out.html.includes('<img'), false); assert.equal(out.html.includes('<script>evil'), false);
  assert.equal((out.html.match(/<script>/g) || []).length, 1);
  assert.throws(() => fixture({PUBLIC_ORIGIN: 'https://muk-labs.github.io/path'}).context.config_(), /PUBLIC_ORIGIN/);
});
test('setup creates exactly one processing trigger across repeat runs', () => {
  const f = fixture(); f.context.setupCrowdSpot_(); f.context.setupCrowdSpot_();
  assert.equal(f.triggers.length, 1); assert.equal(f.triggers[0].getHandlerFunction(), 'processQueue_');
});
test('public server functions are limited to entry points and guarded editor commands', () => {
  const publicNames = Array.from(source.matchAll(/^function\s+([\w]+)\(/gm)).map(x => x[1]).filter(x => !x.endsWith('_'));
  assert.deepEqual(publicNames.sort(), ['doGet', 'doPost', ...ADMIN_COMMANDS].sort());
});
test('every editor command requires explicit ADMIN_EMAIL before any helper effect', () => {
  for (const command of ADMIN_COMMANDS) {
    for (const email of [undefined, '', '   ']) {
      const f = fixture({ADMIN_EMAIL: email}); const effects = [];
      for (const name of ADMIN_COMMANDS) f.context[name + '_'] = () => {effects.push(name);};
      const before = JSON.stringify(f.properties);
      assert.throws(() => f.context[command](), /Set ADMIN_EMAIL/, command);
      assert.deepEqual(effects, []); assert.equal(JSON.stringify(f.properties), before);
      assert.equal(f.requests.length, 0); assert.equal(f.triggers.length, 0); assert.equal(f.rows.length, 1);
    }
  }
});
test('every editor command rejects anonymous and mismatched identities, even when effective user is owner', () => {
  const cases = [
    {name: 'anonymous visitor executing as owner', active: '', effective: ADMIN_EMAIL},
    {name: 'missing active email', active: undefined, effective: ADMIN_EMAIL},
    {name: 'unrelated same-domain visitor', active: 'student@example.com', effective: ADMIN_EMAIL},
    {name: 'different active and effective account', active: 'other@example.com', effective: 'other@example.com'},
    {name: 'owner active but wrong effective account', active: ADMIN_EMAIL, effective: 'other@example.com'},
    {name: 'owner active but missing effective identity', active: ADMIN_EMAIL, effective: ''},
    {name: 'both anonymous', active: '', effective: ''}
  ];
  for (const command of ADMIN_COMMANDS) {
    for (const identities of cases) {
      const f = fixture(); Object.assign(f.identities, identities); const effects = [];
      for (const name of ADMIN_COMMANDS) f.context[name + '_'] = () => {effects.push(name);};
      const before = JSON.stringify(f.properties);
      assert.throws(() => f.context[command](), /Administrator access required/, `${command}: ${identities.name}`);
      assert.deepEqual(effects, []); assert.equal(JSON.stringify(f.properties), before);
      assert.equal(f.requests.length, 0); assert.equal(f.triggers.length, 0); assert.equal(f.rows.length, 1);
    }
  }
});
test('every editor command fails closed when Google identity lookup is missing or throws', () => {
  for (const command of ADMIN_COMMANDS) {
    for (const failure of ['activeThrows', 'effectiveThrows', 'missingSession', 'missingActiveUser', 'missingEffectiveUser']) {
      const f = fixture(); const effects = [];
      for (const name of ADMIN_COMMANDS) f.context[name + '_'] = () => {effects.push(name);};
      if (failure === 'activeThrows') f.identities.throwActive = true;
      if (failure === 'effectiveThrows') f.identities.throwEffective = true;
      if (failure === 'missingSession') delete f.context.Session;
      if (failure === 'missingActiveUser') f.context.Session.getActiveUser = () => null;
      if (failure === 'missingEffectiveUser') f.context.Session.getEffectiveUser = () => null;
      const before = JSON.stringify(f.properties);
      assert.throws(() => f.context[command](), /Administrator identity unavailable/, `${command}: ${failure}`);
      assert.deepEqual(effects, []); assert.equal(JSON.stringify(f.properties), before);
      assert.equal(f.requests.length, 0); assert.equal(f.triggers.length, 0); assert.equal(f.rows.length, 1);
    }
  }
});
test('configured teacher can dispatch every editor command to exactly its private helper', () => {
  for (const command of ADMIN_COMMANDS) {
    const f = fixture({ADMIN_EMAIL: ' Teacher@Example.COM '});
    Object.assign(f.identities, {active: 'TEACHER@example.com', effective: ' teacher@example.COM '});
    const effects = [];
    for (const name of ADMIN_COMMANDS) f.context[name + '_'] = (...args) => {effects.push({name, args}); return `result:${name}`;};
    assert.equal(f.context[command]({untrusted: 'not passed through'}), `result:${command}`);
    assert.deepEqual(effects, [{name: command, args: []}]);
  }
});
test('caller parameters cannot impersonate the administrator or supply identity', () => {
  for (const command of ADMIN_COMMANDS) {
    const f = fixture(); f.identities.active = ''; const effects = [];
    for (const name of ADMIN_COMMANDS) f.context[name + '_'] = () => {effects.push(name);};
    assert.throws(() => f.context[command]({ADMIN_EMAIL, email: ADMIN_EMAIL, active: ADMIN_EMAIL, effective: ADMIN_EMAIL, parameter: {email: ADMIN_EMAIL}}, ADMIN_EMAIL), /Administrator access required/);
    assert.deepEqual(effects, []);
  }
});
test('manifest requests the Google email scope needed for trusted administrator identity', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../backend/appsscript.json'), 'utf8'));
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/userinfo.email'));
});
test('OAuth state is single-use and expires; invalid state cannot clear valid state', () => {
  const f = fixture(); f.context.showSpotifyAuthorization_(); const state = JSON.parse(f.properties.OAUTH_STATE);
  assert.equal(f.context.consumeState_('wrong'), false); assert.ok(f.properties.OAUTH_STATE);
  assert.equal(f.context.consumeState_(state.value), true); assert.equal(f.context.consumeState_(state.value), false);
  f.properties.OAUTH_STATE = JSON.stringify({value: 'expired', expires: Date.now() - 1});
  assert.equal(f.context.consumeState_('expired'), false);
});
test('forged OAuth callback cannot replace existing Spotify authorization', () => {
  const f = fixture(); token(f); const before = f.properties.SPOTIFY_TOKEN;
  const out = f.context.doGet({parameter: {code: 'forged', state: 'untrusted'}});
  assert.match(out.html, /not completed/); assert.equal(f.properties.SPOTIFY_TOKEN, before); assert.equal(f.requests.length, 0);
});
test('valid OAuth callback stores tokens privately, and replay never exchanges again', () => {
  const f = fixture(); f.context.showSpotifyAuthorization_(); const state = JSON.parse(f.properties.OAUTH_STATE).value;
  f.respond((url) => url.endsWith('/api/token') ? http(200, {access_token: 'NEW_ACCESS_PRIVATE', refresh_token: 'NEW_REFRESH_PRIVATE', expires_in: 3600, scope: 'playlist-modify-private playlist-read-private user-read-private'}) : http(200, {id: 'teacher', email: 'not-stored@example.com'}));
  const e = {parameter: {code: 'valid-code', state}}; const out = f.context.doGet(e);
  assert.match(out.html, /Spotify connected/); assert.equal(out.html.includes('PRIVATE'), false);
  assert.equal(f.properties.SPOTIFY_TOKEN.includes('not-stored'), false);
  assert.equal(JSON.parse(f.properties.SPOTIFY_TOKEN).owner_id, 'teacher');
  const count = f.requests.length; f.context.doGet(e); assert.equal(f.requests.length, count);
});
test('refresh retains old refresh token when Spotify omits rotation and clears expired grants', () => {
  const f = fixture(); token(f, {expires_at: 1});
  f.respond(() => http(200, {access_token: 'new-access', expires_in: 3600}));
  assert.equal(f.context.accessToken_(false).refresh_token, 'fake-refresh');
  assert.equal(JSON.parse(f.properties.SPOTIFY_TOKEN).owner_id, 'teacher');
  f.respond(() => http(400, {error: 'invalid_grant', error_description: 'PRIVATE_DETAIL'}));
  assert.throws(() => f.context.accessToken_(true), /AUTH_REQUIRED/);
  assert.equal(f.properties.SPOTIFY_TOKEN, undefined); assert.ok(f.properties.AUTH_REQUIRED);
  assert.equal(JSON.stringify(f.logs).includes('PRIVATE_DETAIL'), false);
});
test('private playlist check refuses public, collaborative, and other-owner targets', () => {
  [{public: true, collaborative: false, owner: {id: 'teacher'}}, {public: false, collaborative: true, owner: {id: 'teacher'}}, {public: false, collaborative: false, owner: {id: 'someone-else'}}].forEach(info => {
    const f = fixture(); token(f); queued(f); f.respond(() => http(200, info));
    f.context.processQueue_(); assert.equal(f.requests.some(r => r.options.method === 'post'), false);
    assert.equal(f.rows[1][4], 'pending'); assert.equal(f.rows[1][7], 'PLAYLIST_NOT_PRIVATE_OWNED');
  });
});
test('worker checks playlist and adds track through current /items API', () => {
  const f = fixture(); token(f); queued(f);
  f.respond((url, opts) => {
    if (opts.method === 'post') {assert.equal(url, `https://api.spotify.com/v1/playlists/${PLAYLIST}/items`); assert.deepEqual(JSON.parse(opts.payload), {uris: [`spotify:track:${TRACK}`]}); return http(201, {snapshot_id: 'saved'});}
    if (url.includes('?fields=')) return http(200, {public: false, collaborative: false, owner: {id: 'teacher'}});
    return http(200, {items: [], next: null});
  });
  f.context.processQueue_(); assert.equal(f.rows[1][4], 'added'); assert.equal(f.properties.WORKER_LEASE, undefined);
});
test('ambiguous prior success is recovered by finding an existing track on a later page', () => {
  const f = fixture(); token(f); queued(f, {attempts: 1});
  f.respond((url, opts) => {
    assert.notEqual(opts.method, 'post');
    if (url.includes('?fields=')) return http(200, {public: false, collaborative: false, owner: {id: 'teacher'}});
    if (url.includes('offset=0')) return http(200, {items: [], next: 'https://do-not-follow-this.example/'});
    assert.ok(url.includes('offset=50')); return http(200, {items: [{item: {id: TRACK}}], next: null});
  });
  f.context.processQueue_(); assert.equal(f.rows[1][4], 'added'); assert.equal(f.requests.length, 3);
});
test('rate limiting persists Retry-After and stops the worker without dropping submissions', () => {
  const f = fixture(); token(f); queued(f); const start = Date.now();
  f.rows.push([new Date().toISOString(), 'seminar', PLAYLIST, OTHER, 'pending', 0, '', '']);
  f.respond(() => http(429, {error: {message: 'Do not expose private response'}}, {'Retry-After': '120'}));
  f.context.processQueue_();
  assert.equal(f.rows[1][4], 'pending'); assert.equal(f.rows[1][7], 'SPOTIFY_429');
  assert.ok(new Date(f.rows[1][6]).getTime() >= start + 120000);
  assert.ok(Number(f.properties.API_RETRY_AFTER) >= start + 120000);
  f.context.processQueue_(); assert.equal(f.requests.length, 1);
  assert.equal(f.rows[2][5], 0, 'The next row must respect the app-wide cooldown too');
});
test('worker resolves receipt identity again if the teacher reordered the sheet during an API request', () => {
  const f = fixture(); token(f); queued(f);
  f.rows.push([new Date().toISOString(), 'seminar', PLAYLIST, OTHER, 'pending', 0, '', '']);
  f.respond((url) => {
    if (url.includes('?fields=')) { const row = f.rows[1]; f.rows[1] = f.rows[2]; f.rows[2] = row; return http(200, {public: false, collaborative: false, owner: {id: 'teacher'}}); }
    return http(200, {items: [{item: {id: TRACK}}, {item: {id: OTHER}}], next: null});
  });
  f.context.processQueue_(); assert.equal(f.rows[1][3], OTHER); assert.equal(f.rows[2][3], TRACK);
  assert.equal(f.rows[1][4], 'added'); assert.equal(f.rows[2][4], 'added');
});
test('missing Spotify authorization retains queued entries for reconnection', () => {
  const f = fixture(); queued(f); f.context.processQueue_();
  assert.equal(f.rows[1][4], 'pending'); assert.equal(f.rows[1][7], 'RECONNECT_SPOTIFY'); assert.equal(f.requests.length, 0);
});
test('API paths cannot cause server-side requests to arbitrary hosts', () => {
  const f = fixture(); assert.throws(() => f.context.rawSpotify_('https://evil.test', 'get', null, 'token'), /INVALID_API_PATH/); assert.equal(f.requests.length, 0);
});
