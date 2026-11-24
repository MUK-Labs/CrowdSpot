// Public website configuration. Never put Spotify tokens, secrets, or playlist
// contents in this file. Complete the backend setup described in the README.
window.CROWDSPOT_CONFIG = Object.freeze({
  endpoint: 'https://script.google.com/macros/s/AKfycbw-su7WnGUcvlktomN6nKxuD_bT2ARdfcOTXKAAVRDZCIEotjHTfitRgBsrrHxYI4XJ/exec', // Your deployed Google Apps Script URL, ending in /exec.
  // Submissions require an explicit ?class=... link. There is no default class.
  title: 'A track worth sharing.'
});
