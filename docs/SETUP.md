# Set up CrowdSpot

The site is hosted at **https://muk-labs.github.io/CrowdSpot/**. Connecting it requires a private Google Apps Script project, your Spotify developer app, and a private playlist you own. Students need none of those accounts.

Do not paste Spotify secrets into GitHub, `config.js`, a public issue, or a chat. Enter them only in your private Apps Script project's **Script Properties**.

## 1. Prepare the playlist

1. In Spotify, create a playlist for the class. Use **Make private**, and do not invite collaborators. Keep it private throughout collection.
2. Use **Share → Copy link to playlist**. In `https://open.spotify.com/playlist/PLAYLIST_ID?...`, the playlist ID is the part after `/playlist/`, before `?`.
We will create the Spotify app after deploying Apps Script, so its exact redirect URL is available when Spotify requests it.

This installation uses only the teacher's Spotify authorization; students do not authenticate to Spotify through CrowdSpot. It is not a multi-teacher Spotify platform. Each teacher can deploy their own backend with their own account.

## 2. Create the private Google backend

1. Open [Google Apps Script](https://script.google.com/home/start) and create a new standalone project named **CrowdSpot**. A personal Google account is usually simplest; institutional accounts may restrict anonymous web-app access.
2. Replace `Code.gs` with the contents of [`backend/Code.gs`](../backend/Code.gs).
3. In **Project Settings**, enable **Show appsscript.json manifest file in editor**. Replace that file with [`backend/appsscript.json`](../backend/appsscript.json).
4. Under **Project Settings → Script Properties**, add the following settings. Do not put them into source files.

| Property | Value |
| --- | --- |
| `ADMIN_EMAIL` | The primary email address of the **Google account** you use to own and run this script (not your Spotify email) |
| `PUBLIC_ORIGIN` | `https://muk-labs.github.io` (no path, no trailing slash) |
| `CLASSES_JSON` | Class configuration shown below |

Start with one class. Replace the example playlist ID with yours:

```json
{
  "seminar": {
    "playlistId": "YOUR_22_CHARACTER_PLAYLIST_ID",
    "open": true
  }
}
```

The class key must match the student URL's `class` parameter. The playlist ID is never accepted from student requests. Keep the project and its properties private; do not give students project editor access.

## 3. Deploy the web app

1. Choose **Deploy → New deployment → Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone** (including people not signed in).
3. Review and authorize the Google permissions for your own project. If your institution forbids anonymous deployments, use an account that allows them; a sign-in-only deployment will not work for anonymous students.
4. Copy the deployed **Web app URL**, which ends in `/exec`. Do not use the editor URL or a `/dev` test URL.
5. Add a Script Property named `REDIRECT_URI` containing that exact `/exec` URL.


The web endpoint accepts suggestions and OAuth callbacks. In the editor, use the visible commands **without a trailing underscore**. Apps Script hides underscore-suffixed helpers from the Run dropdown. Each visible administrative command checks the caller against `ADMIN_EMAIL`; anonymous visitors and other Google accounts are refused. The automatic timer continues to use the private `processQueue_` helper.

## 4. Create the Spotify app and connect it

Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) with your Premium account. Create an app named **CrowdSpot**, using **Web API** and website `https://muk-labs.github.io/CrowdSpot/`. Use the exact Apps Script `/exec` URL as its **Redirect URI**. Review Spotify's terms yourself. In your private Apps Script **Script Properties**, add `CLIENT_ID` and `CLIENT_SECRET` from the app settings.

1. In the Apps Script editor, select **Code.gs**, save, and choose `setupCrowdSpot` in the function dropdown beside **Run / Debug**. Click **Run**. Review the Google authorization prompt, including access to your Google account email used to verify administrative access. It initializes the private queue spreadsheet and processing trigger. Follow the execution log to the spreadsheet; do not share it with students.
2. Run `showSpotifyAuthorization`. Open the authorization URL from the execution log promptly; the link is short-lived and one-use.
3. Sign in to the intended Spotify account and approve playlist access. Spotify redirects back to Apps Script with a confirmation.
4. Return to Apps Script if you need to inspect execution status. `processQueue` can be run manually to process pending entries; the timer also runs it automatically.

Optional Script Properties `MAX_DAILY_SUBMISSIONS` (default 500 across classes, UTC day) and `MAX_QUEUE_ROWS` (default 10,000) cap intake. `SHEET_ID` is created automatically by setup.

Keep authorization URLs private. If a link expires or is already used, run `showSpotifyAuthorization` again. Spotify authorization currently needs renewing after six months; run the same function to reconnect. Pending submissions remain in the sheet while authorization is unavailable.

## 5. Connect the public site

Edit [`config.js`](../config.js) in this repository:

```js
window.CROWDSPOT_CONFIG = {
  endpoint: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',
  defaultClass: 'seminar',
  title: 'A track worth sharing.'
};
```

Only the deployment URL and presentation defaults belong here. **No Client secret, token or playlist ID.** Commit the change to `main`; GitHub Pages will update the site.

Pages is already configured to publish from **main / root**. If configuring a fork, use **Settings → Pages → Deploy from a branch → main → / (root)**.

## 6. Test before sharing with the class

Use a real track you are happy to add to a test playlist:

