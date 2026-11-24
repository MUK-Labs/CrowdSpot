# CrowdSpot

**A track worth sharing. A name you can keep to yourself.**

CrowdSpot lets students suggest Spotify tracks without seeing the collection or identifying themselves. A mobile-friendly GitHub Pages form accepts a track link; a private Google Apps Script service queues it and adds it to the teacher's Spotify playlist.

**[Open CrowdSpot](https://muk-labs.github.io/CrowdSpot/)** · **[Teacher setup](docs/SETUP.md)**

> The frontend works as a setup preview until an Apps Script deployment is connected in `config.js`. It does not pretend to accept submissions before that connection exists. Spotify authorization and a destination playlist must be configured by the teacher.

## For students

1. Open the link provided by your teacher.
2. Copy a track link from Spotify's **Share → Copy song link** menu.
3. Paste it into CrowdSpot and submit.

No student login, names, email addresses, playlist browsing, or public contribution history. The confirmation means the suggestion was received in the private queue; transfer usually follows within a few minutes. Duplicate suggestions receive the same confirmation, so the form cannot reveal what others have submitted.

## For teachers

- Use your own Spotify Premium account and a private, non-collaborative playlist.
- Share a separate class link such as `https://muk-labs.github.io/CrowdSpot/?class=seminar`.
- The general website selects no class and cannot submit tracks. A valid, explicit `?class=...` link is required; there is no default playlist.
- Keep class-to-playlist mappings and all Spotify credentials in Apps Script, outside GitHub.
- Review a private queue spreadsheet for transfer status and failures.
- Close a class's submissions, reconnect Spotify, or process queued entries from the private Apps Script editor.

Read the **[step-by-step setup guide](docs/SETUP.md)**. No paid automation service or always-on computer is required; Google and Spotify service quotas apply. Reconnect Spotify when its authorization expires (currently every six months).

## Architecture

| Component | Responsibility |
| --- | --- |
| GitHub Pages | Static interface, validation, confirmed receipt display |
| Apps Script web app | Input validation, class allowlist, receipt acknowledgment, OAuth callback |
| Private Google Sheet | Durable queue, deduplication and transfer status |
| Apps Script timer | Refresh authorization, check destination, transfer and retry |
| Spotify | Teacher-owned private playlists |

The frontend posts a regular HTML form into a hidden iframe. The server replies using `postMessage` addressed to the configured Pages origin, with a random request identifier. This avoids unsupported JSON preflights and opaque `no-cors` responses that cannot prove a submission succeeded. The frontend checks the Google response origin and identifier. There is no public API to retrieve suggestions or tokens.

The editor exposes `setupCrowdSpot`, `showSpotifyAuthorization`, `processQueue` and `disconnectSpotify`. Every visible command requires the active and effective Google account emails to match the private `ADMIN_EMAIL` setting. Anonymous visitors cannot run them. Internal helpers keep their trailing `_` and are inaccessible to HTML-service clients. A cryptographic, single-use, time-limited state protects the OAuth callback. Refresh tokens remain in Script Properties. Only configured playlists can receive submissions.

## Development

No build step or npm dependencies:

```sh
npm run check
npm run serve
```

Open `http://localhost:8080` for interface development. Real submissions require an HTTPS deployment whose origin matches `PUBLIC_ORIGIN`; use a separate test deployment rather than changing the production origin. The test suite runs with mocked Google/Spotify services and does not need account credentials. A real account-authorized test is still necessary after deployment.

GitHub Pages serves `main` from the repository root. The check workflow validates JavaScript and runs the tests on pushes and pull requests. After changing Apps Script code, create a new web-app deployment version as described in the setup guide; GitHub commits alone do not deploy the Google backend.

## Privacy and operational limits

CrowdSpot does not collect student names, emails or IP addresses in its application data, and has no analytics, remote fonts or Spotify embeds. It stores track IDs, class IDs, timestamps and processing information in the teacher's private sheet. Hosting providers may retain their own service logs. This is anonymity within the class, not a promise of untraceability to service providers or immunity from inference based on track choice or timing.

Class links are shareable submission addresses, not private credentials. Server-side limits and a honeypot reduce abuse; the app does not enforce one suggestion per person. Do not share the private sheet, Apps Script project or playlist with students while collecting blind suggestions. OAuth expiration pauses transfers but preserves pending submissions. Follow the [setup guide](docs/SETUP.md) for recovery and retention.

Built for MUK Labs by Adrián Artacho with assistance from OpenAI Codex. CrowdSpot is independent of Spotify and is not endorsed by Spotify.
