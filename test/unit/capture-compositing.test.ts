import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURE_STYLE_MESSAGE, isCrunchyrollUrl, registerCaptureCompositing } from '../../src/features/capture-compositing';

let messageListener: (...args: any[]) => unknown;
let removedListener: (id: number) => void;
let updatedListener: (id: number, change: { status: string }) => void;
let records: Record<string, unknown>;
let getTab: ReturnType<typeof vi.fn>;
let insertCSS: ReturnType<typeof vi.fn>;
let removeCSS: ReturnType<typeof vi.fn>;
const viewer = { tab: { id: 30 }, url: 'chrome-extension://test/capture.html?source=12' };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const send = (enabled: boolean, sender = viewer) => new Promise<any>(resolve => {
  messageListener({ type: CAPTURE_STYLE_MESSAGE, enabled }, sender, resolve);
});

beforeEach(() => {
  records = {};
  getTab = vi.fn().mockResolvedValue({ url: 'https://www.crunchyroll.com/watch/example' });
  insertCSS = vi.fn().mockResolvedValue(undefined);
  removeCSS = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      onMessage: { addListener: (listener: typeof messageListener) => { messageListener = listener; } },
    },
    tabs: {
      get: getTab,
      onRemoved: { addListener: (listener: typeof removedListener) => { removedListener = listener; } },
      onUpdated: { addListener: (listener: typeof updatedListener) => { updatedListener = listener; } },
    },
    scripting: { insertCSS, removeCSS },
    storage: { session: {
      get: async (key: string) => ({ [key]: records[key] }),
      set: async (values: Record<string, unknown>) => { Object.assign(records, values); },
      remove: async (key: string) => { delete records[key]; },
    } },
  });
  registerCaptureCompositing();
});
afterEach(() => vi.unstubAllGlobals());

describe('experimental compositing ownership', () => {
  it('only accepts messages from the packaged viewer', () => {
    const respond = vi.fn();
    expect(messageListener({ type: CAPTURE_STYLE_MESSAGE, enabled: true },
      { ...viewer, url: 'https://www.crunchyroll.com/capture.html?source=12' }, respond)).toBeUndefined();
    expect(insertCSS).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });

  it('cleans up a stopped session with exactly its original injection', async () => {
    expect(await send(true)).toEqual({ ok: true });
    expect(insertCSS).toHaveBeenCalledWith({
      target: { tabId: 12, allFrames: true }, css: expect.stringContaining('mix-blend-mode: color-dodge'),
    });
    expect(await send(false)).toEqual({ ok: true });
    expect(removeCSS).toHaveBeenCalledWith(insertCSS.mock.calls[0][0]);
    expect(records).toEqual({});
  });

  it('uses persisted ownership when a viewer closes after worker restart', async () => {
    await send(true);
    registerCaptureCompositing();
    removedListener(30);
    await flush();
    expect(removeCSS).toHaveBeenCalledOnce();
    expect(records).toEqual({});
  });

  it('removes the experiment when the viewer navigates away', async () => {
    await send(true);
    updatedListener(30, { status: 'loading' });
    await flush();
    expect(removeCSS).toHaveBeenCalledOnce();
  });

  it('cleans up partial injection failures and reports them', async () => {
    insertCSS.mockRejectedValue(new Error('Frame unavailable'));
    expect(await send(true)).toMatchObject({ ok: false, error: expect.stringContaining('Frame unavailable') });
    expect(removeCSS).toHaveBeenCalledOnce();
    expect(records).toEqual({});
  });

  it('does not apply the Crunchyroll experiment to HIDIVE', async () => {
    getTab.mockResolvedValue({ url: 'https://www.hidive.com/video/example' });
    expect(await send(true)).toMatchObject({ ok: false });
    expect(insertCSS).not.toHaveBeenCalled();
  });
});

describe('Crunchyroll host matching', () => {
  it.each(['https://crunchyroll.com/watch/1', 'https://www.crunchyroll.com/watch/1'])('accepts %s', url => {
    expect(isCrunchyrollUrl(url)).toBe(true);
  });
  it.each(['https://crunchyroll.com.evil.test', 'https://evilcrunchyroll.com', 'http://crunchyroll.com', 'invalid'])('rejects %s', url => {
    expect(isCrunchyrollUrl(url)).toBe(false);
  });
});
