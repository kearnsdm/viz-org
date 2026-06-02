# viz-org sync endpoint (DreamHost / any PHP host)

`viz-sync.php` gives viz-org automatic cross-device sync by storing your board
on your own web hosting. The app stays on GitHub Pages; only this one file lives
on your site.

## Setup (one time, ~5 minutes)

1. **Open `viz-sync.php` and set a passphrase.** Change the line:
   ```php
   $SECRET = 'CHANGE-ME-to-a-long-random-passphrase';
   ```
   to a long random string of your own (treat it like a password).

2. **Upload it to your site.** Put `viz-sync.php` somewhere under your web
   directory on DreamHost — e.g. `yourdomain.com/viz-sync.php`. You can use
   DreamHost's file manager (WebFTP) or any SFTP app.

3. **Confirm it's reachable over https.** Visiting
   `https://yourdomain.com/viz-sync.php` in a browser should return
   `{"error":"unauthorized"}` — that's correct (no passphrase supplied).

4. **Connect the app.** In viz-org, open **Backup / Sync** and under
   *Automatic sync* enter:
   - **Sync URL:** `https://yourdomain.com/viz-sync.php`
   - **Passphrase:** the secret you set in step 1

   Do this on each device. They'll all read and write the same board.

## Notes

- The board is stored as `viz-data.json` next to the PHP file.
- Sync is last-write-wins — fine for one person across their own devices; if you
  edit two devices while one is offline, the most recent save wins.
- The passphrase is the only thing protecting the endpoint, so make it long and
  use the `https://` URL (browsers block non-https requests from the app).
