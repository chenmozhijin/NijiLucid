import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ capture: vi.fn(), create: vi.fn(), settings: vi.fn() }));
vi.mock('../../src/features/tab-capture', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/features/tab-capture')>(),
  captureTab: mocks.capture,
}));
vi.mock('../../src/core/renderer', () => ({ Renderer: { create: mocks.create } }));
vi.mock('../../src/utils/settings', () => ({ getSettings: mocks.settings }));
vi.mock('../../src/core/media-wait', () => ({ waitForMediaReady: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/core/video-enhancer/render-state', () => ({
  resolveRendererState: () => ({ effects: [], effectsSignature: 'test', targetDimensions: { width: 1280, height: 720 } }),
}));

const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

beforeEach(() => {
  document.body.innerHTML = readFileSync(resolve('src/ui/capture/capture.html'), 'utf8');
  vi.stubGlobal('navigator', { gpu: {} });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  mocks.settings.mockResolvedValue({ performanceTier: 'balanced' });
});
afterEach(() => {
  button('stop')?.click();
  vi.unstubAllGlobals();
});

describe('capture viewer', () => {
  it('releases a stream arriving after Stop and prevents overlapping startup', async () => {
    let resolveStream!: (stream: unknown) => void;
    mocks.capture.mockReturnValue(new Promise(resolve => { resolveStream = resolve; }));
    await import('../../src/ui/capture/capture');
    button('start').click();
    button('stop').click();
    expect(button('start').disabled).toBe(true);
    const stopTrack = vi.fn();
    resolveStream({ getTracks: () => [{ stop: stopTrack }] });
    await flush();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(button('start').disabled).toBe(false);
  });

  it('reports capture failure and allows retry', async () => {
    mocks.capture.mockRejectedValue(new Error('Permission denied'));
    await import('../../src/ui/capture/capture');
    button('start').click();
    await flush();
    expect(document.getElementById('status')!.textContent).toContain('Permission denied');
    expect(button('start').disabled).toBe(false);
    expect(button('stop').disabled).toBe(true);
  });

  it('renders separately, toggles the raw preview, and disposes on source end', async () => {
    const track = Object.assign(new EventTarget(), { stop: vi.fn() });
    mocks.capture.mockResolvedValue({ getTracks: () => [track], getVideoTracks: () => [track] });
    const renderer = { destroy: vi.fn(), updateConfiguration: vi.fn().mockResolvedValue(undefined) };
    mocks.create.mockImplementation(async options => {
      options.onFirstFrameRendered();
      return renderer;
    });
    await import('../../src/ui/capture/capture');
    button('start').click();
    await flush();
    expect(button('fullscreen').disabled).toBe(false);
    const canvas = document.getElementById('output')!;
    expect(canvas.hidden).toBe(false);
    (document.getElementById('original') as HTMLInputElement).click();
    expect(canvas.hidden).toBe(true);
    track.dispatchEvent(new Event('ended'));
    expect(track.stop).toHaveBeenCalledOnce();
    expect(renderer.destroy).toHaveBeenCalledOnce();
    expect((document.getElementById('video') as HTMLVideoElement).srcObject).toBeNull();
    expect(button('start').disabled).toBe(false);
  });
});
