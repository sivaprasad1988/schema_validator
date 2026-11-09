import { createValidator, buildItems } from './lib/validator.js';
import { extractJsonLd } from './lib/extract.js';

// Toolbar icon opens the panel.
// Firefox: sidebar_action (toggle must run directly in the click handler).
// Chrome: side_panel with openPanelOnActionClick.
const api = globalThis.browser ?? globalThis.chrome;

if (api.sidebarAction?.toggle) {
  api.action.onClicked.addListener(() => {
    api.sidebarAction.toggle();
  });
} else if (api.sidePanel?.setPanelBehavior) {
  api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));
}

// Toolbar badge: after each page load the page is scanned and the icon shows the number of
// detected schema items. Colour: red = errors, orange = warnings, green = valid, grey "0" = no JSON-LD.
const COLORS = { error: '#d93025', warning: '#e37400', ok: '#188038', none: '#80868b' };
let validatorPromise = null;

function getValidator() {
  validatorPromise ??= fetch(api.runtime.getURL('vocab.json'))
    .then((response) => response.json())
    .then(createValidator)
    .catch((error) => {
      validatorPromise = null;
      throw error;
    });
  return validatorPromise;
}

async function setBadge(tabId, text, color, title) {
  try {
    await api.action.setBadgeText({ tabId, text });
    if (color) await api.action.setBadgeBackgroundColor({ tabId, color });
    if (api.action.setBadgeTextColor && color) await api.action.setBadgeTextColor({ tabId, color: '#ffffff' });
    await api.action.setTitle({ tabId, title: title ? `Schema Validator – ${title}` : 'Schema Validator' });
  } catch {
    // Tab was closed in the meantime.
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function updateBadge(tabId, url) {
  if (!/^https?:\/\//.test(url || '')) {
    await setBadge(tabId, '', null, null);
    return;
  }
  let payload;
  try {
    const [injection] = await api.scripting.executeScript({ target: { tabId }, func: extractJsonLd });
    payload = injection?.result;
  } catch {
    // No host access (e.g. Firefox without granted permission, extension stores).
    await setBadge(tabId, '', null, null);
    return;
  }
  if (!payload) return;

  if (!payload.blocks.length) {
    await setBadge(tabId, '0', COLORS.none, 'no schema (JSON-LD) found');
    return;
  }

  const results = (await getValidator()).validatePage(payload.blocks);
  const totals = { error: 0, warning: 0 };
  for (const r of results) for (const i of r.issues) if (i.severity in totals) totals[i.severity]++;
  const count = buildItems(results).length;
  const status = totals.error ? 'error' : totals.warning ? 'warning' : 'ok';
  await setBadge(
    tabId,
    count > 99 ? '99+' : String(count),
    COLORS[status],
    `${plural(count, 'item')}, ${plural(totals.error, 'error')}, ${plural(totals.warning, 'warning')}`,
  );
}

api.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete') updateBadge(tabId, tab.url).catch((error) => console.error(error));
});
