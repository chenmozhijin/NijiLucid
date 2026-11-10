export const CAPTURE_STYLE_MESSAGE = 'NIJILUCID_CAPTURE_COMPOSITING';
const PREFIX = 'capture-compositing:';

export function isCrunchyrollUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'crunchyroll.com' || parsed.hostname.endsWith('.crunchyroll.com'));
  } catch { return false; }
}

/** Persist ownership so closing a viewer also cleans up after worker suspension. */
export function registerCaptureCompositing(): void {
  let pending = Promise.resolve();
  const enqueue = (operation: () => Promise<void>) => {
    const next = pending.then(operation);
    pending = next.catch(() => undefined);
    return next;
  };
  const cleanup = async (viewerId: number) => {
    const key = `${PREFIX}${viewerId}`;
    const record = (await chrome.storage.session.get(key))[key] as chrome.scripting.CSSInjection | undefined;
    if (!record) return;
    try { await chrome.scripting.removeCSS(record); } catch { /* Source may already be closed. */ }
    await chrome.storage.session.remove(key);
  };
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== CAPTURE_STYLE_MESSAGE) return;
    const viewerId = sender.tab?.id;
    const url = sender.url ? new URL(sender.url) : null;
    const viewerUrl = new URL(chrome.runtime.getURL('capture.html'));
    if (viewerId === undefined || !url || url.protocol !== viewerUrl.protocol
      || url.host !== viewerUrl.host || url.pathname !== viewerUrl.pathname) return;
    const source = url.searchParams.get('source');
    if (source === null || !/^\d+$/.test(source)) return;
    const sourceTabId = Number(source);
    if (!Number.isSafeInteger(sourceTabId) || sourceTabId === viewerId) return;
    void enqueue(async () => {
      await cleanup(viewerId);
      if (message.enabled !== true) return;
      const tab = await chrome.tabs.get(sourceTabId);
      if (!isCrunchyrollUrl(tab.url || '')) throw new Error('The experimental CSS is limited to Crunchyroll.');
      const injection: chrome.scripting.CSSInjection = {
        target: { tabId: sourceTabId, allFrames: true },
        css: `[class*="overlay"] { mix-blend-mode: color-dodge !important; } /* NijiLucid viewer ${viewerId} */`,
      };
      await chrome.storage.session.set({ [`${PREFIX}${viewerId}`]: injection });
      try { await chrome.scripting.insertCSS(injection); }
      catch (error) { await cleanup(viewerId); throw error; }
    }).then(() => respond({ ok: true }), error => respond({ ok: false, error: String(error) }));
    return true;
  });
  chrome.tabs.onRemoved.addListener(viewerId => { void enqueue(() => cleanup(viewerId)).catch(() => undefined); });
  chrome.tabs.onUpdated.addListener((viewerId, change) => {
    if (change.status === 'loading') void enqueue(() => cleanup(viewerId)).catch(() => undefined);
  });
}
