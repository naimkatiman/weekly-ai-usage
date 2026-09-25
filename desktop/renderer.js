'use strict';

const ui = id => document.getElementById(id);
const providers = { codex: 'Codex', claude: 'Claude Code', grok: 'Grok', devin: 'Devin' };
let state = { profiles: [], privacy: true, defaultProfileId: null, refreshing: false };
let editor = null;
let returnFocus = null;
let reading = false;
let noticeTimer;
const busyProfiles = new Set();

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#icon-' + name);
  svg.append(use);
  return svg;
}

function button(text, className, onClick) {
  const element = node('button', 'button ' + className, text);
  element.type = 'button';
  element.addEventListener('click', onClick);
  return element;
}

function safeText(value, fallback) {
  if (!value) return fallback;
  const text = String(value);
  if (state.privacy && (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text) || /(?:[A-Z]:[\\/]|\/Users\/|\/home\/|\\Users\\)/i.test(text))) return fallback;
  return text;
}

function announce(message, error = false) {
  clearTimeout(noticeTimer);
  const notice = ui('app-notice');
  notice.textContent = safeText(message, error ? 'The action could not finish. Check the provider setup and try again.' : 'Account updated.');
  notice.classList.toggle('notice-error', error);
  notice.hidden = false;
  if (!error) noticeTimer = setTimeout(() => { notice.hidden = true; }, 6500);
}

async function request(method, ...args) {
  if (!window.desktop || typeof window.desktop[method] !== 'function') throw new Error('The desktop connection is unavailable. Close and reopen the app.');
  const result = await window.desktop[method](...args);
  if (!result || result.ok !== true) throw new Error(typeof result?.error === 'string' ? result.error : 'The action could not finish. Try again.');
  return result.data;
}

function applyState(data) {
  if (!data || !Array.isArray(data.profiles)) return false;
  state = { ...data, privacy: data.privacy !== false };
  render();
  return true;
}

async function loadState() {
  if (reading) return;
  reading = true;
  try { applyState(await request('getState')); }
  catch (error) { announce(error.message, true); }
  finally { reading = false; ui('profile-grid').setAttribute('aria-busy', 'false'); }
}

function percentage(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value * 10) / 10 : null;
}

function resetText(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return 'Reset time unavailable';
  return 'Resets ' + date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function capturedText(value) {
  const elapsed = Date.now() - Date.parse(value || '');
  if (!Number.isFinite(elapsed)) return 'No reading yet';
  if (elapsed < 60000) return 'Checked just now';
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 60) return 'Checked ' + minutes + 'm ago';
  return 'Checked ' + Math.floor(minutes / 60) + 'h ago';
}

