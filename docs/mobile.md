# Pixel Crew on your phone

Your phone is a **remote** for the office running on your computer. It can watch the office, give
the Boss a task, approve agent runs, and (as the owner) change the office settings. Agents never
run on the phone.

Legend: **[V]** verified in Phase 5 (2026-11-07), **[U]** not verified; check it on your setup.

## Pair a phone (QR code)

1. On the computer, open **Office settings → Paired devices**.
2. Pick a role:
   - **Owner**: full control (assign work, approve runs, settings, devices);
   - **Collaborator**: watch and suggest;
   - **Spectator**: watch only.
3. Pick the address the phone uses (see the three options below), then tap **Show QR code**.
4. Scan it with the phone's camera.

The QR code holds a link like `http://192.168.1.20:9090/pair#<token>`:

- The token is 128-bit, works **once**, and expires after **2 minutes**. It sits after `#`, so it never
  reaches server logs or proxies. The pair page removes it from the address bar right away.
- The phone trades it for its own session. That session lasts 7 days by default (`sessionTtlMs` in
  `config.json`) and appears in the devices list.
- **Revoke** in the list signs out one device. **Revoke all devices** signs out every device except
  the one you are using, and also cancels unused QR links.

The terminal can print the same QR code. Press `q` + Enter in the gateway's terminal. When the gateway
is reachable from other devices (`--lan`, `publicUrl` or a tunnel), it also prints one at startup.
Terminal QR codes are always for the owner role. The 8-character pair code (`p` + Enter) still
works as a fallback.

## Three ways to reach the gateway

The gateway listens on `127.0.0.1` only unless you opt in. Pick one of the following.

### 1. Same Wi-Fi, plain http (quick, no install)

```sh
npx pixel-crew --lan            # or PIXEL_CREW_LAN=1, or "lan": true in config.json
```

- The terminal lists `http://<LAN-IP>:9090` addresses, and the QR code uses the first one.
- `http://192.168.x.x` is **not a secure context**. The page works, but there is no service worker and
  it cannot be installed as an app [V: in Chromium mobile emulation, `isSecureContext` is false and
  there is no `serviceWorker`]. Treat it as a web page you open.
- Anyone on the same network can reach the port. They still need a valid QR link, pair code or session:
  - `/connect` (the passwordless owner token) only answers on loopback [V: `403` from the LAN IP];
  - pairing is rate-limited (5 tries a minute per client, then a 5-minute lockout).
- Plain http can be sniffed on shared Wi-Fi. Use option 2 on networks you do not control.

### 2. Tailscale serve: HTTPS on your tailnet (recommended)

[Tailscale](https://tailscale.com) gives each device a private address, and `tailscale serve` puts
HTTPS in front of a local port. Keep the gateway on loopback (no `--lan`):

```sh
npx pixel-crew                  # loopback only
tailscale serve --bg 9090       # https://<machine>.<tailnet>.ts.net → http://127.0.0.1:9090
```

Then tell Pixel Crew its public address, so QR links use it and its origin is trusted. Put this in
`~/.pixel-crew/config.json`:

```json
{ "publicUrl": "https://my-mac.tail1234.ts.net" }
```

You can also set `PIXEL_CREW_PUBLIC_URL`. Restart the gateway, and the address appears first in the
QR address list.

What is verified and what is not:

- **From Tailscale's docs** (kb/1312, kb/1242, read 2026-11-07):
  - serve terminates HTTPS with an automatically provisioned certificate;
  - you must enable HTTPS certificates for the tailnet, and the CLI offers to do it;
  - URLs look like `device-name.tailnet-name.ts.net`;
  - `--bg` runs it in the background;
  - `tailscale serve status` and `tailscale serve reset` exist, and adding `off` to the start
    command turns it off;
  - tailnet requests carry `Tailscale-User-Login` / `-Name` / `-Profile-Pic` headers. These are not
    set for tagged devices.
- **[U]** WebSocket proxying through serve, and whether serve keeps the original `Host` header or
  adds `X-Forwarded-For`. Neither is stated on those pages. Setting `publicUrl` makes the WebSocket
  origin check pass either way.
- **[U]** Installing the PWA on iOS Safari and Android Chrome over the tailnet URL. HTTPS should make
  it a secure context. Use **Share → Add to Home Screen** on iOS, or **Install app** on Android.
- **Built-in protection:** requests relayed by a local proxy (any of `X-Forwarded-*`, `Forwarded`,
  `X-Real-IP` or `Tailscale-User-*`) never get the `/connect` owner token [V: unit and server tests].
- **Check this once:** run `curl -i https://<machine>.<tailnet>.ts.net/connect` from another
  tailnet device. It must answer `403`. If it returns a token, stop and report it. This would only
  happen if serve rewrote `Host` to localhost *and* sent none of the headers above, for example
  from a tagged device.

### 3. Cloudflare Tunnel with Access (reach it from anywhere)

The gateway already runs `cloudflared` when `tunnelToken` and `tunnelBaseUrl` are set in
`config.json` (or `TUNNEL_TOKEN` / `TUNNEL_BASE_URL`). QR links then offer `tunnelBaseUrl`.

- Put a **Cloudflare Access** application in front of the tunnel's hostname, with your e-mail or
  identity provider as the only allowed identity. Then strangers never reach the pair page.
  [U: set up in the Cloudflare Zero Trust dashboard; not exercised in Phase 5.]
- The gateway treats tunnel requests as remote:
  - `/connect` is refused [V: tests];
  - rate limits use `CF-Connecting-IP`;
  - previews are served under a CSP sandbox.

## What works on a phone

| Feature | Notes |
|---|---|
| Office view | Always shown on phones. It renders at up to **15 fps** on touch screens (30 on desktop) and pauses when the tab is hidden. |
| Boss composer | **BOSS: NEW TASK** (owner). |
| Approvals | A tray at the top shows the next pending approval with **Approve / Deny** (owner). Other roles see "waiting for the owner". |
| Office settings | Owner only: Lead policy, hand-off walk, permissions, paired devices. |
| Status | Agent bar at the bottom, the task board, and the agent chat when you tap an agent. |
| Touch targets | Every control is at least 44×44 px on coarse pointers. |

Verified in Playwright mobile emulation (iPhone 390×844 and Pixel 412×915, touch on) against
`--demo`:
- QR pairing from a second browser context, including over the LAN IP with the production build;
- a replayed link is rejected;
- a task assigned from the phone;
- a permission prompt approved from the phone;
- a spectator sees no owner controls;
- a revoked phone lands on "This device is signed out".

**Not yet tested on real hardware [U]:** an iPhone with Safari, an Android phone with Chrome,
a real Tailscale tailnet, and Cloudflare Access.

## Troubleshooting

- **"This pairing link is invalid, expired or already used"**: make a new QR code. Each one works
  once, for 2 minutes.
- **The phone cannot open the link**:
  - check that the phone is on the same Wi-Fi (option 1) or tailnet (option 2);
  - check that the gateway was started with `--lan` (option 1);
  - check that a firewall allows the port.
- **"This device is signed out"**: the owner revoked it, or its session expired. Pair again.
- **Signing out everything at once**: run **Revoke all devices** in Office settings, or press `r` + Enter
  in the gateway's terminal.
