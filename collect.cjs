'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fetchNative } = require('./devin.cjs');
const { fetchCredits } = require('./grok.cjs');

const root = os.homedir();
const providers = ['claude', 'codex', 'grok', 'devin'];
const defaultPlans = { claude: 'Max', codex: 'Pro', grok: 'SuperGrok', devin: 'Max' };

function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function jwt(token) { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url')); } catch { return {}; } }
function sameEmail(a, b) { return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase(); }
function checkEmail(actual, expected) { if (!sameEmail(actual, expected)) throw new Error('Account identity mismatch. Check the provider login.'); }
function expand(dir, userRoot = root) { return dir.replace(/^~(?=$|[\\/])/, userRoot); }
function percent(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null; }
function iso(value) {
  if (value == null || value === '' || value === 0) return null;
  const d = new Date(typeof value === 'number' ? value * 1000 : value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function quota(used, reset) {
  used = percent(used);
  return { used, remaining: used === null ? null : 100 - used, reset: iso(reset) };
}

function loadConfig(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') throw new Error(file + ' not found. Copy accounts.example.json to accounts.json and list your logins.');
    throw new Error(file + ' could not be read: ' + e.message);
  }
  try { return JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) {
    throw new Error(file + ' is not valid JSON: ' + e.message + '. Write Windows paths with forward slashes.');
  }
}

// The roster is user config, never code: one entry per provider login.
function loadAccounts(config) {
  if (!config || !Array.isArray(config.accounts) || config.accounts.length === 0)
    throw new Error('No accounts configured. List your logins under "accounts" in accounts.json.');
  const seen = new Set();
  return config.accounts.map((entry, index) => {
    const where = 'accounts[' + index + ']';
    if (!providers.includes(entry?.provider)) throw new Error(where + ': provider must be one of ' + providers.join(', ') + '.');
    if (typeof entry.email !== 'string' || !entry.email.includes('@')) throw new Error(where + ': email is required.');
    const id = entry.provider + ':' + entry.email.toLowerCase();
    if (seen.has(id)) throw new Error(where + ': duplicate ' + entry.provider + ' account ' + entry.email + '.');
    seen.add(id);
    return { id, provider: entry.provider, email: entry.email, label: entry.label || '',
      plan: entry.plan || defaultPlans[entry.provider], home: entry.home || null, cli: entry.cli || null };
  });
}

function parseCodex(data, email) {
  checkEmail(data.email, email);
  const windows = [data.rate_limit?.primary_window, data.rate_limit?.secondary_window].filter(Boolean);
  const weekly = windows.find(w => w.limit_window_seconds === 604800);
  const session = windows.find(w => w.limit_window_seconds === 18000);
  return { ...(data.plan_type ? { plan: data.plan_type } : {}), weekly: quota(weekly?.used_percent, weekly?.reset_at),
    session: quota(session?.used_percent, session?.reset_at) };
}
function parseClaude(data) {
  const weekly = data.seven_day || data.limits?.find(w => w.kind === 'weekly_all');
  const session = data.five_hour || data.limits?.find(w => w.kind === 'session');
  return { weekly: quota(weekly?.utilization ?? weekly?.percent, weekly?.resets_at),
    session: quota(session?.utilization ?? session?.percent, session?.resets_at) };
}
function parseGrok(data) {
  const c = data.config;
  if (c?.currentPeriod?.type !== 'USAGE_PERIOD_TYPE_WEEKLY') throw new Error('Provider did not return a weekly quota.');
  // On-demand spending is a separate allowance, never a substitute for included usage.
  return { weekly: quota(c.creditUsagePercent, c.currentPeriod.end), session: quota(null, null) };
}
function parseDevin(data, email) {
  const user = data.userStatus || data.user_status;
  checkEmail(user?.email, email);
  const p = user?.planStatus || user?.plan_status;
  const info = p?.planInfo || p?.plan_info;
  const remaining = p?.weeklyQuotaRemainingPercent ?? p?.weekly_quota_remaining_percent;
  const daily = p?.dailyQuotaRemainingPercent ?? p?.daily_quota_remaining_percent;
  const plan = info?.planName || info?.plan_name;
  return { ...(plan ? { plan } : {}),
    weekly: quota(percent(remaining) === null || info?.hideWeeklyQuota || info?.hide_weekly_quota ? null : 100 - remaining,
      Number(p?.weeklyQuotaResetAtUnix ?? p?.weekly_quota_reset_at_unix) || null),
    session: quota(percent(daily) === null || info?.hideDailyQuota || info?.hide_daily_quota ? null : 100 - daily,
      Number(p?.dailyQuotaResetAtUnix ?? p?.daily_quota_reset_at_unix) || null), sessionLabel: 'Daily' };
}

async function request(url, headers, body) {
  let response;
  try {
    response = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { Accept: 'application/json', ...headers }, body,
      signal: AbortSignal.timeout(12000) });
  } catch { throw new Error('Network unavailable or request timed out.'); }
  if ([401, 403].includes(response.status)) throw new Error('Login expired or usage access denied. Sign in with the provider.');
  if (response.status === 429) throw new Error('Provider rate limited this check. Retrying at the next refresh.');
  if (!response.ok) throw new Error('Provider returned HTTP ' + response.status + '.');
  const text = await response.text();
  if (text.length > 2 * 1024 * 1024) throw new Error('Provider response is too large.');
  try { return JSON.parse(text); } catch { throw new Error('Provider returned an unreadable response.'); }
}

