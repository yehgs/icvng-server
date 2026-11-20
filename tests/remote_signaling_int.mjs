// Integration test: mounts the signaling module on a plain http server and walks the protocol.
import assert from 'node:assert';
import http from 'node:http';
import WebSocket from 'ws';
import { attachRemoteSignaling } from '../services/remote/remoteSignaling.js';

const server = http.createServer((_q, r) => r.end('ok'));
const remote = attachRemoteSignaling(server, { path: '/remote-ws', pendingTimeoutMs: 600, sweepMs: 200, log: {} });

const open = (url) =>
  new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.queue = [];
    ws.waiters = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      const w = ws.waiters.shift();
      if (w) w(m);
      else ws.queue.push(m);
    });
    ws.on('open', () => res(ws));
    ws.on('error', rej);
  });
const next = (ws, ms = 3000) =>
  new Promise((res, rej) => {
    if (ws.queue.length) return res(ws.queue.shift());
    const t = setTimeout(() => rej(new Error('timeout waiting for message')), ms);
    ws.waiters.push((m) => {
      clearTimeout(t);
      res(m);
    });
  });
const send = (ws, m) => ws.send(JSON.stringify(m));
const CLAIM = 'claim-token-0123456789abcdef';

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const url = `ws://localhost:${port}/remote-ws`;

// wrong path is refused
await assert.rejects(open(`ws://localhost:${port}/nope`));

const host = await open(url);
send(host, { type: 'register', id: '123456789', claim: CLAIM, password: 'secret12', permanentPassword: 'perm-pass-long-1' });
assert.deepStrictEqual(await next(host), { type: 'registered', id: '123456789' });

// another device with a different claim can't take the ID; bad claim length is rejected
const dup = await open(url);
send(dup, { type: 'register', id: '123456789', claim: 'a-different-claim-token-xyz', password: 'x' });
assert.strictEqual((await next(dup)).code, 'id_taken');
send(dup, { type: 'register', id: '123456789', claim: 'short', password: 'x' });
assert.strictEqual((await next(dup)).code, 'bad_request');
dup.close();

// wrong password and unknown ID give the same error
const viewer = await open(url);
send(viewer, { type: 'connect', id: '123456789', password: 'wrong' });
assert.strictEqual((await next(viewer)).code, 'bad_credentials');
send(viewer, { type: 'connect', id: '999999999', password: 'wrong' });
assert.strictEqual((await next(viewer)).code, 'bad_credentials');

// happy path with the one-time password
send(viewer, { type: 'connect', id: '123456789', password: 'secret12', name: 'Caleb-PC\u0007' });
const waiting = await next(viewer);
assert.strictEqual(waiting.type, 'waiting');
const req = await next(host);
assert.strictEqual(req.type, 'request');
assert.strictEqual(req.viewerName, 'Caleb-PC'); // control chars stripped
assert.strictEqual(req.auth, 'session');

// signalling is blocked until the host accepts
send(viewer, { type: 'signal', sessionId: waiting.sessionId, data: { sdp: 'early' } });
send(host, { type: 'accept', sessionId: req.sessionId });
assert.strictEqual((await next(viewer)).type, 'accepted');
send(host, { type: 'signal', sessionId: req.sessionId, data: { sdp: 'offer' } });
assert.deepStrictEqual((await next(viewer)).data, { sdp: 'offer' });
send(viewer, { type: 'signal', sessionId: req.sessionId, data: { sdp: 'answer' } });
assert.deepStrictEqual((await next(host)).data, { sdp: 'answer' });

// second viewer is rejected while busy
const v2 = await open(url);
send(v2, { type: 'connect', id: '123456789', password: 'secret12' });
assert.strictEqual((await next(v2)).code, 'busy');
v2.close();

// once established, a dropped host socket does NOT end the call, and the host can reclaim its ID
send(host, { type: 'established', sessionId: req.sessionId });
await new Promise((r) => setTimeout(r, 50));
host.terminate();
await new Promise((r) => setTimeout(r, 100));
assert.strictEqual(viewer.queue.length, 0, 'viewer must not be told the session ended');
const host1b = await open(url);
send(host1b, { type: 'register', id: '123456789', claim: CLAIM, password: 'secret12', permanentPassword: 'perm-pass-long-1' });
assert.strictEqual((await next(host1b)).type, 'registered'); // same claim reclaims the ID
const hostNow = host1b;

// ending notifies the other side (a not-yet-established session)
send(viewer, { type: 'connect', id: '123456789', password: 'secret12' });
const w2 = await next(viewer);
const r2 = await next(hostNow);
send(hostNow, { type: 'accept', sessionId: r2.sessionId });
await next(viewer);
send(viewer, { type: 'end', sessionId: w2.sessionId });
assert.strictEqual((await next(hostNow)).type, 'ended');

// deny path
send(viewer, { type: 'connect', id: '123456789', password: 'secret12' });
await next(viewer);
const r3 = await next(hostNow);
send(hostNow, { type: 'deny', sessionId: r3.sessionId });
assert.strictEqual((await next(viewer)).type, 'denied');

// permanent password is reported to the host as auth=permanent
send(viewer, { type: 'connect', id: '123456789', password: 'perm-pass-long-1', name: 'Caleb-PC' });
await next(viewer);
const r4 = await next(hostNow);
assert.strictEqual(r4.auth, 'permanent');
send(hostNow, { type: 'deny', sessionId: r4.sessionId });
assert.strictEqual((await next(viewer)).type, 'denied');

// unanswered request times out on both sides
send(viewer, { type: 'connect', id: '123456789', password: 'secret12' });
await next(viewer);
assert.strictEqual((await next(hostNow)).type, 'request');
assert.strictEqual((await next(viewer, 4000)).type, 'ended'); // swept after pendingTimeoutMs
assert.strictEqual((await next(hostNow, 4000)).type, 'ended'); // host's Allow prompt is cleared too

// short permanent password is ignored
const host2 = await open(url);
send(host2, { type: 'register', id: '222333444', claim: CLAIM + 'x', password: 'onetime1', permanentPassword: 'short' });
await next(host2);
const v3 = await open(url);
send(v3, { type: 'connect', id: '222333444', password: 'short' });
assert.strictEqual((await next(v3)).code, 'bad_credentials');
host2.close();
v3.close();

// brute force: 5 failures from this IP -> rate limited (3 used above)
const v4 = await open(url);
for (let i = 0; i < 2; i++) {
  send(v4, { type: 'connect', id: '123456789', password: 'bad' + i });
  assert.strictEqual((await next(v4)).code, 'bad_credentials');
}
send(v4, { type: 'connect', id: '123456789', password: 'secret12' });
assert.strictEqual((await next(v4)).code, 'rate_limited');

console.log('signaling: all checks passed', remote.stats());
process.exit(0);
