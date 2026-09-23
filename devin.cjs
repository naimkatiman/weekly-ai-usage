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

const DEFAULT_SERVER = 'https://server.codeium.com';

// Plain `devin auth status` reports which server holds this login and its plan name.
function parseStatus(text) {
  text = text.replace(/\x1b\[[0-9;]*m/g, '');
  return { server: /^\s*API server:\s+(\S+)/m.exec(text)?.[1].replace(/\/+$/, '') || null,
    plan: /^\s*Plan:\s+(.+?)\s*$/m.exec(text)?.[1] || null };
}

function cliError(cli, error) {
  return new Error((error?.code === 'ENOENT' ? 'Devin CLI not found (' : 'Devin CLI could not start (') + cli +
    '). Set "cli" in accounts.json to the full path of devin.exe.');
}

function status(cli) {
  return new Promise((resolve, reject) => {
    let child, output = '';
    try { child = spawn(cli, ['auth', 'status'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch (e) { reject(cliError(cli, e)); return; }
    const timer = setTimeout(() => child.kill(), 20000);
    child.stdout.on('data', chunk => { if (output.length < 65536) output += chunk; });
    child.on('error', e => { clearTimeout(timer); reject(cliError(cli, e)); });
    child.on('close', () => { clearTimeout(timer); resolve(parseStatus(output)); });
  });
}

function relay(cli) {
  // The native client owns the credentials and its required request fingerprint.
  // This short-lived loopback relay captures only the quota response, never logs requests.
  return new Promise((resolve, reject) => {
    let child, timer, snapshot, startError, failed = false, finished = false;
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
        const upstream = await fetch(DEFAULT_SERVER + req.url, {
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
      else reject(startError ? cliError(cli, startError) :
        new Error(failed ? 'Devin status request failed. Retry or open Devin.' : 'Devin login unavailable. Run devin auth status.'));
    }
    server.on('error', () => { if (child) child.kill(); finish(); });
    server.listen(0, '127.0.0.1', () => {
      try {
        child = spawn(cli, ['auth', 'status'], {
          env: { ...process.env, WINDSURF_API_SERVER_URL: 'http://127.0.0.1:' + server.address().port },
          windowsHide: true, stdio: 'ignore',
        });
      } catch (e) { startError = e; finish(); return; }
      timer = setTimeout(() => { child.kill(); }, 20000);
      child.on('error', e => { startError = e; finish(); });
      child.on('close', finish);
    });
  });
}

async function fetchNative(cli = 'devin') {
  const login = await status(cli);
  if (!login.server) throw new Error('Devin login unavailable. Run devin auth login.');
  // The relay forwards credentials only to the default server, never to another tenant's.
  if (login.server !== DEFAULT_SERVER)
    throw new Error('Only the default Devin login (server.codeium.com) is supported. This login uses ' + login.server + '.');
  const snapshot = await relay(cli);
  if (login.plan) snapshot.userStatus.planStatus.planInfo.planName = login.plan;
  return snapshot;
}

module.exports = { fields, parseNative, parseStatus, fetchNative };