// Claude: `home` is the account's CLAUDE_CONFIG_DIR. Codex: `home` is its CODEX_HOME.
// The default profile is also checked, but only used when its identity matches the account.
function credentials(account, userRoot = root) {
  const sources = [];
  if (account.provider === 'claude') {
    if (account.home) {
      const home = expand(account.home, userRoot);
      sources.push([path.join(home, '.credentials.json'), read(path.join(home, '.claude.json'))?.oauthAccount?.emailAddress]);
    }
    sources.push([path.join(userRoot, '.claude', '.credentials.json'),
      read(path.join(userRoot, '.claude.json'))?.oauthAccount?.emailAddress]);
  } else {
    if (account.home) sources.push([path.join(expand(account.home, userRoot), 'auth.json')]);
    sources.push([path.join(userRoot, '.codex', 'auth.json')]);
  }
  const candidates = [];
  for (const [file, email] of sources) {
    const auth = read(file);
    if (account.provider === 'codex' && auth?.tokens) {
      const identity = jwt(auth.tokens.id_token);
      if (sameEmail(identity.email, account.email)) candidates.push({ token: auth.tokens.access_token,
        expires: (jwt(auth.tokens.access_token).exp || 0) * 1000, accountId: auth.tokens.account_id });
    } else if (auth?.claudeAiOauth && sameEmail(email, account.email)) {
      candidates.push({ token: auth.claudeAiOauth.accessToken, expires: auth.claudeAiOauth.expiresAt,
        plan: auth.claudeAiOauth.rateLimitTier?.includes('20x') ? 'Max 20x' :
          auth.claudeAiOauth.rateLimitTier?.includes('5x') ? 'Max 5x' : auth.claudeAiOauth.subscriptionType });
    }
  }
  const selected = candidates.filter(c => typeof c.token === 'string').sort((a, b) => b.expires - a.expires)[0];
  if (!selected) throw new Error('No matching ' + account.provider + ' login found for ' + account.email + '. Check its home folder and sign in.');
  if (selected.expires <= Date.now()) throw new Error('Login expired. Open ' + account.provider + ' as ' + account.email + ' and run /usage or /login.');
  return selected;
}

