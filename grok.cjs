'use strict';

// Schema: Grok's published GrokCreditsConfig descriptor (verified 2026-09-16).
// Only decode declared messages. Unknown length-delimited fields remain opaque.
function fields(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error('Missing Grok message.');
  let offset = 0;
  const result = new Map();
  result.wires = new Map();
  function integer() {
    let value = 0n;
    for (let shift = 0; shift < 70; shift += 7) {
      if (offset >= bytes.length) throw new Error('Truncated Grok integer.');
      const byte = bytes[offset++];
      if (shift === 63 && byte > 1) throw new Error('Overflowing Grok integer.');
      value |= BigInt(byte & 127) << BigInt(shift);
      if (!(byte & 128)) return Number(value);
    }
    throw new Error('Invalid Grok integer.');
  }
  while (offset < bytes.length) {
    const tag = integer(), number = Math.floor(tag / 8), wire = tag % 8;
    if (!Number.isSafeInteger(tag) || number < 1 || number > 536870911) throw new Error('Invalid Grok field.');
    if (result.has(number)) throw new Error('Ambiguous Grok field.');
    result.wires.set(number, wire);
    if (wire === 0) result.set(number, integer());
    else if ([1, 2, 5].includes(wire)) {
      const length = wire === 2 ? integer() : wire === 1 ? 8 : 4;
      if (!Number.isSafeInteger(length) || offset + length > bytes.length) throw new Error('Truncated Grok field.');
      result.set(number, wire === 5 ? bytes.readFloatLE(offset) : bytes.subarray(offset, offset + length));
      offset += length;
    } else throw new Error('Unsupported Grok wire type.');
  }
  return result;
}

function timestamp(bytes) {
  const f = fields(bytes), seconds = f.get(1), nanos = f.get(2) ?? 0;
  if (f.wires.get(1) !== 0 || (f.has(2) && f.wires.get(2) !== 0) ||
      !Number.isSafeInteger(seconds) || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1e9) throw new Error('Invalid Grok time.');
  return seconds * 1000 + Math.floor(nanos / 1e6);
}

function parseCredits(bytes, period, now = Date.now()) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 65536) throw new Error('Invalid Grok response.');
  let offset = 0, message, trailers;
  while (offset < bytes.length) {
    if (offset + 5 > bytes.length || trailers !== undefined) throw new Error('Invalid Grok frame.');
    const flag = bytes[offset], length = bytes.readUInt32BE(offset + 1);
    offset += 5;
    if (offset + length > bytes.length) throw new Error('Truncated Grok frame.');
    const body = bytes.subarray(offset, offset + length);
    if (flag === 0 && !message) message = body;
    else if (flag === 128) trailers = body.toString('utf8');
    else throw new Error('Unexpected Grok frame.');
    offset += length;
  }
  if (!message || !/^grpc-status: ?0\r?$/m.test(trailers || '') || (trailers.match(/grpc-status:/g) || []).length !== 1)
    throw new Error('Grok usage request failed.');
  const config = fields(fields(message).get(1)), current = fields(config.get(8));
  const start = timestamp(current.get(2)), end = timestamp(current.get(3));
  if (current.wires.get(1) !== 0 || current.get(1) !== 2 || !(start <= now && now < end) ||
      start !== Date.parse(period.start) || end !== Date.parse(period.end)) throw new Error('Grok periods do not match.');
  // A missing JSON percent alone is unknown. Proto3's implicit float defaults to
  // zero only after this complete, authenticated, active-period response agrees.
  if (config.has(1) && config.wires.get(1) !== 5) throw new Error('Invalid Grok percentage type.');
  const used = config.get(1) ?? (config.wires.get(11) === 0 && config.get(11) === 1 && !config.has(6) && !config.has(7) ? 0 : null);
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0 || used > 100) throw new Error('Unknown Grok usage.');
  return used;
}

async function fetchCredits(headers, period) {
  try {
    const response = await fetch('https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig', {
      method: 'POST', redirect: 'error', headers: { ...headers,
        'content-type': 'application/grpc-web+proto', 'x-grpc-web': '1' },
      body: Buffer.alloc(5), signal: AbortSignal.timeout(6000),
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/grpc-web+proto')) return null;
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 65536) throw new Error('Grok response too large.');
      chunks.push(chunk);
    }
    return parseCredits(Buffer.concat(chunks), period);
  } catch { return null; }
}

module.exports = { parseCredits, fetchCredits };
