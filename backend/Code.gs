/** CrowdSpot — deploy as a web app, execute as yourself, access: Anyone.
 * Only doGet and doPost are public. Trailing-underscore functions are deliberately
 * inaccessible through google.script.run, including all teacher operations.
 * Keep credentials in Script Properties, never in GitHub or the student page.
 */
const CS_HEADERS_ = ['received_at', 'class_id', 'playlist_id', 'track_id', 'status', 'attempts', 'retry_after', 'detail'];
const CS_ACCEPTED_ = 'Your suggestion has been received. It will be added automatically shortly.';
const CS_SCOPES_ = 'playlist-modify-private playlist-read-private user-read-private';

function props_() { return PropertiesService.getScriptProperties(); }
function config_() {
  const p = props_().getProperties();
  const classes = JSON.parse(p.CLASSES_JSON || '{}');
  if (!p.PUBLIC_ORIGIN || !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(p.PUBLIC_ORIGIN)) throw new Error('Set PUBLIC_ORIGIN to the exact HTTPS origin, without a path or trailing slash.');
  Object.keys(classes).forEach(function (key) {
    const c = classes[key];
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key) || !c || !/^[a-zA-Z0-9]{22}$/.test(c.playlistId) || typeof c.open !== 'boolean') throw new Error('Invalid CLASSES_JSON.');
  });
  return { origin: p.PUBLIC_ORIGIN, classes: classes, sheetId: p.SHEET_ID,
    maxDaily: boundedNumber_(p.MAX_DAILY_SUBMISSIONS, 500, 1, 5000),
    maxRows: boundedNumber_(p.MAX_QUEUE_ROWS, 10000, 1, 50000) };
}
function boundedNumber_(value, fallback, min, max) {
  const n = Number(value);
  return value && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('BUSY');
  try { return fn(); } finally { lock.releaseLock(); }
}
function parseTrack_(input) {
  if (typeof input !== 'string' || input.length > 2048) return null;
  const value = input.trim();
  let m = /^spotify:track:([a-zA-Z0-9]{22})$/.exec(value);
  if (!m) m = /^https:\/\/open\.spotify\.com\/(?:intl-[a-zA-Z-]+\/)?track\/([a-zA-Z0-9]{22})\/?(?:[?#][^\s]*)?$/.exec(value);
  return m ? m[1] : null;
}
function queueSheet_(cfg) {
  if (!cfg.sheetId) throw new Error('Run setupCrowdSpot_ first.');
  const sheet = SpreadsheetApp.openById(cfg.sheetId).getSheetByName('Queue');
  if (!sheet) throw new Error('Queue sheet is missing.');
  return sheet;
}
function queueRows_(sheet) {
  return sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, CS_HEADERS_.length).getValues() : [];
}

/** Public student entry point: POST enqueues, never exposes queue or playlist. */
function doPost(e) {
  const p = e && e.parameter || {};
  const requestId = typeof p.requestId === 'string' && /^[a-zA-Z0-9-]{16,100}$/.test(p.requestId) ? p.requestId : '';
  let origin = '';
  try {
    const cfg = config_();
    origin = cfg.origin;
    if (!requestId || !e.postData || e.postData.contents.length > 5000 || p.action !== 'submit') return response_(origin, requestId, false, 'Please reload the page and try again.');
    if (p.website) return response_(origin, requestId, false, 'The submission could not be accepted.');
    const track = parseTrack_(p.track);
    if (!track) return response_(origin, requestId, false, 'Please paste a Spotify track link, rather than an album or playlist.');
    const cls = Object.prototype.hasOwnProperty.call(cfg.classes, p.classId) && cfg.classes[p.classId];
    if (!cls || !cls.open) return response_(origin, requestId, false, 'Submissions are closed for this class.');
    withLock_(function () {
      const sheet = queueSheet_(cfg);
      const rows = queueRows_(sheet);
      const now = new Date();
      const midnight = new Date(now); midnight.setUTCHours(0, 0, 0, 0);
      const daily = rows.filter(function (r) { return new Date(r[0]).getTime() >= midnight.getTime(); }).length;
      if (daily >= cfg.maxDaily || rows.length >= cfg.maxRows) throw new Error('CAPACITY');
      // Apply capacity limits before duplicate detection: even when full, the
      // public response must not reveal whether a candidate was submitted before.
      if (rows.some(function (r) { return r[1] === p.classId && r[2] === cls.playlistId && r[3] === track; })) return;
      // These fields are all constrained; arbitrary text cannot become a Sheet formula.
      sheet.appendRow([now.toISOString(), p.classId, cls.playlistId, track, 'pending', 0, '', '']);
      SpreadsheetApp.flush();
    });
    return response_(origin, requestId, true, CS_ACCEPTED_);
  } catch (error) {
    const message = error.message === 'CAPACITY' ? 'The submission limit has been reached. Please let your teacher know.' : 'The suggestion could not be confirmed. Please try again shortly or let your teacher know.';
    return response_(origin, requestId, false, message);
  }
}
function jsonForHtml_(value) { return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
function response_(origin, requestId, ok, message) {
  const payload = {type: 'crowdspot:result', requestId: requestId, ok: ok, message: message};
  // A form-target iframe avoids Apps Script's CORS redirect limitations.
  // Use top because HtmlService creates an additional internal iframe.
  const script = origin ? '<script>window.top.postMessage(' + jsonForHtml_(payload) + ',' + jsonForHtml_(origin) + ');</script>' : '';
  return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8"><title>CrowdSpot</title><p>' + escapeHtml_(message) + '</p>' + script)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function escapeHtml_(value) { return String(value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

/** Teacher setup. Run from the Apps Script editor, never the public web page. */
function setupCrowdSpot_() {
  const cfg = config_();
  withLock_(function () {
    if (!cfg.sheetId) {
      const file = SpreadsheetApp.create('CrowdSpot — private submissions');
      const sheet = file.getSheets()[0]; sheet.setName('Queue');
      sheet.appendRow(CS_HEADERS_); sheet.setFrozenRows(1);
      props_().setProperty('SHEET_ID', file.getId());
      console.log('Private submission sheet: ' + file.getUrl());
    } else {
      const sheet = queueSheet_(cfg);
      if (sheet.getLastRow() === 0) sheet.appendRow(CS_HEADERS_);
    }
    const exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'processQueue_'; });
    if (!exists) ScriptApp.newTrigger('processQueue_').timeBased().everyMinutes(1).create();
  });
  console.log('Queue ready. Authorize Spotify with showSpotifyAuthorization_. Keep the sheet and script private.');
}
function showSpotifyAuthorization_() {
  const p = props_().getProperties();
  if (!p.CLIENT_ID || !p.CLIENT_SECRET || !/^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(p.REDIRECT_URI || '')) throw new Error('Set CLIENT_ID, CLIENT_SECRET and the deployed /exec REDIRECT_URI in Script Properties.');
  const state = Utilities.getUuid() + Utilities.getUuid();
  withLock_(function () { props_().setProperty('OAUTH_STATE', JSON.stringify({value: state, expires: Date.now() + 600000})); });
  const values = {client_id: p.CLIENT_ID, response_type: 'code', redirect_uri: p.REDIRECT_URI, scope: CS_SCOPES_, state: state, show_dialog: 'true'};
  const url = 'https://accounts.spotify.com/authorize?' + Object.keys(values).map(function (k) { return k + '=' + encodeURIComponent(values[k]); }).join('&');
  console.log('Open this authorization link yourself within 10 minutes. Do not share it:\n' + url);
  return url;
}
function consumeState_(state) {
  return withLock_(function () {
    const stored = JSON.parse(props_().getProperty('OAUTH_STATE') || 'null');
    if (!stored || typeof state !== 'string' || state !== stored.value || stored.expires < Date.now()) return false;
    props_().deleteProperty('OAUTH_STATE');
    return true;
  });
}
/** Public OAuth callback. No authorization URL, tokens or admin data are served. */
function doGet(e) {
  const p = e && e.parameter || {};
  if (!p.code && !p.error) return HtmlService.createHtmlOutput('<h1>CrowdSpot</h1><p>Use the submission link provided by your teacher.</p>');
  try {
    if (!consumeState_(p.state)) throw new Error('STATE');
    if (p.error || !p.code || p.code.length > 2000) throw new Error('DENIED');
    const token = tokenRequest_({grant_type: 'authorization_code', code: p.code, redirect_uri: props_().getProperty('REDIRECT_URI')});
    if (!token.refresh_token || !token.access_token) throw new Error('TOKEN');
    const required = ['playlist-modify-private', 'playlist-read-private', 'user-read-private'];
    if (token.scope && required.some(function (s) { return token.scope.split(' ').indexOf(s) < 0; })) throw new Error('SCOPES');
    const profile = rawSpotify_('/me', 'get', null, token.access_token);
    if (!profile.id) throw new Error('PROFILE');
    token.owner_id = profile.id;
    token.expires_at = Date.now() + Number(token.expires_in || 3600) * 1000;
    token.authorized_at = Date.now();
    withLock_(function () { props_().setProperty('SPOTIFY_TOKEN', JSON.stringify(token)); props_().deleteProperty('AUTH_REQUIRED'); });
    return HtmlService.createHtmlOutput('<h1>Spotify connected</h1><p>CrowdSpot can now process queued suggestions. You may close this tab.</p>');
  } catch (error) {
    // Do not reflect Spotify's token response or incoming callback parameters.
    return HtmlService.createHtmlOutput('<h1>Connection not completed</h1><p>Run showSpotifyAuthorization_ in your Apps Script editor for a fresh link, then try again. Existing queued suggestions are safe.</p>');
  }
}
function disconnectSpotify_() {
  withLock_(function () {
    props_().deleteProperty('SPOTIFY_TOKEN'); props_().deleteProperty('OAUTH_STATE');
    props_().setProperty('AUTH_REQUIRED', 'Reconnect Spotify from the Apps Script editor.');
  });
  console.log('Stored Spotify authorization removed. Queued suggestions are retained. Revoke CrowdSpot in Spotify account Apps to revoke access at Spotify as well.');
}
function tokenRequest_(payload) {
  const p = props_().getProperties();
  const response = UrlFetchApp.fetch('https://accounts.spotify.com/api/token', {
    method: 'post', payload: payload, muteHttpExceptions: true,
    headers: {Authorization: 'Basic ' + Utilities.base64Encode(p.CLIENT_ID + ':' + p.CLIENT_SECRET)}
  });
  let body; try { body = JSON.parse(response.getContentText()); } catch (error) { body = {}; }
  if (response.getResponseCode() !== 200) {
    const err = new Error(body.error === 'invalid_grant' ? 'AUTH_REQUIRED' : 'TOKEN_UNAVAILABLE');
    err.retry = true; throw err;
  }
  return body;
}
function accessToken_(force) {
  const stored = JSON.parse(props_().getProperty('SPOTIFY_TOKEN') || 'null');
  if (!stored || !stored.refresh_token) throw new Error('AUTH_REQUIRED');
  if (!force && stored.expires_at > Date.now() + 60000) return stored;
  let next;
  try { next = tokenRequest_({grant_type: 'refresh_token', refresh_token: stored.refresh_token}); }
  catch (error) {
    if (error.message === 'AUTH_REQUIRED') withLock_(function () {
      const current = JSON.parse(props_().getProperty('SPOTIFY_TOKEN') || 'null');
      if (current && current.refresh_token === stored.refresh_token) {
        props_().deleteProperty('SPOTIFY_TOKEN');
        props_().setProperty('AUTH_REQUIRED', 'Spotify authorization expired or was revoked. Run showSpotifyAuthorization_.');
      }
    });
    throw error;
  }
  if (!next.access_token) throw new Error('TOKEN_UNAVAILABLE');
  next.refresh_token = next.refresh_token || stored.refresh_token;
  next.owner_id = stored.owner_id; next.authorized_at = stored.authorized_at;
  next.expires_at = Date.now() + Number(next.expires_in || 3600) * 1000;
  return withLock_(function () {
    const current = JSON.parse(props_().getProperty('SPOTIFY_TOKEN') || 'null');
    // A teacher may reconnect or disconnect while the worker is in flight.
    if (!current) throw new Error('AUTH_REQUIRED');
    if (current.refresh_token !== stored.refresh_token) return current;
    props_().setProperty('SPOTIFY_TOKEN', JSON.stringify(next)); return next;
  });
}
function rawSpotify_(path, method, body, token) {
  if (!/^\/(?:me$|playlists\/[a-zA-Z0-9]{22}(?:\?|\/items(?:\?|$)|$))/.test(path)) throw new Error('INVALID_API_PATH');
  const options = {method: method || 'get', muteHttpExceptions: true, followRedirects: false, headers: {Authorization: 'Bearer ' + token}};
  if (body) { options.contentType = 'application/json'; options.payload = JSON.stringify(body); }
  const response = UrlFetchApp.fetch('https://api.spotify.com/v1' + path, options);
  const status = response.getResponseCode();
  if (status >= 200 && status < 300) {
    const text = response.getContentText();
    return text ? JSON.parse(text) : {};
  }
  const error = new Error('SPOTIFY_' + status); error.status = status;
  error.retry = status === 429 || status >= 500;
  if (status === 429) {
    const h = response.getAllHeaders();
    const key = Object.keys(h).filter(function (k) { return k.toLowerCase() === 'retry-after'; })[0];
    error.retryAfter = boundedNumber_(key && h[key], 60, 1, 86400);
    withLock_(function () {
      const deadline = Date.now() + error.retryAfter * 1000;
      props_().setProperty('API_RETRY_AFTER', String(Math.max(Number(props_().getProperty('API_RETRY_AFTER')) || 0, deadline)));
    });
  }
  throw error;
}
function spotify_(path, method, body) {
  let token = accessToken_(false);
  try { return rawSpotify_(path, method, body, token.access_token); }
  catch (error) {
    if (error.status !== 401) throw error;
    token = accessToken_(true);
    return rawSpotify_(path, method, body, token.access_token);
  }
}
function ensurePrivatePlaylist_(playlistId) {
  const info = spotify_('/playlists/' + playlistId + '?fields=public,collaborative,owner(id)');
  const token = accessToken_(false);
  if (info.public !== false || info.collaborative !== false || !info.owner || info.owner.id !== token.owner_id) throw new Error('PLAYLIST_NOT_PRIVATE_OWNED');
}
function playlistContains_(playlistId, trackId) {
  // Construct every URL locally; do not fetch a caller-controlled URL or next URL.
  for (let offset = 0; offset < 10000; offset += 50) {
    const page = spotify_('/playlists/' + playlistId + '/items?limit=50&offset=' + offset);
    if (!Array.isArray(page.items)) throw new Error('PLAYLIST_RESPONSE_UNAVAILABLE');
    if (page.items.some(function (entry) {
      const track = entry.item || entry.track;
      return track && (track.id === trackId || track.linked_from && track.linked_from.id === trackId);
    })) return true;
    if (!page.next) return false;
  }
  throw new Error('PLAYLIST_TOO_LARGE');
}

/** Owner's every-minute trigger. Network work runs outside the submission lock. */
function processQueue_() {
  const now = Date.now();
  // Spotify's quota applies to the app, not just the row that received 429.
  if (Number(props_().getProperty('API_RETRY_AFTER')) > now) return;
  const lease = Utilities.getUuid();
  const obtained = withLock_(function () {
    const existing = JSON.parse(props_().getProperty('WORKER_LEASE') || 'null');
    if (existing && existing.until > now) return false;
    props_().setProperty('WORKER_LEASE', JSON.stringify({id: lease, until: now + 360000})); return true;
  });
  if (!obtained) return;
  try {
    const cfg = config_(); const sheet = queueSheet_(cfg); const rows = queueRows_(sheet);
    const checked = {}; let processed = 0;
    for (let i = 0; i < rows.length && processed < 8 && Date.now() - now < 40000; i++) {
      const row = rows[i];
      if (row[4] !== 'pending' || row[6] && new Date(row[6]).getTime() > Date.now()) continue;
      const cls = Object.prototype.hasOwnProperty.call(cfg.classes, row[1]) && cfg.classes[row[1]];
      // Existing entries keep their destination. A changed mapping needs manual review.
      if (!cls || cls.playlistId !== row[2]) { writeState_(sheet, i, row, 'paused', 'CLASS_CONFIGURATION_CHANGED', 0); continue; }
      processed++;
      try {
        if (!checked[row[2]]) { ensurePrivatePlaylist_(row[2]); checked[row[2]] = true; }
        // Check on every retry too: a prior request may have succeeded before
        // an interrupted execution could mark the Sheet row as complete.
        if (!playlistContains_(row[2], row[3])) spotify_('/playlists/' + row[2] + '/items', 'post', {uris: ['spotify:track:' + row[3]]});
        writeState_(sheet, i, row, 'added', '', 0);
      } catch (error) {
        if (error.message === 'AUTH_REQUIRED') {
          writeState_(sheet, i, row, 'pending', 'RECONNECT_SPOTIFY', 300);
          break;
        }
        if (error.message === 'PLAYLIST_NOT_PRIVATE_OWNED' || error.status === 403 || error.status === 404) {
          writeState_(sheet, i, row, 'pending', error.message, 3600); break;
        }
        if (error.status === 400) { writeState_(sheet, i, row, 'failed', 'TRACK_REJECTED', 0); continue; }
        const wait = error.retryAfter || Math.min(3600, 60 * Math.pow(2, Math.min(Number(row[5]) || 0, 6)));
        writeState_(sheet, i, row, 'pending', safeError_(error), wait);
        // Avoid hammering Spotify after a quota/network failure.
        if (error.status === 429 || !error.status || error.status >= 500) break;
      }
    }
  } finally {
    withLock_(function () {
      const current = JSON.parse(props_().getProperty('WORKER_LEASE') || 'null');
      if (current && current.id === lease) props_().deleteProperty('WORKER_LEASE');
    });
  }
}
function safeError_(error) {
  return /^SPOTIFY_\d{3}$/.test(error.message) || /^(TOKEN_UNAVAILABLE|PLAYLIST_TOO_LARGE|PLAYLIST_RESPONSE_UNAVAILABLE)$/.test(error.message) ? error.message : 'TEMPORARY_ERROR';
}
function writeState_(sheet, unusedIndex, row, status, detail, wait) {
  const values = [status, Number(row[5] || 0) + 1, wait ? new Date(Date.now() + wait * 1000).toISOString() : '', detail];
  withLock_(function () {
    // Re-resolve the immutable receipt tuple after network requests. A teacher
    // may have reordered the sheet while Spotify was responding.
    const current = queueRows_(sheet);
    const index = current.findIndex(function (candidate) { return candidate.slice(0, 4).every(function (value, j) { return String(value) === String(row[j]); }); });
    if (index < 0) return;
    sheet.getRange(index + 2, 5, 1, 4).setValues([values]);
    SpreadsheetApp.flush();
  });
}
