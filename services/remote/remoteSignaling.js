/**
 * Remote-desktop signaling. Pairs a "host" (computer being controlled) with a
 * "viewer" and relays WebRTC offer/answer/ICE messages. It never sees video or
 * input — those go peer-to-peer.
 *
 * Self-contained: attaches to any Node http.Server on one path, adds no Express
 * routes, so it can be dropped into an existing API server.
 *
 * Protocol (JSON over WebSocket):
 *  host   -> {type:'register', id, claim, password, permanentPassword?}
 *                                   <- {type:'registered', id} | {type:'error', code}
 *  viewer -> {type:'connect', id, password, name}
 *                                   <- {type:'waiting', sessionId} | {type:'error', code}
 *  server -> host   {type:'request', sessionId, auth:'session'|'permanent', viewerName}
 *  host   -> {type:'accept'|'deny', sessionId}   => viewer {type:'accepted'|'denied'}
 *  either -> {type:'signal', sessionId, data}    => relayed to the other side
 *  host   -> {type:'established', sessionId}     (WebRTC is up; session outlives this socket)
 *  either -> {type:'end', sessionId}             => other side {type:'ended'}
 */
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(a, b);
const send = (ws, msg) => ws && ws.readyState === 1 && ws.send(JSON.stringify(msg));
const cleanName = (s) => String(s || 'Unknown device').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64) || 'Unknown device';

