# Madden Roster Bridge

Chrome extension for Madden NFL 27 Team Builder. It is the courier for the
**Madden 27 TB Editor** website: it pulls your Team Builder team into the editor
and delivers the roster you build back into Team Builder with one button. EA's
own Save keeps it.

Open the editor at **https://madden27-tb-editor.com** (the toolbar icon opens
it too). In Team Builder open your team (My Teams, Edit), then use **Pull** and
**Push** on the site and press Save in Team Builder. A small diagnostics page is
under the extension's **Options**.

Nothing leaves your browser. Not affiliated with Electronic Arts.

## Install

1. Download this repository (**Code**, then **Download ZIP**) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder.

## Permissions: what they're for

- **`storage` / `unlimitedStorage`**: pulled rosters live in local extension
  storage. Nothing is sent to any server.
- **Host access to `ea.com` / `cdn.mcr.ea.com`**: spotting and fetching Team
  Builder's roster payloads.
- **Host access to `madden27-tb-editor.com`**: the editor site's Pull and Push
  buttons talk to the extension there, and nowhere else.
- **`debugger`**: the push mechanism. EA has no public roster-upload API, so
  the extension answers Team Builder's own roster request with your edited JSON
  and lets EA's own Save button persist it. Under Manifest V3 only
  `chrome.debugger` can substitute a response body. Chrome shows a *"started
  debugging this browser"* banner for the moment of a push; the extension
  attaches right before the page reload, serves the one roster payload, and
  detaches. Nothing else is inspected.
