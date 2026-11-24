const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const validTrack = 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh';
const endpoint = 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec';

function browser(config = { endpoint, defaultClass: 'seminar' }, query = '') {
  const elements = new Map();
  const messages = {};
  let nativeSubmissions = 0;
  let timeout;
  const children = [];
  function element() {
    return {
      value: '', textContent: '', dataset: {}, attributes: {}, listeners: {},
      addEventListener(name, handler) { this.listeners[name] = handler; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      focus() { this.focused = true; },
      remove() { this.removed = true; }
    };
  }
  const document = {
    title: 'CrowdSpot',
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element,
    body: { appendChild(child) { children.push(child); } }
  };
  const window = {
    CROWDSPOT_CONFIG: config,
    location: { search: query },
    crypto: { getRandomValues(bytes) { return bytes.fill(123); } },
    addEventListener(name, handler) { messages[name] = handler; }
  };
  vm.runInNewContext(source, {
    window, document, URL, URLSearchParams, Uint8Array,
    HTMLFormElement: { prototype: { submit() { nativeSubmissions += 1; } } },
    setTimeout(fn) { timeout = fn; return 1; },
    clearTimeout() { timeout = null; }
  });
  return {
    get: (id) => document.getElementById(id),
    window, children,
    count: () => nativeSubmissions,
    submit(track = validTrack) {
      document.getElementById('track').value = track;
      document.getElementById('submission-form').listeners.submit({ preventDefault() {} });
    },
    acknowledge(overrides = {}) {
      messages.message({
        origin: 'https://n-example-script.googleusercontent.com',
        data: { type: 'crowdspot:result', requestId: document.getElementById('request-id').value, ok: true },
        ...overrides
      });
    },
    expire() { assert.ok(timeout); timeout(); }
  };
}

test('unconfigured or invalid endpoint never sends a request or fabricates success', () => {
  for (const invalid of ['', 'https://evil.example/exec', 'http://script.google.com/macros/s/abc/exec', `${endpoint}?override=1`]) {
    const page = browser({ endpoint: invalid });
    page.submit();
    assert.equal(page.count(), 0);
    assert.equal(page.get('submit-button').disabled, true);
    assert.notEqual(page.get('submission-status').dataset.state, 'success');
  }
});

test('track URLs, international URLs, and Spotify URIs are normalized without tracking parameters', () => {
  for (const input of [validTrack, `${validTrack}?si=private-sharing-data`, validTrack.replace('/track/', '/intl-de/track/'), 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh']) {
    const page = browser();
    page.submit(input);
    assert.equal(page.count(), 1);
    assert.equal(page.get('track').value, validTrack);
    assert.equal(page.get('submission-form').action, endpoint);
  }
});

test('non-track and deceptive URLs never leave the browser', () => {
  for (const input of ['', 'not a URL', validTrack.replace('/track/', '/playlist/'), validTrack.replace('open.spotify.com', 'open.spotify.com.evil.example'), validTrack.replace('https:', 'http:'), validTrack.replace('https://', 'https://name:password@'), `${validTrack}/extra`, 'https://spotify.link/short', 'javascript:alert(1)']) {
    const page = browser();
    page.submit(input);
    assert.equal(page.count(), 0, input);
    assert.equal(page.get('track').attributes['aria-invalid'], 'true');
    assert.equal(page.get('submission-status').dataset.state, 'error');
  }
});

test('only the selected class code is submitted; malformed class codes disable submission', () => {
  const page = browser(undefined, '?class=analysis-01');
  assert.equal(page.get('class-id').value, 'analysis-01');
  const invalid = browser(undefined, '?class=../../secret');
  invalid.submit();
  assert.equal(invalid.count(), 0);
});

test('in-flight requests disable repeats and messages require both trusted origin and nonce', () => {
  const page = browser();
  page.submit();
  page.submit();
  assert.equal(page.count(), 1);
  assert.equal(page.get('submit-button').disabled, true);
  page.acknowledge({ origin: 'https://attacker.example' });
  page.acknowledge({ origin: 'https://googleusercontent.com.attacker.example' });
  page.acknowledge({ data: { type: 'crowdspot:result', requestId: 'wrong-nonce', ok: true } });
  assert.equal(page.get('submit-button').disabled, true);
  assert.notEqual(page.get('submission-status').dataset.state, 'success');
  page.acknowledge();
  assert.equal(page.get('submit-button').disabled, false);
  assert.equal(page.get('submission-status').dataset.state, 'success');
  assert.equal(page.get('track').value, '');
  assert.equal(page.children[0].removed, true);
});

test('timeout honestly reports an unknown outcome and permits a safe retry', () => {
  const page = browser();
  page.submit();
  page.expire();
  assert.match(page.get('submission-status').textContent, /couldn’t confirm whether/);
  assert.equal(page.get('submit-button').disabled, false);
  page.acknowledge(); // A late response must not change the timed-out request.
  assert.equal(page.get('submission-status').dataset.state, 'error');
  page.submit();
  assert.equal(page.count(), 2);
});

test('backend rejection is displayed as text, never as HTML or success', () => {
  const page = browser();
  page.submit();
  page.acknowledge({ data: { type: 'crowdspot:result', requestId: page.get('request-id').value, ok: false, message: '<img src=x onerror=alert(1)>' } });
  assert.equal(page.get('submission-status').dataset.state, 'error');
  assert.equal(page.get('submission-status').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(page.get('track').value, validTrack);
});

test('lack of secure randomness blocks transmission', () => {
  const page = browser();
  page.window.crypto = undefined;
  page.submit();
  assert.equal(page.count(), 0);
  assert.match(page.get('submission-status').textContent, /Secure submission is unavailable/);
});