function profileCard(profile, index) {
  const provider = providers[profile.provider] || 'Agent';
  const name = safeText(profile.label, provider + ' account ' + (index + 1));
  const capabilities = profile.capabilities || {};
  const usage = profile.usage || {};
  const rawStatus = String(usage.status || 'Unavailable').toLowerCase();
  const status = rawStatus === 'live' ? 'Live' : rawStatus === 'stale' ? 'Stale' : rawStatus === 'reset pending' ? 'Reset pending' : 'Unavailable';
  const known = status === 'Live' || status === 'Stale';
  const remaining = known ? percentage(usage.weekly?.remaining) : null;
  const used = known ? percentage(usage.weekly?.used) : null;
  const card = node('article', 'profile-card');
  card.setAttribute('aria-label', name + ', ' + provider);
  const heading = node('div', 'card-heading');
  heading.append(node('span', 'provider-mark provider-' + profile.provider, provider.charAt(0)));
  const names = node('div', 'account-heading');
  names.append(node('h3', 'account-name', name), node('p', 'provider-name', provider));
  const edit = button('Edit', 'button-quiet card-edit', () => openEditor(profile));
  edit.setAttribute('aria-label', 'Edit ' + name);
  heading.append(names, edit);
  card.append(heading);
  if (!state.privacy) {
    const details = node('div', 'private-details');
    for (const [key, label] of [['email', 'Account'], ['home', 'Profile'], ['workspace', 'Project']]) {
      if (profile[key]) details.append(node('span', '', label + ': ' + profile[key]));
    }
    if (details.childElementCount) card.append(details);
  }
  const quota = node('div', 'quota-row');
  const value = node('p', 'quota-value' + (remaining === null ? ' quota-unknown' : ''), remaining === null ? 'No reading yet' : remaining + '%');
  if (remaining !== null) value.append(node('small', '', status === 'Stale' ? 'left at last check' : 'left'));
  const badge = node('span', 'status' + (status === 'Live' ? ' status-live' : status === 'Stale' ? ' status-stale' : status === 'Reset pending' ? ' status-reset' : ''), status);
  quota.append(value, badge);
  card.append(quota);
  if (remaining !== null) {
    const meter = node('progress', 'quota-meter' + (remaining < 20 ? ' quota-low' : '') + (status === 'Stale' ? ' quota-stale' : ''));
    meter.max = 100;
    meter.value = remaining;
    meter.setAttribute('aria-label', name + ': ' + remaining + '% weekly quota remaining' + (status === 'Stale' ? ' at last check' : ''));
    card.append(meter);
  } else card.append(node('div', 'quota-empty'));
  const details = node('div', 'quota-details');
  details.append(node('span', '', used === null ? 'Weekly quota unavailable' : used + '% used this week'), node('span', '', resetText(usage.weekly?.reset)));
  card.append(details);
  const sessionRemaining = percentage(usage.session?.remaining);
  if (sessionRemaining !== null) {
    const resetPassed = Date.parse(usage.session.reset || '') <= Date.now();
    const session = node('div', 'session-quota' + (sessionRemaining === 0 && !resetPassed ? ' exhausted' : ''));
    session.append(node('span', '', safeText(usage.sessionLabel, 'Shorter window') + ' allowance'));
    session.append(node('strong', '', resetPassed ? 'Awaiting fresh reading' : sessionRemaining + '% left' + (status !== 'Live' ? ' at last check' : '')));
    session.append(node('small', '', (sessionRemaining === 0 && !resetPassed ? 'No allowance left in this window. ' : '') + resetText(usage.session.reset)));
    card.append(session);
  }
  let note = capabilities.isolated ? 'Opens in its own profile. Other accounts stay as they are.' : 'Uses an existing login. Account switching is not available.';
  if (!profile.cliAvailable) note = 'CLI not found. Install the provider CLI, or choose its executable in Edit.';
  else if (status === 'Stale') note = 'Showing the last reading. Refresh to check the current allowance.';
  else if (status === 'Reset pending') note = 'The reset time has passed. Waiting for a fresh provider reading.';
  else if (!capabilities.usage) note = 'This provider does not report quota here. You can still open its terminal.';
  else if (status === 'Unavailable') note = capabilities.connect ? 'No verified quota yet. Sign in, then refresh your usage.' : 'No verified quota yet. Check your existing provider login, then refresh.';
  if (usage.message) note = safeText(usage.message, note);
  if (profile.sharesDefaultHome) note += ' Shared default login. Create a separate profile to add another account.';
  else if (!capabilities.launch) note += ' Usage only: safe profile launch is not supported for this provider yet.';
  else if (!capabilities.isolated) note += ' Opens the existing login; it does not switch accounts.';
  card.append(node('p', 'account-note' + (!profile.cliAvailable ? ' warning' : ''), note));
  if (!profile.cliAvailable) {
    const guide = button('CLI setup guide', 'button-text setup-guide', () => openProviderDocs(profile.provider));
    guide.setAttribute('aria-label', provider + ' CLI setup guide');
    guide.append(icon('arrow'));
    card.append(guide);
  }
  const actions = node('div', 'card-actions');
  const open = button(capabilities.isolated ? 'Open terminal' : 'Open existing login', 'button-primary', () => launch(profile, 'launch'));
  open.prepend(icon('terminal'));
  open.disabled = !profile.cliAvailable || !capabilities.launch || busyProfiles.has(profile.id);
  open.setAttribute('aria-label', capabilities.isolated ? 'Open terminal with ' + name : 'Open existing login for ' + name);
  actions.append(open);
  if (capabilities.connect) {
    const connect = button(status === 'Live' || status === 'Stale' ? 'Reconnect' : 'Sign in', 'button-secondary', () => launch(profile, 'login'));
    connect.disabled = !profile.cliAvailable || busyProfiles.has(profile.id);
    connect.setAttribute('aria-label', (status === 'Live' || status === 'Stale' ? 'Reconnect ' : 'Sign in to ') + name);
    actions.append(connect);
  } else actions.append(node('span', 'existing-login', 'Existing login'));
  card.append(actions);
  const bottom = node('div', 'card-bottom');
  const isDefault = state.defaultProfileId === profile.id;
  const defaultButton = button(isDefault ? 'Default in this app' : 'Use by default', 'button-text default-control', () => changeDefault(isDefault ? null : profile.id));
  defaultButton.setAttribute('aria-pressed', String(isDefault));
  defaultButton.setAttribute('aria-label', (isDefault ? 'Clear default: ' : 'Make default: ') + name);
  defaultButton.title = 'Default for future launches from this app. Does not change existing terminals or global CLI defaults.';
  bottom.append(defaultButton, node('span', 'last-checked', capturedText(usage.capturedAt)));
  card.append(bottom);
  return card;
}

