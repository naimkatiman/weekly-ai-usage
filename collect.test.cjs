'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAccounts, quota, checkEmail, parseCodex, parseClaude, parseGrok, parseDevin, withStatus } = require('./collect.cjs');
const future = '2030-09-20T00:00:00.000Z';
const { fields, parseNative } = require('./devin.cjs');
const { parseCredits, fetchCredits } = require('./grok.cjs');
const { credentials } = require('./collect.cjs');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const accounts = loadAccounts({ accounts: [
  { provider: 'claude', email: 'work@example.com', home: '~/.claude-work' },
  { provider: 'claude', email: 'me@example.com' },
  { provider: 'codex', email: 'work@example.com', home: '~/.codex-work' },
] });
test('roster comes from config with one id per provider login', () => {
  assert.deepEqual(accounts.map(a => a.id), ['claude:work@example.com', 'claude:me@example.com', 'codex:work@example.com']);
  assert.equal(accounts[0].plan, 'Max');
  assert.equal(accounts[2].plan, 'Pro');
});
test('invalid rosters are rejected with the offending entry', () => {
  for (const config of [null, {}, { accounts: [] }]) assert.throws(() => loadAccounts(config), /No accounts configured/);
  assert.throws(() => loadAccounts({ accounts: [{ provider: 'gemini', email: 'a@example.com' }] }), /accounts\[0\]: provider/);
  assert.throws(() => loadAccounts({ accounts: [{ provider: 'codex' }] }), /accounts\[0\]: email/);
  assert.throws(() => loadAccounts({ accounts: [{ provider: 'codex', email: 'a@example.com' }, { provider: 'codex', email: 'A@EXAMPLE.COM' }] }),
    /accounts\[1\]: duplicate/);
});
test('Codex recognizes weekly quota in either primary or secondary position', () => {
  const weekly = { used_percent: 74, limit_window_seconds: 604800, reset_at: 1790000000 };
  const session = { used_percent: 19, limit_window_seconds: 18000 };
  for (const [primary_window, secondary_window] of [[weekly, null], [session, weekly]]) {
    const parsed = parseCodex({ email: 'a@example.com', rate_limit: { primary_window, secondary_window } }, 'a@example.com');
    assert.equal(parsed.weekly.used, 74);
    assert.equal(parsed.weekly.remaining, 26);
  }
});
test('unknown windows and missing percentages are never displayed as zero', () => {
  assert.equal(parseCodex({ email: 'a@example.com', rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 3600 } } }, 'a@example.com').weekly.used, null);
  for (const value of [null, undefined, '', '20', NaN, -1, 101]) assert.equal(quota(value, null).used, null);
  assert.equal(quota(0, null).remaining, 100);
});
test('rejects a provider result for a different account', () => {
  assert.throws(() => checkEmail('wrong@example.com', 'a@example.com'), /identity mismatch/);
  assert.throws(() => checkEmail(undefined, 'a@example.com'), /identity mismatch/);
  assert.doesNotThrow(() => checkEmail('A@EXAMPLE.COM', 'a@example.com'));
});
test('Claude supports old and current weekly schema', () => {
  assert.equal(parseClaude({ seven_day: { utilization: 45, resets_at: future } }).weekly.remaining, 55);
  assert.equal(parseClaude({ limits: [{ kind: 'weekly_all', percent: 40, resets_at: future }] }).weekly.used, 40);
});
test('Grok requires a weekly period and never substitutes paid on-demand usage', () => {
  assert.throws(() => parseGrok({ config: { currentPeriod: { type: 'MONTHLY' } } }), /weekly/);
  const result = parseGrok({ config: { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: future }, onDemandUsed: { val: 0 }, onDemandCap: { val: 100 } } });
  assert.equal(result.weekly.used, null);
});
test('Devin inverts remaining quota and honors hidden daily quota', () => {
  const result = parseDevin({ userStatus: { email: 'a@example.com', planStatus: { weeklyQuotaRemainingPercent: 83, dailyQuotaRemainingPercent: 40, planInfo: { hideDailyQuota: true } } } }, 'a@example.com');
  assert.equal(result.weekly.used, 17);
  assert.equal(result.session.used, null);
  assert.equal(parseDevin({ userStatus: { email: 'a@example.com', planStatus: {} } }, 'a@example.com').weekly.used, null);
});
test('failed reads retain same-account data with its original timestamp and stale label', () => {
  const a = accounts[0], now = Date.parse('2030-09-15T00:00:00Z');
  const prior = withStatus(a, { weekly: quota(45, future) }, null, null, now);
  const stale = withStatus(a, null, 'Network unavailable', prior, now + 60000);
  assert.equal(stale.status, 'Stale');
  assert.equal(stale.capturedAt, prior.capturedAt);
  assert.equal(stale.weekly.used, 45);
  assert.equal(withStatus(a, null, 'fail', { ...prior, email: 'wrong@example.com' }, now + 60000).weekly.used, null);
  assert.equal(withStatus(a, null, 'fail', prior, now + 86400001).weekly.used, null);
});
test('expired quota never implies a fresh allowance', () => {
  const a = accounts[0], now = Date.parse(future) + 1000;
  const result = withStatus(a, { weekly: quota(80, future) }, null, null, now);
  assert.equal(result.status, 'Reset pending');
  assert.equal(result.weekly.used, null);
});