1. Open `https://muk-labs.github.io/CrowdSpot/?class=seminar` in a signed-out/private browser window. No Google or Spotify login should appear.
2. Submit a full Spotify track link. The page should confirm **receipt**, not claim immediate Spotify insertion.
3. Check the private queue spreadsheet. The row should appear, then move to a completed status after the timer processes it. Confirm the track in Spotify. Allow a few minutes; Apps Script timers are not exact to the second.
4. Submit the same track again. Confirm that students receive the same generic acknowledgment and Spotify receives no duplicate.
5. Check an invalid link and an unknown class. They must not add anything to Spotify.
6. Set the class's `open` to `false` and confirm submissions are refused; restore it to `true` when ready.
7. Confirm students cannot see the spreadsheet, playlist contents, or Spotify credentials.

Automated tests mock the external services. They do not replace this deployment check, especially the anonymous iframe acknowledgment through Google. If a network timeout appears, receipt is uncertain; the student can retry, and deduplication protects the playlist.

## Classes and rounds

Add more entries to `CLASSES_JSON`, each with its own playlist:

```json
{
  "analysis-ws26": { "playlistId": "REPLACE_WITH_PLAYLIST_ID", "open": true },
  "electronic-music": { "playlistId": "REPLACE_WITH_PLAYLIST_ID", "open": true }
}
```

Share URLs ending `?class=analysis-ws26` and `?class=electronic-music`. For a new collection round, use a new class key and preferably a new private playlist, rather than repointing a class with pending submissions. A class link can be forwarded; it is not proof of student identity and does not enforce one suggestion per person.

Set `open` to `false` to stop accepting new suggestions. Before revealing a playlist publicly, finish or intentionally resolve its queue. The backend refuses to write to public or collaborative playlists. Closing submissions does not necessarily cancel already accepted entries.

## Updating and troubleshooting

### Upgrading from the original version (dropdown shows only doGet and doPost)

1. Replace **both** `Code.gs` and `appsscript.json` with the current versions linked above. Existing Script Properties, queue data and Spotify tokens are preserved.
2. Add `ADMIN_EMAIL` in **Project Settings → Script Properties**, using the Google account email shown for your Apps Script account.
3. Save and return to **Code.gs**. If needed, reload the editor. The dropdown now offers `setupCrowdSpot`, `showSpotifyAuthorization`, `processQueue` and `disconnectSpotify`—without trailing underscores.
4. Run `setupCrowdSpot` and review the additional Google email permission. Run `showSpotifyAuthorization` next if you have not connected Spotify.
5. Update the existing web-app deployment to **New version**, keeping its `/exec` URL. Do not delete your Script Properties, queue sheet or existing timer. Setup does not create a second timer when one already exists.

Do not simply strip the underscores from internal helpers: that would expose administrative operations without an identity check.

| Situation | Action |
| --- | --- |
| Dropdown shows only `doGet` and `doPost` | Follow the upgrade steps above; the original version hid the admin commands. |
| Administrator identity unavailable | Update the manifest too, save, and authorize the email scope from the editor. |
| Administrator access required | Use the Google account whose primary email is stored in `ADMIN_EMAIL`. |
| The site says it is not connected | Set the deployed `/exec` URL in `config.js` and wait for Pages to deploy. |
| Submission times out | Check deployment access is **Anyone**, execution is **Me**, and `PUBLIC_ORIGIN` is exactly the page origin. Inspect Apps Script executions and the private queue before retrying. |
| Google login or access-denied screen | Anonymous access is missing or blocked by Workspace policy. |
| Spotify needs reconnecting | Run `showSpotifyAuthorization`, authorize the same account, then run `processQueue`. |
| Spotify rejects the destination | Verify the playlist ID, ownership, privacy and collaboration settings. |
| A track will not transfer | Inspect its private queue status/error; invalid or unavailable tracks can fail even when the link has the correct format. |
| Spotify rate limit or temporary error | The queue defers/retries work; do not repeatedly rerun it. |
| You updated `Code.gs` | Use **Deploy → Manage deployments → Edit → New version → Deploy**. Keep the existing deployment URL. Saving code alone does not update the deployed web app. |
| You created an entirely new deployment | Update `REDIRECT_URI`, Spotify's redirect allowlist, and `config.js`, then reconnect Spotify. |

Use `disconnectSpotify` to remove the stored Spotify authorization. This preserves the queue. To stop the installation completely, close all classes, remove its `processQueue_` timer in Apps Script's **Triggers** page, and archive the web-app deployment. You can also revoke CrowdSpot in your Spotify account's connected-app settings.

## Data retention and limitations

The private spreadsheet contains track/class IDs, timestamps, status and processing information. **Pause the processing trigger and wait for active executions to finish before sorting, deleting or editing queue rows**; the worker updates rows by their position. Use filter views for ordinary inspection. Delete finished class rows after you no longer need them; retain the header row. Avoid editing/deleting pending entries unless you intend to cancel or repair them. Resume the timer by running `setupCrowdSpot` after maintenance. To retry a repaired `paused` or `failed` entry, set its `status` to `pending` and clear `retry_after` while processing is stopped. Never publish the sheet. Hosting providers maintain their own logs; CrowdSpot's app does not collect names, emails or student IP addresses.

This is a small classroom service using Google Apps Script quotas. It is not designed for high-volume public campaigns. Track links are accepted; album/playlist links, shortened links, local files and uploads are not supported. Students can use Spotify's full `open.spotify.com/track/...` link or `spotify:track:...` URI.

## Official references

- [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Google Apps Script web apps](https://developers.google.com/apps-script/guides/web)
- [Google Apps Script installable triggers](https://developers.google.com/apps-script/guides/triggers/installable)
- [Spotify authorization code flow](https://developer.spotify.com/documentation/web-api/tutorials/code-flow)
- [Spotify playlist insertion](https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist)
- [Spotify development mode](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- [Spotify refresh token expiration](https://developer.spotify.com/blog/2026-06-18-refresh-token-expiration)