function render() {
  ui('demo-label').hidden = !state.demo;
  const defaultProfile = state.profiles.find(profile => profile.id === state.defaultProfileId);
  ui('launch-default').hidden = !defaultProfile;
  ui('launch-default').disabled = !defaultProfile?.cliAvailable || !defaultProfile?.capabilities?.launch || busyProfiles.has(defaultProfile?.id);
  ui('launch-default-label').textContent = defaultProfile ? 'Open ' + safeText(defaultProfile.label, 'default account') : 'Open default account';
  ui('add-profile').classList.toggle('button-primary', !defaultProfile);
  ui('add-profile').classList.toggle('button-secondary', Boolean(defaultProfile));
  ui('privacy-toggle').setAttribute('aria-pressed', String(state.privacy));
  ui('privacy-label').textContent = state.privacy ? 'Privacy on' : 'Details visible';
  ui('refresh-label').textContent = state.refreshing ? 'Refreshing...' : 'Refresh usage';
  ui('refresh-usage').disabled = Boolean(state.refreshing);
  ui('empty-state').hidden = state.profiles.length !== 0;
  ui('profile-grid').hidden = state.profiles.length === 0;
  ui('import-profiles').hidden = state.profiles.length === 0;
  ui('account-summary').textContent = state.profiles.length ? state.profiles.length + (state.profiles.length === 1 ? ' account' : ' accounts') + ' on this device' : 'A familiar nickname. One click to start.';
  const focused = document.activeElement;
  const focusedLabel = ui('profile-grid').contains(focused) ? focused.getAttribute('aria-label') : null;
  ui('profile-grid').replaceChildren(...state.profiles.map(profileCard));
  if (focusedLabel) {
    const replacement = [...ui('profile-grid').querySelectorAll('button')].find(item => item.getAttribute('aria-label') === focusedLabel);
    replacement?.focus({ preventScroll: true });
  }
}

async function launch(profile, action) {
  busyProfiles.add(profile.id);
  render();
  try {
    const result = await request('launchProfile', profile.id, action);
    const message = action === 'login' ? 'Sign-in terminal opened. Finish the provider login, then refresh usage.' : profile.capabilities?.isolated ? 'Terminal opened with the selected account.' : 'Terminal opened with the existing provider login. The app did not switch accounts.';
    announce(message + (result?.clearedAuthKeys?.length ? ' Conflicting authentication settings were excluded from this terminal.' : ''));
  } catch (error) { announce(error.message, true); }
  finally { busyProfiles.delete(profile.id); await loadState(); render(); }
}

async function openProviderDocs(provider) {
  try { await request('openProviderDocs', provider); }
  catch (error) { announce(error.message, true); }
}

async function changeDefault(id) {
  try { if (!applyState(await request('setDefault', id))) await loadState(); }
  catch (error) { announce(error.message, true); }
}

function openEditor(profile = null) {
  returnFocus = document.activeElement;
  editor = { id: profile?.id || null, profile, paths: {} };
  ui('profile-form').reset();
  ui('profile-provider').value = profile?.provider || 'codex';
  ui('profile-provider').disabled = Boolean(profile);
  ui('profile-label').value = profile ? safeText(profile.label, providers[profile.provider] + ' account') : '';
  ui('profile-email').value = !state.privacy && profile?.email ? profile.email : '';
  ui('dialog-title').textContent = profile ? 'Edit account' : 'Add an account';
  ui('save-profile').textContent = profile ? 'Save changes' : 'Add account';
  ui('remove-profile').hidden = !profile;
  ui('remove-confirmation').hidden = true;
  ui('form-error').hidden = true;
  ui('advanced-settings').open = false;
  ui('home-value').textContent = !state.privacy && profile?.home ? profile.home : profile?.hasHome ? 'Current profile folder (hidden)' : 'Choose profile folder';
  ui('workspace-value').textContent = !state.privacy && profile?.workspace ? profile.workspace : profile ? 'Keep current project folder' : 'Choose where your terminal opens';
  ui('cli-value').textContent = profile ? 'Keep current executable setting' : 'Detect automatically';
  updateEditorMode();
  ui('profile-dialog').showModal();
  ui('profile-label').focus();
}