function varint(n) {
  const bytes = []; n = BigInt(n);
  do { bytes.push(Number(n & 127n) | (n > 127n ? 128 : 0)); n >>= 7n; } while (n);
  return Buffer.from(bytes);
}
function field(n, value) {
  if (typeof value === 'number') return Buffer.concat([varint(n * 8), varint(value)]);
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([varint(n * 8 + 2), varint(bytes.length), bytes]);
}
test('Devin native wire response yields the correct account and quota, skips unknown fields', () => {
  const info = field(36, 1);
  const plan = Buffer.concat([field(1, info), field(15, 61), field(18, 1790000000)]);
  const user = Buffer.concat([field(7, 'a@example.com'), field(13, plan), field(333, 'ignored')]);
  const result = parseDevin(parseNative(field(1, user)), 'a@example.com');
  assert.equal(result.weekly.used, 39);
  assert.equal(result.weekly.reset, new Date(1790000000000).toISOString());
  assert.equal(result.session.used, null);
});
test('Devin omitted proto scalar means exhausted only when the quota period exists', () => {
  for (const hasPeriod of [true, false]) {
    const plan = Buffer.concat([field(1, Buffer.alloc(0)), hasPeriod ? field(18, 1790000000) : Buffer.alloc(0)]);
    const user = Buffer.concat([field(7, 'a@example.com'), field(13, plan)]);
    const result = parseDevin(parseNative(field(1, user)), 'a@example.com');
    assert.equal(result.weekly.used, hasPeriod ? 100 : null);
  }
});
test('malformed or truncated native replies are rejected', () => {
  for (const bytes of [[10, 100, 1], [0], [128], [15, 1], Array(12).fill(255)])
    assert.throws(() => fields(Buffer.from(bytes)));
  assert.throws(() => parseNative(Buffer.alloc(0)));
});

const grokPeriod = { start: '2030-09-13T00:00:00.000Z', end: future };
const grokNow = Date.parse('2030-09-15T00:00:00.000Z');
function grokConfig(extra = Buffer.alloc(0), period = grokPeriod) {
  const stamp = date => field(1, Date.parse(date) / 1000);
  return Buffer.concat([field(8, Buffer.concat([field(1, 2), field(2, stamp(period.start)),
    field(3, stamp(period.end))])), field(11, 1), extra]);
}
function frame(flag, bytes) {
  const header = Buffer.alloc(5); header[0] = flag; header.writeUInt32BE(bytes.length, 1);
  return Buffer.concat([header, bytes]);
}
function grokReply(config, status = '0') {
  return Buffer.concat([frame(0, field(1, config)), frame(128, Buffer.from('grpc-status:' + status + '\r\n'))]);
}
function grokPercent(value) {
  const bytes = Buffer.alloc(5); bytes[0] = 13; bytes.writeFloatLE(value, 1); return bytes;
}

