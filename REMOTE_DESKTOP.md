# Remote Desktop signaling (Calstins Remote)

The API now also hosts the **signaling WebSocket** for the Calstins Remote desktop app, at:

```
wss://api.i-coffee.ng/remote-ws
```

It only pairs two computers and relays connection setup messages. Screen video and mouse/keyboard input go **directly between the two computers** (WebRTC) and never pass through this server.

| File | What |
|---|---|
| `services/remote/remoteSignaling.js` | The whole feature. Attaches to the HTTP server on one path; adds **no Express routes** (so `routeAuditor` is unaffected) |
| `index.js` | 2 changes: import + `attachRemoteSignaling(httpServer, …)` after `app.listen` |
| `package.json` | adds `ws` |
| `tests/remote_signaling_int.mjs` | protocol test: `node tests/remote_signaling_int.mjs` (no DB needed) |

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `REMOTE_DESKTOP_ENABLED` | `true` | `false` disables the feature completely |
| `REMOTE_WS_PATH` | `/remote-ws` | WebSocket path |
| `REMOTE_PROXY_HOPS` | `1` | Trusted proxies in front of Node, used to read the real client IP for rate limiting. `1` = Cloud Run directly, `2` = behind a Google HTTPS load balancer |

## Deploying on Google Cloud (Cloud Run)

Cloud Run supports WebSockets. The signaling state (who is online, active pairings) lives **in memory**, so it must run as **one instance**:

```bash
gcloud run deploy icvng-server \
  --source . \
  --region <your-region> \
  --max-instances=1 \
  --min-instances=1 \
  --timeout=3600 \
  --session-affinity \
  --allow-unauthenticated
```

Why each flag:
- `--max-instances=1`: with 2+ instances a viewer and host could land on different instances and never find each other.
- `--min-instances=1`: avoids cold starts dropping every host's registration.
- `--timeout=3600`: Cloud Run closes any WebSocket after at most 60 minutes. The desktop app reconnects automatically and **active sessions keep running** (video is peer-to-peer; the app tells the server once it's connected, so a dropped signaling socket does not end the call).

> **If this API already runs with more than one instance** (autoscaling for your shop traffic), do not enable the feature there: set `REMOTE_DESKTOP_ENABLED=false` on it and deploy a second tiny Cloud Run service from this same code with `--max-instances=1` and a domain such as `remote-api.calstins.com`. Then point the desktop app at `wss://remote-api.calstins.com/remote-ws`. (Running on Compute Engine, GKE with one replica or any single VM also works.)

Vercel can't be used for this part: serverless functions cannot keep WebSocket connections open. The existing `vercel.json` deployment is unaffected.

## Cloudflare (if `api.i-coffee.ng` is proxied through it)

WebSockets work through Cloudflare's proxy on every plan (the orange cloud is fine). Nothing to configure, but idle connections are cut after ~100 s without traffic: the app already sends pings through the server's 30-second heartbeat.

## Security notes

- Passwords are compared as SHA-256 digests in constant time; wrong ID and wrong password give the same error; 5 failed attempts per IP per 5 minutes are blocked.
- A host's ID is bound to a random per-device claim token, so nobody else can take over an ID that is online, and a device reconnecting after a drop gets its own ID back.
- Limits: 20 sockets per IP, 5 000 registered hosts, 64 KB messages, 150 messages per 10 s per socket.
- A request nobody answers is cleared after 60 s.
- The server logs nothing sensitive (no passwords, no IDs).
- Because the desktop installer is public, anyone can talk to this endpoint. That is by design (it's like AnyDesk's relay); access to a computer still needs its ID + password and, for the one-time password, the owner's click on **Allow**.
