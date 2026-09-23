'use strict';
const http = require('node:http');
const { spawn } = require('node:child_process');

// Decode only the wire types needed by the installed CLI's status schema.
function fields(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('Missing Devin status message.');
  let offset = 0;
  const result = new Map();
  function varint() {
    let value = 0n;
    for (let n = 0; n < 10; n++) {
      if (offset >= buffer.length) throw new Error('Truncated Devin response.');
      const byte = buffer[offset++];
      if (n === 9 && byte > 1) throw new Error('Invalid Devin integer.');
      value |= BigInt(byte & 127) << BigInt(7 * n);
      if (!(byte & 128)) return value;
    }
    throw new Error('Invalid Devin integer.');
  }
  while (offset < buffer.length) {
    const tag = Number(varint()), number = Math.floor(tag / 8), wire = tag & 7;
    if (number < 1 || number > 536870911) throw new Error('Invalid Devin field.');
    if (wire === 0) {
      const value = varint();
      result.set(number, value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null);
    } else if (wire === 2 || wire === 1 || wire === 5) {
      const length = wire === 2 ? Number(varint()) : wire === 1 ? 8 : 4;
      if (!Number.isSafeInteger(length) || offset + length > buffer.length) throw new Error('Truncated Devin field.');
      if (wire === 2) result.set(number, buffer.subarray(offset, offset + length));
      offset += length;
    } else throw new Error('Unsupported Devin field type.');
  }
  return result;
}

function parseNative(buffer) {
  const user = fields(fields(buffer).get(1));
  const plan = fields(user.get(13));
  const info = fields(plan.get(1));
  const email = user.get(7);
  if (!Buffer.isBuffer(email)) throw new Error('Devin did not return account identity.');
  // Proto3 omits zero-valued scalars. Only apply that default to a reported quota period.
  return { userStatus: { email: email.toString('utf8'), planStatus: {
    weeklyQuotaRemainingPercent: plan.has(18) ? (plan.get(15) ?? 0) : null,
    dailyQuotaRemainingPercent: plan.has(17) ? (plan.get(14) ?? 0) : null,
    weeklyQuotaResetAtUnix: plan.get(18), dailyQuotaResetAtUnix: plan.get(17),
    planInfo: { hideDailyQuota: info.get(36) === 1, hideWeeklyQuota: info.get(37) === 1 },
  } } };
}

function fetchNative(cli = 'devin') {
  // The native client owns the credentials and its required request fingerprint.
  // This short-lived loopback relay captures only the quota response, never logs requests.
  return new Promise((resolve, reject) => {
    let child, timer, snapshot, failed = false, finished = false;
    const sockets = new Set();
    const server = http.createServer(async (req, res) => {
      if (req.method !== 'POST' || ![
        '/exa.seat_management_pb.SeatManagementService/GetUserStatus',
        '/exa.seat_management_pb.SeatManagementService/GetCliTeamSettings',
      ].includes(req.url)) { res.writeHead(404); res.end(); return; }
      try {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1024 * 1024) throw new Error('Request too large.');
          chunks.push(chunk);
        }
        const upstream = await fetch('https://server.codeium.com' + req.url, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: { Authorization: req.headers.authorization || '', 'Content-Type': 'application/proto',
            'Connect-Protocol-Version': '1' }, body: Buffer.concat(chunks),
        });
        const data = Buffer.from(await upstream.arrayBuffer());
        if (data.length > 2 * 1024 * 1024) throw new Error('Response too large.');
        if (upstream.ok && req.url.endsWith('/GetUserStatus')) snapshot = parseNative(data);
        res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/proto' });
        res.end(data);
      } catch { failed = true; res.writeHead(502); res.end(); }
    });
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      server.close();
      if (snapshot) resolve(snapshot);
      else reject(new Error(failed ? 'Devin status request failed. Retry or open Devin.' : 'Devin login unavailable. Run devin auth status.'));
    }
    server.on('error', () => { if (child) child.kill(); finish(); });
    server.listen(0, '127.0.0.1', () => {
      child = spawn(cli, ['auth', 'status'], {
        env: { ...process.env, WINDSURF_API_SERVER_URL: 'http://127.0.0.1:' + server.address().port },
        windowsHide: true, stdio: 'ignore',
      });
      timer = setTimeout(() => { child.kill(); }, 20000);
      child.on('error', finish);
      child.on('close', finish);
    });
  });
}

module.exports = { fields, parseNative, fetchNative };
