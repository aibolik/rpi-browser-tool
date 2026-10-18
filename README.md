# rpi-browser

Drive a headful Chromium on a Raspberry Pi from a Mac. An agent drives the browser through
Playwright MCP over CDP. A human watches the Pi screen live in a local web page, takes
control with one click, and hands control back when a login or captcha is done.

## Requirements

- A Raspberry Pi with a Wayland desktop (labwc), `chromium`, `wayvnc`, `wayvncctl`,
  and `grim`, reachable as the ssh alias `rpi` (override with `RPI_BROWSER_HOST`).
- On the Mac: Node 20, and optionally TigerVNC (`brew install --cask tigervnc`).

## Install

```sh
npm install
ln -s "$PWD/bin/rpi-browser" /usr/local/bin/rpi-browser
rpi-browser install /path/to/project   # copy the skill and register the MCP server there
```

## Commands

| Command | What it does |
| --- | --- |
| `rpi-browser start` | Start Chromium on the Pi and open the ssh tunnel. |
| `rpi-browser ui` | Start everything and open the web viewer at `http://127.0.0.1:6080`. |
| `rpi-browser handoff "<message>" [--wait]` | Give control to the human with a message. `--wait` blocks until the human clicks Done. |
| `rpi-browser take` / `release` | Give control to the human / back to the agent. |
| `rpi-browser view [--control]` | Open TigerVNC on the Pi screen, view-only unless `--control`. |
| `rpi-browser screenshot [out.png]` | Capture the whole Pi screen. |
| `rpi-browser status` | Show Chromium, CDP, VNC, tunnel, viewer, control state, memory, and power. |
| `rpi-browser stop` | Stop the viewer server, the Pi VNC server, Chromium, and the tunnel. |

The web viewer is view-only while the agent has control. Control state lives in the
viewer server's memory and resets when the server restarts.

## Security model

- Chromium's CDP port and the second VNC server listen only on the Pi's loopback. The Mac
  reaches them through one ssh tunnel that binds only to `127.0.0.1` on the Mac.
- The second VNC server (`wayvnc` on Pi port 5901, started on demand) has no password.
  It is never bound to the LAN; the ssh tunnel is its access control. The Pi's system VNC
  on port 5900 is left untouched.
- The viewer server binds `127.0.0.1:6080`. It rejects requests whose `Host` or `Origin`
  is not that server, so other web pages in your browser cannot drive the Pi through it.
- Anyone with a shell on your Mac can use the tunnel and the viewer.