test('Grok active unified protobuf period supplies implicit zero and explicit usage', () => {
  assert.equal(parseCredits(grokReply(grokConfig()), grokPeriod, grokNow), 0);
  for (const used of [0, 37.5, 100])
    assert.equal(parseCredits(grokReply(grokConfig(grokPercent(used))), grokPeriod, grokNow), used);
});

test('Grok zero is rejected for failed, incomplete, mismatched or ambiguous responses', () => {
  const good = grokReply(grokConfig());
  for (const bad of [Buffer.alloc(0), good.subarray(0, good.length - 1), frame(0, field(1, grokConfig())),
    grokReply(grokConfig(), '16'), Buffer.concat([good, good]), grokReply(grokConfig(field(1, 0))),
    grokReply(grokConfig(field(6, Buffer.alloc(0)))), grokReply(grokConfig(field(7, Buffer.alloc(0)))),
    grokReply(grokConfig(Buffer.from([0]))), grokReply(grokConfig(Buffer.from([128,128,128,128,128,128,128,128,128,2]))),
    grokReply(grokConfig().subarray(0, grokConfig().length - 2))])
    assert.throws(() => parseCredits(bad, grokPeriod, grokNow));
  for (const now of [Date.parse(grokPeriod.start) - 1, Date.parse(grokPeriod.end)])
    assert.throws(() => parseCredits(good, grokPeriod, now));
  assert.throws(() => parseCredits(good, { ...grokPeriod, end: '2030-09-21T00:00:00Z' }, grokNow));
  for (const invalid of [NaN, Infinity, -1, 101])
    assert.throws(() => parseCredits(grokReply(grokConfig(grokPercent(invalid))), grokPeriod, grokNow));
});

test('Grok live zero fixture matches the published web schema', () => {
  const bytes = Buffer.from('00000000480a4612001a00220c08f683a3d50610c8aedc99022a0c08f6f8c7d50610c8aedc9902421e0802120c08f683a3d50610c8aedc99021a0c08f6f8c7d50610c8aedc9902580162006801800000000f677270632d7374617475733a300d0a', 'hex');
  assert.equal(parseCredits(bytes, { start: '2026-09-15T03:56:38.590Z', end: '2026-09-22T03:56:38.590Z' },
    Date.parse('2026-09-16T00:00:00Z')), 0);
});

test('Grok fallback network failures leave usage unknown', async t => {
  t.mock.method(global, 'fetch', async () => { throw new Error('network'); });
  assert.equal(await fetchCredits({}, grokPeriod), null);
});

test('each Claude account reads its own config dir, the default profile only on identity match', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-auth-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const login = (dir, email, token, expiresAt = Date.now() + 600000) => {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: token, expiresAt } }));
    fs.writeFileSync(path.join(root, dir === '.claude' ? '.claude.json' : path.join(dir, '.claude.json')),
      JSON.stringify({ oauthAccount: { emailAddress: email } }));
  };
  login('.claude-work', 'work@example.com', 'work-token');
  login('.claude', 'me@example.com', 'default-token');
  assert.equal(credentials(accounts[0], root).token, 'work-token');
  assert.equal(credentials(accounts[1], root).token, 'default-token');
  assert.throws(() => credentials(accounts[2], root), /No matching codex login/);
  login('.claude', 'me@example.com', 'default-token', 1);
  assert.throws(() => credentials(accounts[1], root), /Login expired/);
});

