import { createValidator, SEVERITIES } from './lib/validator.js';
import { extractJsonLd } from './lib/extract.js';

const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);

const state = {
  windowId: null,
  scanToken: 0,
  payload: null,
  results: null,
  filters: { error: true, warning: true, info: true },
};
let validator = null;
let debounceTimer = null;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child != null) node.append(child);
  return node;
}

function setPage(title, url) {
  $('page-title').textContent = title || '(untitled)';
  $('page-url').textContent = url || '';
  const isWeb = /^https?:\/\//.test(url || '');
  $('external-links').hidden = !isWeb;
  if (isWeb) {
    const encoded = encodeURIComponent(url);
    $('link-rrt').href = `https://search.google.com/test/rich-results?url=${encoded}`;
    $('link-smv').href = `https://validator.schema.org/#url=${encoded}`;
  }
}

function showMessage(text, action) {
  $('summary').hidden = true;
  $('content').replaceChildren(el('div', { class: 'message' }, el('div', { text }), action));
}

function scheduleScan() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(scan, 300);
}

async function scan() {
  const token = ++state.scanToken;
  const [tab] = await api.tabs.query({ active: true, windowId: state.windowId });
  if (!tab || token !== state.scanToken) return;
  setPage(tab.title, tab.url);

  let payload;
  try {
    const [injection] = await api.scripting.executeScript({ target: { tabId: tab.id }, func: extractJsonLd });
    payload = injection?.result;
  } catch (error) {
    if (token !== state.scanToken) return;
    const canRequest = /^https?:\/\//.test(tab.url || '') && api.permissions?.request;
    showMessage(
      `This page cannot be read (${error.message}). Browser-internal pages and extension stores are always blocked.`,
      canRequest
        ? el('button', {
            type: 'button',
            text: 'Grant access to all websites',
            onclick: () => api.permissions.request({ origins: ['<all_urls>'] }).then((ok) => ok && scan()),
          })
        : null,
    );
    return;
  }
  if (token !== state.scanToken) return;
  if (!payload) {
    showMessage('The page returned no result.');
    return;
  }

  setPage(payload.title, payload.url);
  state.payload = payload;
  state.results = validator.validatePage(payload.blocks);
  render();
}

function render() {
  const { results, payload } = state;
  if (!results.length) {
    showMessage('No JSON-LD (script type="application/ld+json") found on this page.');
    return;
  }

  const totals = { error: 0, warning: 0, info: 0 };
  for (const r of results) for (const i of r.issues) totals[i.severity]++;
  for (const s of SEVERITIES) $(`count-${s}`).textContent = totals[s];
  $('summary').hidden = false;

  $('content').replaceChildren(...results.map((result, pos) => renderBlock(result, payload.blocks[pos])));
}

function renderBlock(result, block) {
  const count = (s) => result.issues.filter((i) => i.severity === s).length;
  const errors = count('error');
  const warnings = count('warning');
  const types = [...new Set(result.types)].join(', ') || (result.data ? '(no known type)' : '(invalid)');

  const issues = result.issues.filter((i) => state.filters[i.severity]);
  const issueList = issues.length
    ? el(
        'ul',
        { class: 'issues' },
        ...issues.map((issue) =>
          el(
            'li',
            { class: `issue ${issue.severity}`, title: 'Show in structure', onclick: (e) => reveal(e.currentTarget, issue.path) },
            el('span', { text: issue.message }),
            el('span', { class: 'issue-path', text: issue.path }),
          ),
        ),
      )
    : null;

  const markers = groupIssuesByNode(result.issues);
  const structure = result.data
    ? el(
        'details',
        { class: 'section structure', open: '' },
        el('summary', { text: 'Structure' }),
        el('div', { class: 'tree' }, renderTree(result.data, '$', null, markers, 0)),
      )
    : null;

  const pretty = result.data ? JSON.stringify(result.data, null, 2) : block.text;
  const source = el(
    'details',
    { class: 'section source' },
    el('summary', { text: 'Source' }),
    el('pre', { text: pretty }),
    el('button', {
      type: 'button',
      text: 'Copy',
      onclick: (e) => {
        const button = e.currentTarget;
        navigator.clipboard.writeText(pretty).then(
          () => (button.textContent = 'Copied'),
          () => (button.textContent = 'Copy failed'),
        );
      },
    }),
  );

  return el(
    'details',
    { class: 'block', open: '' },
    el(
      'summary',
      {},
      el('span', { class: 'block-types', text: types }),
      el('span', { class: 'block-meta', text: `#${result.index + 1} · ${result.location}` }),
      errors ? el('span', { class: 'count error', text: String(errors), title: 'Errors' }) : null,
      warnings ? el('span', { class: 'count warning', text: String(warnings), title: 'Warnings' }) : null,
      !errors && !warnings ? el('span', { class: 'count ok', text: '✓', title: 'No errors or warnings' }) : null,
    ),
    el('div', { class: 'block-body' }, issueList, structure, source),
  );
}