function closeEditor() {
  ui('profile-form').reset();
  ui('form-error').textContent = '';
  for (const kind of ['home', 'workspace', 'cli']) ui(kind + '-value').textContent = '';
  ui('profile-dialog').close();
}

function updateEditorMode() {
  if (!editor) return;
  const provider = ui('profile-provider').value;
  const isolated = provider === 'codex' || provider === 'claude';
  ui('profile-mode').hidden = Boolean(editor.id) || !isolated;
  if (!isolated) ui('profile-form').elements.mode.value = 'link';
  const createNew = !editor.id && isolated && ui('profile-form').elements.mode.value === 'new';
  const defaultLogin = !editor.id && isolated && ui('profile-form').elements.mode.value === 'default';
  ui('home-field').hidden = createNew || defaultLogin || provider === 'devin' || Boolean(editor.profile?.usesDefaultHome);
  ui('capability-note').hidden = isolated && !defaultLogin && !editor.profile?.sharesDefaultHome;
  ui('capability-note').textContent = defaultLogin || editor.profile?.sharesDefaultHome ? 'This uses your existing default login. To add another account without changing it, create a new isolated account.' : provider === 'devin' ? 'Devin uses its existing local login. Separate account switching and in-app sign-in are not available.' : 'Link an existing Grok profile for supported usage and launch features. Isolated account switching is not available in this preview.';
  const savedEmail = Boolean(editor.profile?.hasEmail || (!state.privacy && editor.profile?.email));
  ui('email-help').textContent = savedEmail ? (state.privacy ? 'The saved email is hidden. Leave blank to keep it.' : 'Leave blank to keep the saved email. Enter a different address only to correct the account identity.') : isolated ? 'Optional identity check. Codex and Claude Code accounts can be detected after sign-in.' : 'Required to read this provider\'s quota. Without it, usage stays unavailable.';
  if (!isolated && !savedEmail) ui('advanced-settings').open = true;
  ui('save-hint').textContent = editor.id ? 'Changes apply to future launches from this app.' : defaultLogin ? 'Uses the existing provider login. The app will not sign it out or replace it.' : createNew ? 'Saving creates the account entry. Sign in through the provider to connect it.' : 'Linking keeps your account files in place. It does not copy credentials.';
}

async function choosePath(kind) {
  if (!editor) return;
  const activeEditor = editor;
  try {
    const path = kind === 'cli' ? await request('chooseExecutable') : await request('chooseFolder', kind);
    if (!path || editor !== activeEditor) return;
    editor.paths[kind] = path;
    ui(kind + '-value').textContent = state.privacy ? (kind === 'cli' ? 'Executable selected (hidden)' : 'Folder selected (hidden)') : path;
  } catch (error) { showFormError(error.message); }
}

function showFormError(message) {
  ui('form-error').textContent = safeText(message, 'The account could not be saved. Check the selected folder and nickname.');
  ui('form-error').hidden = false;
}

async function saveProfile(event) {
  event.preventDefault();
  if (!editor) return;
  const activeEditor = editor;
  const label = ui('profile-label').value.trim();
  if (!label) { showFormError('Give this account a nickname, such as Personal or Work.'); ui('profile-label').focus(); return; }
  const provider = ui('profile-provider').value;
  const email = ui('profile-email').value.trim();
  if (email && !ui('profile-email').checkValidity()) { showFormError('Enter a valid account email, or leave it blank.'); ui('advanced-settings').open = true; ui('profile-email').focus(); return; }
  const createNew = !editor.id && (provider === 'codex' || provider === 'claude') && ui('profile-form').elements.mode.value === 'new';
  const defaultLogin = !editor.id && (provider === 'codex' || provider === 'claude') && ui('profile-form').elements.mode.value === 'default';
  if (!editor.id && !createNew && !defaultLogin && provider !== 'devin' && !editor.paths.home) { showFormError('Choose the existing profile folder first.'); ui('choose-home').focus(); return; }
  ui('save-profile').disabled = true;
  ui('form-error').hidden = true;
  try {
    const paths = { ...editor.paths };
    if (createNew || defaultLogin) delete paths.home;
    if (email) paths.email = email;
    if (defaultLogin) paths.defaultLogin = true;
    const data = editor.id ? await request('updateProfile', editor.id, { label, ...paths }) : await request('addProfile', { provider, label, createNew, ...paths });
    if (editor === activeEditor) closeEditor();
    if (!applyState(data)) await loadState();
    announce(createNew ? 'Account added. Choose Sign in to connect it through the provider.' : 'Account saved. Refresh usage to check its allowance.');
  } catch (error) { if (editor === activeEditor) showFormError(error.message); else announce(error.message, true); }
  finally { ui('save-profile').disabled = false; }
}

