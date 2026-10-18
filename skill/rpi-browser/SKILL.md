---
name: rpi-browser
description: Drive the shared headful Chromium on the Raspberry Pi through the `mcp__rpi-browser__*` Playwright tools, see its screen, and hand control to the human through a local web viewer. Use when asked to verify, test, check, or run something "on the pi", "in the pi browser", "on the Pi's Chromium", or when a project skill says to use the Pi browser instead of Claude in Chrome.
---

# rpi-browser

A headful Chromium runs on the Raspberry Pi (1 GB RAM) with one persistent profile.
Its CDP port reaches this Mac through an ssh tunnel at `127.0.0.1:9333`. The
`rpi-browser` MCP server (Playwright MCP) attaches to that browser. The `rpi-browser`
command on the Mac starts it, shows it, and hands it to the human.

## Start

1. Run `rpi-browser start` before the first browser tool call. It is idempotent: it
   starts Chromium and the tunnel only when they are not up, and ends with `ready:`.
2. Load the tools in one ToolSearch call:
   `select:mcp__rpi-browser__browser_tabs,mcp__rpi-browser__browser_navigate,mcp__rpi-browser__browser_evaluate,mcp__rpi-browser__browser_snapshot,mcp__rpi-browser__browser_find,mcp__rpi-browser__browser_click,mcp__rpi-browser__browser_type,mcp__rpi-browser__browser_press_key,mcp__rpi-browser__browser_take_screenshot,mcp__rpi-browser__browser_console_messages,mcp__rpi-browser__browser_network_requests,mcp__rpi-browser__browser_network_request,mcp__rpi-browser__browser_wait_for`.
   Add `browser_fill_form`, `browser_select_option`, `browser_hover`,
   `browser_handle_dialog` or `browser_file_upload` to the same call when the task needs them.
3. If the tools do not appear, the project has no `rpi-browser` MCP server. Tell the
   user to run `rpi-browser install` in the project and restart Claude Code.

## Claude in Chrome to Playwright MCP

All names below carry the `mcp__rpi-browser__` prefix.

| Claude in Chrome | Pi browser | Notes |
| --- | --- | --- |
| `tabs_context_mcp` | `browser_tabs` `{action: "list"}` | Indexes, titles, URLs; `(current)` marks the active tab. |
| `tabs_create_mcp` | `browser_tabs` `{action: "new", url}` | Opens and selects the new tab. |
| `tabs_close_mcp` | `browser_tabs` `{action: "close", index}` | Without `index` it closes the current tab. |
| `navigate` | `browser_navigate` `{url}`, `browser_navigate_back` | |
| `javascript_tool` | `browser_evaluate` `{function: "async () => { ... }"}` | Pass a function, not a bare statement. Promises are awaited; return the value. |
| `read_page` | `browser_snapshot` | Accessibility tree with `ref=eN` ids for `target`. |
| `find` | `browser_find` `{text}` or `{regex}` | Cheaper than a full snapshot. |
| `get_page_text` | `browser_evaluate` `{function: "() => document.body.innerText"}` | |
| `computer` click / type / key | `browser_click` `{target}`, `browser_type` `{target, text}`, `browser_press_key` `{key}` | `target` is a snapshot ref (`e13`) or a unique selector. |
| `computer` scroll | `browser_evaluate` with `window.scrollBy(...)`, or `browser_press_key` `PageDown` | |
| `computer` screenshot / zoom | `browser_take_screenshot` `{scale: "css", filename, target?, fullPage?}` | `target` crops to one element. |
| `form_input` | `browser_fill_form` `{fields}`, `browser_select_option` `{target, values}` | |
| `read_console_messages` | `browser_console_messages` `{level: "error"}` | `level` includes more severe levels; `all: true` reads since session start. No pattern filter. |
| `read_network_requests` | `browser_network_requests` `{static: false, filter: "<regexp>"}` | `browser_network_request` `{index}` returns headers and body. |
| `resize_window` | `browser_resize` `{width, height}` | |
| `file_upload` | `browser_file_upload` `{paths}` | Not verified against the Pi. |
| `gif_creator` | none | Take screenshots per state instead. |

Snapshots that a tool writes to a file and screenshots without `filename` land in
`.playwright-mcp/` under the project root. Give `filename` a path inside the project
(for example the `.verification/...` path a project skill names).

## Rules

- One browser and one profile serve every project and session. Logins persist across
  Chromium restarts, so a site you logged in to once stays logged in.
- Work in a new tab (`browser_tabs` `new`) and close that tab at the end. Keep one
  tab of your own at a time: the Pi has 1 GB of RAM.
- Never close the browser itself. Do not call `browser_close`: it only drops the MCP
  connection and leaves the tab open. Do not run `rpi-browser stop` unless the user asks.
- Never type a password, a one-time code, or other secrets. Hand that step to the human.
- Do not trigger `alert`/`confirm`/`prompt` on purpose. If one is open, use
  `browser_handle_dialog`.

## Seeing

- The human watches the Pi screen live at `http://127.0.0.1:6080` (run `rpi-browser ui` to
  start and open it). Tell the user this URL when they want to watch. The page is view-only
  while you drive.
- `rpi-browser screenshot` prints the path of a PNG of the whole Pi screen: browser
  chrome, permission prompts, native dialogs, and windows outside the page. Read
  the PNG to look at it. Use it when the page tools disagree with what you expect.
- `browser_take_screenshot` captures the page viewport only. Use it for evidence.
- Prefer `browser_evaluate` and `browser_snapshot` for pass/fail checks.

## Takeover

When the human must act (a login, 2FA, a captcha, a consent, or anything you must not do):

1. Run `rpi-browser handoff "<what to do, in one line>" --wait` as a background command.
   It gives control to the human, shows the message in the web viewer with a Done
   button, sends a macOS notification, and opens the viewer. The command exits and
   prints the resolved handoff when the human clicks Done.
2. Tell the user in chat exactly what to do and on which page, and that they should
   click Done in the viewer (or reply in chat) when finished.
3. End the turn. Do not poll. You continue when the background command exits or the
   user replies. If the user replies in chat first, run `rpi-browser release`.
4. Take `browser_snapshot` (or `rpi-browser screenshot`) to confirm the new state before
   you continue.

Never act in the browser while control is `human`. The `ui:` line of `rpi-browser status`
shows the state (`"control":"agent"` or `"control":"human"`). The human can also take
control at any time with the Take over button.

## Trouble

Run `rpi-browser status`. It shows whether Chromium, the VNC server, the tunnel, and the
web viewer are up, the CDP browser version, free memory, swap, temperature, power warnings,
and the control state. If CDP does not answer, run `rpi-browser start` again. If memory is
low, close extra tabs. If the viewer shows a grey screen, a client on the Pi's system VNC
(port 5900) blocks capture: `status` warns about it, and the user must close that client.
Chromium logs to `~/.rpi-browser/chromium.log` on the Pi (`ssh rpi tail ~/.rpi-browser/chromium.log`).
