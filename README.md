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

Works in Chrome on a computer (Edge and Brave run Chrome extensions too, but only Chrome is tested). Not on
phones or consoles. Team Builder rosters only reach the game through **Online
Franchise**.

1. On this page click the green **Code** button, then **Download ZIP**.
2. Unzip it. Move the folder somewhere it can stay (Documents, not Downloads):
   Chrome runs the extension from that folder, so deleting or moving it later
   removes the extension.
3. In Chrome open `chrome://extensions` (paste it into the address bar).
4. Turn on **Developer mode** (switch at the top right).
5. Click **Load unpacked** and pick the unzipped folder: the one that has
   `manifest.json` directly inside it. If Chrome says the manifest is missing,
   you picked the outer folder; open it and pick the folder inside.
6. Optional: click the puzzle piece on the toolbar and pin **Madden Roster
   Bridge** so the red 27 icon stays visible.
7. Open **https://madden27-tb-editor.com** and, in another tab, your team in
   Team Builder (My Teams, Edit). If the site had been open already, refresh it
   once so it finds the extension.

Chrome may show a *"Disable developer mode extensions"* notice when it starts.
Click the X to keep the extension; it is the normal warning for anything not
installed from the Chrome Web Store.

## Use

1. **Pull** on the site to load your Team Builder team.
2. Build or generate your roster.
3. **Push** on the site. The Team Builder tab reloads with the new roster.
4. Press **Save** in Team Builder. Nothing is kept until you do.

Keep one Team Builder tab open while you Push.

## Update

Download the new ZIP, replace the files in your folder with the new ones, then
click the reload arrow on the extension's card in `chrome://extensions`. Or
remove the old one and Load unpacked again.

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