test('each Codex account reads its own CODEX_HOME and rejects a different identity', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-auth-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const token = claims => 'x.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.y';
  fs.mkdirSync(path.join(root, '.codex-work'));
  const write = email => fs.writeFileSync(path.join(root, '.codex-work', 'auth.json'), JSON.stringify({ tokens: {
    id_token: token({ email }), access_token: token({ exp: Date.now() / 1000 + 600 }), account_id: 'acct' } }));
  write('work@example.com');
  assert.equal(credentials(accounts[2], root).accountId, 'acct');
  write('someone-else@example.com');
  assert.throws(() => credentials(accounts[2], root), /No matching codex login/);
});

test('config file errors name the real problem', t => {
  const { loadConfig } = require('./collect.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-config-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'accounts.json');
  assert.throws(() => loadConfig(file), /not found/);
  fs.writeFileSync(file, '\uFEFF{"accounts":[{"provider":"codex","email":"a@example.com"}]}');
  assert.equal(loadConfig(file).accounts.length, 1);
  fs.writeFileSync(file, '{"accounts":[{"provider":"devin","email":"a@example.com","cli":"C:\\Devin\\devin.exe"}]}');
  assert.throws(() => loadConfig(file), /is not valid JSON: .*forward slashes/);
  fs.writeFileSync(file, '{"accounts":[{"provider":"codex","email":"a@example.com"},]}');
  assert.throws(() => loadConfig(file), e => /is not valid JSON/.test(e.message) && !/forward slashes/.test(e.message));
  fs.writeFileSync(file, Buffer.from('\uFEFF{"accounts":[]}', 'utf16le'));
  assert.throws(() => loadConfig(file), /saved as UTF-16/);
});

test('configured plan survives when the provider reports none', () => {
  const [devin, codex] = loadAccounts({ accounts: [
    { provider: 'devin', email: 'a@example.com', plan: 'Pro' }, { provider: 'codex', email: 'a@example.com', plan: 'Plus' }] });
  const now = Date.parse('2030-09-15T00:00:00Z');
  const status = { userStatus: { email: 'a@example.com', planStatus: { weeklyQuotaRemainingPercent: 50 } } };
  assert.equal(withStatus(devin, parseDevin(status, 'a@example.com'), null, null, now).plan, 'Pro');
  status.userStatus.planStatus.planInfo = { planName: 'Max' };
  assert.equal(withStatus(devin, parseDevin(status, 'a@example.com'), null, null, now).plan, 'Max');
  assert.equal(withStatus(codex, parseCodex({ email: 'a@example.com' }, 'a@example.com'), null, null, now).plan, 'Plus');
});

test('stale rows keep the window label of their original reading', () => {
  const [devin] = loadAccounts({ accounts: [{ provider: 'devin', email: 'a@example.com' }] });
  const now = Date.parse('2030-09-15T00:00:00Z');
  const prior = withStatus(devin, { weekly: quota(20, future), session: quota(40, future), sessionLabel: 'Daily' }, null, null, now);
  assert.equal(withStatus(devin, null, 'fail', prior, now + 60000).sessionLabel, 'Daily');
});

test('Devin status text yields the login server and plan', () => {
  const { parseStatus } = require('./devin.cjs');
  const text = 'Logged in (via Devin).\n\nCredentials:\n  API server:        https://server.codeium.com/\n\nAccount:\n  Tier:              Devin Max\n  Plan:              Max\n';
  assert.deepEqual(parseStatus(text), { server: 'https://server.codeium.com', plan: 'Max' });
  assert.deepEqual(parseStatus('\x1b[1mAPI server:\x1b[0m https://eu.windsurf.com\n'), { server: 'https://eu.windsurf.com', plan: null });
  assert.deepEqual(parseStatus('Not logged in.\n'), { server: null, plan: null });
});

test('a missing Devin CLI is reported as missing, not as a login problem', async () => {
  const { fetchNative } = require('./devin.cjs');
  await assert.rejects(fetchNative(path.join(os.tmpdir(), 'no-such-devin-cli.exe')), /Devin CLI not found .*"cli"/);
});
