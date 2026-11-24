'use strict';

(() => {
  const config = window.CROWDSPOT_CONFIG || {};
  const form = document.getElementById('submission-form');
  const input = document.getElementById('track');
  const button = document.getElementById('submit-button');
  const buttonLabel = document.getElementById('button-label');
  const status = document.getElementById('submission-status');
  const params = new URLSearchParams(window.location.search);
  const classId = params.get('class') || config.defaultClass || 'seminar';
  let pending = null;
  let ready = false;

  // No Spotify authorization tokens, playlist contents, or participant identities
  // are present in this client. Only a single submission acknowledgement returns.
  function setStatus(message, state = 'info') {
    status.textContent = message;
    status.dataset.state = state;
  }

  function parseTrack(value) {
    const text = value.trim();
    const uri = /^spotify:track:([A-Za-z0-9]{22})$/.exec(text);
    if (uri) return `https://open.spotify.com/track/${uri[1]}`;
    try {
      const url = new URL(text);
      if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || url.port || url.username || url.password) return null;
      const path = /^\/(?:intl-[a-zA-Z-]+\/)?track\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname);
      return path ? `https://open.spotify.com/track/${path[1]}` : null;
    } catch {
      return null;
    }
  }

  function validEndpoint(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'script.google.com' && !url.port && !url.username && !url.password && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) && !url.search && !url.hash;
    } catch {
      return false;
    }
  }

  function trustedResponseOrigin(origin) {
    try {
      const url = new URL(origin);
      return url.protocol === 'https:' && !url.port && (url.hostname === 'script.google.com' || url.hostname.endsWith('.googleusercontent.com'));
    } catch {
      return false;
    }
  }

  function finish() {
    if (!pending) return;
    clearTimeout(pending.timeout);
    pending.frame.remove();
    pending = null;
    button.disabled = !ready;
    button.dataset.busy = 'false';
    buttonLabel.textContent = 'Submit track';
    input.readOnly = false;
    form.removeAttribute('aria-busy');
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!pending || !trustedResponseOrigin(event.origin) || !data || typeof data !== 'object' || data.type !== 'crowdspot:result' || data.requestId !== pending.id || typeof data.ok !== 'boolean') return;
    // Apps Script uses a nested HTML-service iframe; its Window is intentionally
    // not the outer frame's contentWindow. A cryptographic nonce binds the reply.
    finish();
    if (data.ok) {
      input.value = '';
      input.removeAttribute('aria-invalid');
      setStatus('Your track is received. It will be added automatically shortly. Thanks for sharing a little of your listening world.', 'success');
      buttonLabel.textContent = 'Submit another track';
    } else {
      const message = typeof data.message === 'string' && data.message.length <= 350 ? data.message : 'We couldn’t save your track. Please try again later.';
      setStatus(message, 'error');
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!ready || pending) return;
    const track = parseTrack(input.value);
    if (!track) {
      input.setAttribute('aria-invalid', 'true');
      setStatus('Please paste a Spotify track link. Album, artist, playlist, and shortened links won’t work here. Open the track in Spotify and choose Share → Copy link.', 'error');
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    if (!window.crypto?.getRandomValues) {
      setStatus('Secure submission is unavailable in this browser. Please open the HTTPS version of this page in a current browser.', 'error');
      return;
    }
    const bytes = window.crypto.getRandomValues(new Uint8Array(24));
    const requestId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const frame = document.createElement('iframe');
    frame.name = `crowdspot-${requestId}`;
    frame.title = 'Submission acknowledgement';
    frame.className = 'response-frame';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    document.body.appendChild(frame);
    input.value = track;
    document.getElementById('request-id').value = requestId;
    form.action = config.endpoint;
    form.target = frame.name;
    form.setAttribute('aria-busy', 'true');
    input.readOnly = true;
    button.disabled = true;
    button.dataset.busy = 'true';
    buttonLabel.textContent = 'Sending your track…';
    setStatus('Sending privately. You can leave this page open for a moment.');
    pending = {
      id: requestId,
      frame,
      timeout: setTimeout(() => {
        finish();
        setStatus('We couldn’t confirm whether your track was received. You can safely try again; duplicate tracks won’t be added twice.', 'error');
      }, 45000)
    };
    // Native form navigation avoids cross-origin fetch/preflight restrictions.
    // The response is an HTML acknowledgement that posts a message to this page.
    HTMLFormElement.prototype.submit.call(form);
  });

  input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
  document.getElementById('class-id').value = classId;
  if (typeof config.title === 'string' && config.title.trim() && config.title !== 'A track worth sharing.') {
    document.getElementById('headline').textContent = config.title.trim();
    document.title = `${config.title.trim()} — CrowdSpot`;
  }
  ready = validEndpoint(config.endpoint) && /^[A-Za-z0-9_-]{1,64}$/.test(classId);
  button.disabled = !ready;
  if (!config.endpoint) {
    setStatus('Submissions aren’t open yet. Your teacher is connecting this listening space.');
  } else if (!ready) {
    setStatus('This submission link isn’t ready. Please ask your teacher for the current link.', 'error');
  }
})();