// Issues on @type / @id / @value belong to the node that holds them.
const nodePath = (path) => path.replace(/\.@(type|id|context|value)$/, '');

function groupIssuesByNode(issues) {
  const map = new Map();
  for (const issue of issues) {
    const key = nodePath(issue.path);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(issue);
  }
  return map;
}

function marker(path, markers) {
  const issues = (markers.get(path) || []).filter((i) => state.filters[i.severity]);
  if (!issues.length) return null;
  const worst = SEVERITIES.find((s) => issues.some((i) => i.severity === s));
  return el('span', { class: `marker ${worst}`, text: '●', title: issues.map((i) => i.message).join('\n') });
}

function renderTree(value, path, label, markers, depth) {
  const labelNode = label == null ? null : el('span', { class: 'key', text: `${label}: ` });

  if (value === null || typeof value !== 'object') {
    return el('div', { class: 'row', 'data-path': path }, labelNode, el('span', { text: JSON.stringify(value) }), marker(path, markers));
  }

  const isArray = Array.isArray(value);
  const type = !isArray && value['@type'] != null ? [].concat(value['@type']).join(', ') : null;
  const summaryText = isArray ? `[${value.length}]` : type || (value['@id'] ? `→ ${value['@id']}` : '{…}');

  const children = isArray
    ? value.map((v, i) => renderTree(v, `${path}[${i}]`, `[${i}]`, markers, depth + 1))
    : Object.entries(value)
        .filter(([key]) => key !== '@type')
        .map(([key, v]) => renderTree(v, `${path}.${key}`, key, markers, depth + 1));

  const attrs = { 'data-path': path };
  if (depth < 2) attrs.open = '';
  return el(
    'details',
    attrs,
    el('summary', {}, labelNode, el('span', { class: type ? 'type' : '', text: summaryText }), marker(path, markers)),
    ...children,
  );
}

function reveal(issueElement, path) {
  const block = issueElement.closest('.block');
  let target = null;
  // Walk up the path until a rendered element exists.
  for (let p = nodePath(path); p && !target; p = p.replace(/(\.[^.[\]]+|\[\d+\])$/, '')) {
    target = block.querySelector(`[data-path="${CSS.escape(p)}"]`);
    if (p === '$') break;
  }
  if (!target) return;
  for (let d = target.parentElement; d && d !== block; d = d.parentElement) {
    if (d.tagName === 'DETAILS') d.open = true;
  }
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.add('flash');
  setTimeout(() => target.classList.remove('flash'), 1200);
}

async function init() {
  const vocab = await (await fetch(api.runtime.getURL('vocab.json'))).json();
  validator = createValidator(vocab);
  $('vocab-info').textContent = `Offline check against the schema.org vocabulary (downloaded ${vocab.generated}).`;

  state.windowId = (await api.windows.getCurrent()).id;

  api.tabs.onActivated.addListener(({ windowId }) => {
    if (windowId === state.windowId) scheduleScan();
  });
  api.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (tab.active && tab.windowId === state.windowId && (info.status === 'complete' || info.url)) scheduleScan();
  });

  $('rescan').addEventListener('click', scan);
  for (const input of document.querySelectorAll('[data-filter]')) {
    input.addEventListener('change', () => {
      state.filters[input.dataset.filter] = input.checked;
      if (state.results) render();
    });
  }

  scan();
}

init().catch((error) => showMessage(`Initialisation failed: ${error.message}`));