export function attachRemoteSignaling(httpServer, opts = {}) {
  const {
    path = '/remote-ws',
    // Number of trusted reverse-proxy hops in front of this process. Cloud Run alone = 1;
    // Cloud Run behind a Google load balancer = 2. Used to read the real client IP safely.
    proxyHops = Number(process.env.REMOTE_PROXY_HOPS ?? 1),
    maxConnPerIp = 20,
    maxHosts = 5000,
    maxFails = 5,
    failWindowMs = 5 * 60 * 1000,
    pendingTimeoutMs = 60 * 1000,
    sweepMs = 15_000,
    log = console,
  } = opts;

  const hosts = new Map(); // id -> { ws, passHash, permHash, claimHash }
  const sessions = new Map(); // sessionId -> { hostId, host, viewer, accepted, established, createdAt }
  const fails = new Map(); // ip -> [timestamps]
  const connPerIp = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  function clientIp(req) {
    const parts = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // Entries are appended by each proxy, so the real client is `proxyHops` from the END;
    // anything a client prepends itself is ignored.
    if (parts.length) return parts[Math.max(0, parts.length - proxyHops)];
    return req.socket.remoteAddress || 'unknown';
  }

  const failList = (ip) => {
    const now = Date.now();
    const list = (fails.get(ip) || []).filter((t) => now - t < failWindowMs);
    fails.set(ip, list);
    return list;
  };
  const rateLimited = (ip) => failList(ip).length >= maxFails;
  const recordFail = (ip) => failList(ip).push(Date.now());

  function endSession(sessionId, by) {
    const s = sessions.get(sessionId);
    if (!s) return;
    sessions.delete(sessionId);
    if (by !== s.host) send(s.host, { type: 'ended', sessionId });
    if (by !== s.viewer) send(s.viewer, { type: 'ended', sessionId });
  }

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url, 'http://x').pathname;
    } catch {}
    if (pathname !== path) {
      // Nobody else handles upgrades on this server: don't leave the socket hanging.
      if (httpServer.listenerCount('upgrade') === 1) socket.destroy();
      return;
    }
    const ip = clientIp(req);
    if ((connPerIp.get(ip) || 0) >= maxConnPerIp) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, ip));
  });

  wss.on('connection', (ws, _req, ip) => {
    connPerIp.set(ip, (connPerIp.get(ip) || 0) + 1);
    ws.isAlive = true;
    ws.hostId = null;
    ws.bucket = { n: 0, reset: Date.now() + 10_000 };
    ws.on('pong', () => (ws.isAlive = true));

    ws.on('message', (raw) => {
      const now = Date.now();
      if (now > ws.bucket.reset) ws.bucket = { n: 0, reset: now + 10_000 };
      if (++ws.bucket.n > 150) return ws.close(1008, 'rate limit');

      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'register': {
          const id = String(msg.id || '').replace(/\D/g, '');
          const claim = String(msg.claim || '');
          if (id.length !== 9 || !msg.password || claim.length < 16 || claim.length > 128) {
            return send(ws, { type: 'error', code: 'bad_request' });
          }
          const existing = hosts.get(id);
          if (existing && existing.ws !== ws) {
            // Same device coming back (e.g. after a dropped connection): the claim token proves it.
            if (safeEqual(existing.claimHash, sha(claim))) {
              try {
                existing.ws.terminate();
              } catch {}
            } else if (existing.ws.readyState === 1) {
              return send(ws, { type: 'error', code: 'id_taken' });
            }
          }
          if (!existing && hosts.size >= maxHosts) return send(ws, { type: 'error', code: 'server_full' });
          if (ws.hostId && ws.hostId !== id && hosts.get(ws.hostId)?.ws === ws) hosts.delete(ws.hostId);
          // Permanent password (unattended access) must be at least 10 chars, else ignored.
          const perm = typeof msg.permanentPassword === 'string' && msg.permanentPassword.length >= 10 ? msg.permanentPassword : null;
          hosts.set(id, { ws, passHash: sha(msg.password), permHash: perm ? sha(perm) : null, claimHash: sha(claim) });
          ws.hostId = id;
          return send(ws, { type: 'registered', id });
        }

        case 'connect': {
          if (rateLimited(ip)) return send(ws, { type: 'error', code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' });
          const id = String(msg.id || '').replace(/\D/g, '');
          const host = hosts.get(id);
          // The server (not the viewer) decides which password matched, so a viewer
          // can't claim "permanent" to skip the host's approval prompt.
          const pwHash = sha(msg.password || '');
          let auth = null;
          if (host) {
            if (host.permHash && safeEqual(host.permHash, pwHash)) auth = 'permanent';
            else if (safeEqual(host.passHash, pwHash)) auth = 'session';
          }
          // Same error for unknown ID and wrong password so IDs can't be enumerated.
          if (!host || !auth) {
            recordFail(ip);
            return send(ws, { type: 'error', code: 'bad_credentials', message: 'Wrong ID or password.' });
          }
          if ([...sessions.values()].some((s) => s.hostId === id)) {
            return send(ws, { type: 'error', code: 'busy', message: 'That computer already has an active session.' });
          }
          const sessionId = crypto.randomUUID();
          sessions.set(sessionId, { hostId: id, host: host.ws, viewer: ws, accepted: false, established: false, createdAt: now });
          send(ws, { type: 'waiting', sessionId });
          send(host.ws, { type: 'request', sessionId, auth, viewerName: cleanName(msg.name) });
          return;
        }

        case 'accept':
        case 'deny': {
          const s = sessions.get(msg.sessionId);
          if (!s || s.host !== ws) return;
          if (msg.type === 'deny') {
            send(s.viewer, { type: 'denied', sessionId: msg.sessionId });
            sessions.delete(msg.sessionId);
          } else {
            s.accepted = true;
            send(s.viewer, { type: 'accepted', sessionId: msg.sessionId });
          }
          return;
        }

        case 'signal': {
          const s = sessions.get(msg.sessionId);
          if (!s || !s.accepted) return;
          const target = ws === s.host ? s.viewer : ws === s.viewer ? s.host : null;
          if (target) send(target, { type: 'signal', sessionId: msg.sessionId, data: msg.data });
          return;
        }

        case 'established': {
          const s = sessions.get(msg.sessionId);
          if (s && s.host === ws) s.established = true;
          return;
        }

        case 'end': {
          const s = sessions.get(msg.sessionId);
          if (s && (s.host === ws || s.viewer === ws)) endSession(msg.sessionId, ws);
          return;
        }
      }
    });

    ws.on('close', () => {
      const n = (connPerIp.get(ip) || 1) - 1;
      if (n <= 0) connPerIp.delete(ip);
      else connPerIp.set(ip, n);

      if (ws.hostId && hosts.get(ws.hostId)?.ws === ws) hosts.delete(ws.hostId);
      for (const [sid, s] of sessions) {
        if (s.host !== ws && s.viewer !== ws) continue;
        // Once WebRTC is up the call is peer-to-peer; a dropped signaling socket
        // (e.g. a 60-minute hosting limit) must not kill it.
        if (s.established) sessions.delete(sid);
        else endSession(sid, ws);
      }
    });
  });

  const timer = setInterval(() => {
    const now = Date.now();
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
    // Nobody answered the Allow prompt: clear it on both sides.
    for (const [sid, s] of sessions) if (!s.accepted && now - s.createdAt > pendingTimeoutMs) endSession(sid, null);
    for (const ip of fails.keys()) if (!failList(ip).length) fails.delete(ip);
  }, sweepMs);
  timer.unref?.();

  log.log?.(`[remote] signaling attached on ${path}`);

  return {
    wss,
    stats: () => ({ hosts: hosts.size, sessions: sessions.size, sockets: wss.clients.size }),
    close() {
      clearInterval(timer);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