async function collectAccount(account) {
  if (account.provider === 'codex') {
    const c = credentials(account);
    return parseCodex(await request('https://chatgpt.com/backend-api/wham/usage', {
      Authorization: 'Bearer ' + c.token, 'ChatGPT-Account-Id': c.accountId }), account.email);
  }
  if (account.provider === 'claude') {
    const c = credentials(account);
    const headers = { Authorization: 'Bearer ' + c.token, 'anthropic-beta': 'oauth-2025-04-20' };
    const identity = await request('https://api.anthropic.com/api/oauth/profile', headers);
    checkEmail(identity.account?.email, account.email);
    const data = await request('https://api.anthropic.com/api/oauth/usage', headers);
    return { ...parseClaude(data), plan: c.plan || account.plan };
  }
  if (account.provider === 'grok') {
    const all = read(path.join(account.home ? expand(account.home) : path.join(root, '.grok'), 'auth.json'));
    const c = Object.values(all || {}).filter(v => sameEmail(v?.email, account.email))
      .sort((a, b) => new Date(b.expires_at) - new Date(a.expires_at))[0];
    if (!c?.key) throw new Error('No matching Grok login. Run grok login.');
    if (!(new Date(c.expires_at).getTime() > Date.now())) throw new Error('Grok login expired. Open Grok to renew it.');
    const headers = { Authorization: 'Bearer ' + c.key, 'x-xai-token-auth': 'xai-grok-cli' };
    const data = await request('https://cli-chat-proxy.grok.com/v1/billing?format=credits', headers);
    const result = parseGrok(data);
    if (!Object.hasOwn(data.config, 'creditUsagePercent')) {
      const used = await fetchCredits(headers, data.config.currentPeriod);
      if (used !== null) result.weekly = quota(used, data.config.currentPeriod.end);
    }
    return result;
  }
  return parseDevin(await fetchNative(account.cli || 'devin'), account.email);
}

function withStatus(account, result, error, prior, now) {
  const timestamp = new Date(now).toISOString();
  const row = { id: account.id, provider: account.provider, email: account.email, label: account.label,
    plan: account.plan, checkedAt: timestamp, capturedAt: null, weekly: quota(null, null),
    session: quota(null, null), sessionLabel: '5 hours', status: 'Unavailable', message: error || '' };
  if (result) {
    Object.assign(row, result, { capturedAt: timestamp });
    if (row.weekly.reset && Date.parse(row.weekly.reset) <= now) {
      row.status = 'Reset pending';
      row.message = 'Provider returned the previous period. Waiting for a new reading.';
      row.weekly = quota(null, null);
    } else if (row.weekly.used !== null) row.status = 'Live';
    else row.message = 'Provider did not supply a weekly usage percentage.';
  } else if (prior?.id === account.id && sameEmail(prior.email, account.email) && prior.weekly?.used != null
      && prior.capturedAt && now - Date.parse(prior.capturedAt) < 86400000
      && prior.weekly.reset && Date.parse(prior.weekly.reset) > now) {
    Object.assign(row, { weekly: prior.weekly, session: prior.session, capturedAt: prior.capturedAt,
      plan: prior.plan, sessionLabel: prior.sessionLabel || row.sessionLabel, status: 'Stale' });
  }
  return row;
}

async function collect(accounts, previous = null) {
  const results = await Promise.all(accounts.map(async account => {
    let result, error;
    try { result = await collectAccount(account); } catch (e) { error = e.message; }
    return withStatus(account, result, error, previous?.accounts?.find(a => a.id === account.id), Date.now());
  }));
  return { generatedAt: new Date().toISOString(), refreshMinutes: 15, accounts: results };
}

if (require.main === module) {
  const cache = path.join(__dirname, 'usage-cache.json');
  let accounts;
  try { accounts = loadAccounts(loadConfig(process.env.WEEKLY_USAGE_CONFIG || path.join(__dirname, 'accounts.json'))); }
  catch (e) { process.stderr.write(e.message + '\n'); process.exit(2); }
  collect(accounts, read(cache)).then(data => {
    const output = JSON.stringify(data, null, 2);
    const temp = cache + '.' + process.pid + '.tmp';
    fs.writeFileSync(temp, output + '\n', { mode: 0o600 });
    fs.renameSync(temp, cache);
    process.stdout.write(output + '\n');
  }).catch(() => { process.stderr.write('Usage refresh failed. Check local file permissions.\n'); process.exitCode = 1; });
}

module.exports = { loadConfig, loadAccounts, quota, checkEmail, parseCodex, parseClaude, parseGrok, parseDevin, withStatus, credentials };
