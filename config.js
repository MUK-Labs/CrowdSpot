// Public website configuration. Never put Spotify tokens, secrets, or playlist
// contents in this file. Complete the backend setup described in the README.
window.CROWDSPOT_CONFIG = Object.freeze({
  endpoint: '', // Your deployed Google Apps Script URL, ending in /exec.
  defaultClass: 'seminar', // Must match a class configured in the private backend.
  title: 'A track worth sharing.'
});
