import { describe, expect, it, vi, afterEach } from 'vitest';
import { captureTab, CaptureSession } from '../../src/features/tab-capture';

afterEach(() => vi.unstubAllGlobals());

describe('capture session lifetime', () => {
  it('releases late acquisitions after stop and cleans up in reverse order once', () => {
    const session = new CaptureSession();
    const released: string[] = [];
    session.own(() => released.push('tracks'));
    session.own(() => released.push('renderer'));
    session.stop();
    session.stop();
    session.own(() => released.push('late renderer'));
    expect(released).toEqual(['renderer', 'tracks', 'late renderer']);
    expect(session.active).toBe(false);
  });

  it('still stops tracks if another resource fails to dispose', () => {
    const session = new CaptureSession();
    const stop = vi.fn();
    session.own(stop);
    session.own(() => { throw new Error('destroy failed'); });
    session.stop();
    expect(stop).toHaveBeenCalledOnce();
  });
});

describe('tab capture', () => {
  it('consumes a stream for the explicit source tab without capturing audio', async () => {
    const stream = {};
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const getMediaStreamId = vi.fn((_options, callback) => callback('one-use-id'));
    vi.stubGlobal('chrome', { tabCapture: { getMediaStreamId }, runtime: {} });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    expect(await captureTab(17)).toBe(stream);
    expect(getMediaStreamId).toHaveBeenCalledWith({ targetTabId: 17 }, expect.any(Function));
    expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: {
      mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: 'one-use-id' },
    } });
  });

  it('surfaces permission errors without attempting to acquire media', async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal('chrome', {
      tabCapture: { getMediaStreamId: (_options: unknown, callback: (id: string) => void) => callback('') },
      runtime: { lastError: { message: 'Extension has not been invoked for the current page.' } },
    });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    await expect(captureTab(17)).rejects.toThrow('Extension has not been invoked');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it.each([-1, NaN, 1.5, Infinity])('rejects invalid source %s', async id => {
    await expect(captureTab(id)).rejects.toThrow('Invalid source tab');
  });

  it('reports unsupported browsers', async () => {
    vi.stubGlobal('chrome', {});
    await expect(captureTab(1)).rejects.toThrow('Chrome or Edge');
  });
});