async function removeProfile() {
  if (!editor?.id) return;
  const activeEditor = editor;
  ui('confirm-remove').disabled = true;
  try {
    const data = await request('removeProfile', editor.id);
    if (editor === activeEditor) closeEditor();
    if (!applyState(data)) await loadState();
    announce('Account removed from this app. Its login and files were kept.');
  } catch (error) { if (editor === activeEditor) showFormError(error.message); else announce(error.message, true); }
  finally { ui('confirm-remove').disabled = false; }
}

async function refreshUsage() {
  ui('refresh-usage').disabled = true;
  ui('refresh-label').textContent = 'Refreshing...';
  try {
    if (!applyState(await request('refreshUsage'))) await loadState();
    ui('live-announcement').textContent = 'Usage refresh finished. Check each account for its reading status.';
  } catch (error) { announce(error.message, true); }
  finally { render(); }
}

async function importLegacy() {
  try {
    const data = await request('importLegacy');
    if (!data) return;
    if (!applyState(data)) await loadState();
    announce('Import finished. Existing account folders stay in place.');
  } catch (error) { announce(error.message, true); }
}

ui('privacy-toggle').addEventListener('click', async () => {
  ui('privacy-toggle').disabled = true;
  try {
    if (!applyState(await request('setPrivacy', !state.privacy))) await loadState();
    ui('app-notice').hidden = true;
    ui('app-notice').textContent = '';
    ui('form-error').textContent = '';
  } catch (error) { announce(error.message, true); }
  finally { ui('privacy-toggle').disabled = false; }
});
for (const id of ['add-profile', 'add-first-profile']) ui(id).addEventListener('click', () => openEditor());
for (const id of ['import-empty', 'import-profiles']) ui(id).addEventListener('click', importLegacy);
for (const id of ['close-dialog', 'cancel-dialog']) ui(id).addEventListener('click', closeEditor);
for (const kind of ['home', 'workspace', 'cli']) ui('choose-' + kind).addEventListener('click', () => choosePath(kind));
ui('profile-provider').addEventListener('change', () => {
  editor.paths = {};
  ui('home-value').textContent = 'Choose profile folder';
  ui('workspace-value').textContent = 'Choose where your terminal opens';
  ui('cli-value').textContent = 'Detect automatically';
  updateEditorMode();
});
ui('profile-mode').addEventListener('change', updateEditorMode);
ui('profile-form').addEventListener('submit', saveProfile);
ui('refresh-usage').addEventListener('click', refreshUsage);
ui('launch-default').addEventListener('click', () => {
  const profile = state.profiles.find(item => item.id === state.defaultProfileId);
  if (profile?.cliAvailable && profile.capabilities?.launch && !busyProfiles.has(profile.id)) launch(profile, 'launch');
});
ui('remove-profile').addEventListener('click', () => { ui('remove-confirmation').hidden = false; ui('confirm-remove').focus(); });
ui('cancel-remove').addEventListener('click', () => { ui('remove-confirmation').hidden = true; ui('remove-profile').focus(); });
ui('confirm-remove').addEventListener('click', removeProfile);
ui('profile-dialog').addEventListener('close', () => {
  if (ui('profile-dialog').open) return;
  editor = null;
  ui('profile-form').reset();
  ui('form-error').textContent = '';
  for (const kind of ['home', 'workspace', 'cli']) ui(kind + '-value').textContent = '';
  (returnFocus?.isConnected ? returnFocus : ui('add-profile')).focus({ preventScroll: true });
});
window.addEventListener('focus', loadState);
setInterval(loadState, 15000);
loadState();
