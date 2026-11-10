import './capture.css';
import { captureTab, CaptureSession } from '../../features/tab-capture';
import { Renderer } from '../../core/renderer';
import { resolveRendererState } from '../../core/video-enhancer/render-state';
import { waitForMediaReady } from '../../core/media-wait';
import { getSettings } from '../../utils/settings';
import { CAPTURE_STYLE_MESSAGE, isCrunchyrollUrl } from '../../features/capture-compositing';

const sourceParam = new URL(location.href).searchParams.get('source');
const sourceTabId = sourceParam !== null && /^\d+$/.test(sourceParam) ? Number(sourceParam) : -1;
const start = document.getElementById('start') as HTMLButtonElement;
const stop = document.getElementById('stop') as HTMLButtonElement;
const fullscreen = document.getElementById('fullscreen') as HTMLButtonElement;
const original = document.getElementById('original') as HTMLInputElement;
const video = document.getElementById('video') as HTMLVideoElement;
const canvas = document.getElementById('output') as HTMLCanvasElement;
const status = document.getElementById('status')!;
const compositing = document.getElementById('compositing') as HTMLInputElement;
if (typeof chrome !== 'undefined' && sourceTabId >= 0) {
  void chrome.tabs.get(sourceTabId).then(tab => {
    document.getElementById('compositing-label')!.hidden = !isCrunchyrollUrl(tab.url || '');
  }).catch(() => undefined);
}
let session: CaptureSession | null = null;
let hasFrame = false;
let starting = false;

function updatePreview(): void {
  canvas.hidden = !hasFrame || original.checked;
  // Keep the media element alive for frame callbacks, even behind the canvas.
}

function stopCapture(message = 'Capture stopped.'): void {
  session?.stop();
  session = null;
  hasFrame = false;
  video.srcObject = null;
  updatePreview();
  start.disabled = starting;
  stop.disabled = true;
  fullscreen.disabled = true;
  compositing.disabled = false;
  status.textContent = message;
}

start.addEventListener('click', async () => {
  if (session || starting) return;
  starting = true;
  compositing.disabled = true;
  const current = new CaptureSession();
  session = current;
  start.disabled = true;
  stop.disabled = false;
  status.textContent = 'Starting capture…';
  try {
    if (!navigator.gpu) throw new Error('WebGPU is unavailable in this browser.');
    if (compositing.checked) {
      const result = await chrome.runtime.sendMessage({ type: CAPTURE_STYLE_MESSAGE, enabled: true });
      current.own(() => {
        void chrome.runtime.sendMessage({ type: CAPTURE_STYLE_MESSAGE, enabled: false }).catch(() => undefined);
      });
      if (!current.active) return;
      if (!result?.ok) throw new Error(result?.error || 'Could not apply experimental CSS.');
    }
    const stream = await captureTab(sourceTabId);
    current.own(() => stream.getTracks().forEach(track => track.stop()));
    if (!current.active) return;
    for (const track of stream.getVideoTracks()) {
      const ended = () => {
        if (session === current) stopCapture('Source capture ended.');
      };
      track.addEventListener('ended', ended);
      current.own(() => track.removeEventListener('ended', ended));
    }
    const abort = new AbortController();
    current.own(() => abort.abort());
    const timer = window.setTimeout(() => abort.abort(), 15000);
    current.own(() => clearTimeout(timer));
    video.srcObject = stream;
    await video.play();
    await waitForMediaReady(video, HTMLMediaElement.HAVE_FUTURE_DATA, { signal: abort.signal });
    clearTimeout(timer);
    if (!current.active) return;
    const settings = await getSettings();
    if (!current.active) return;
    const state = resolveRendererState(settings, { width: video.videoWidth, height: video.videoHeight });
    canvas.width = state.targetDimensions.width;
    canvas.height = state.targetDimensions.height;
    const renderer = await Renderer.create({
      video, canvas, ...state,
      performanceTier: settings.performanceTier,
      onError: error => {
        if (session === current) stopCapture(`Enhancement failed: ${error.message}`);
      },
      onFirstFrameRendered: () => {
        if (session !== current) return;
        hasFrame = true;
        updatePreview();
        status.textContent = 'Capturing. If the picture is black, compare the unprocessed capture; protected content may be unavailable.';
      },
    });
    current.own(() => renderer.destroy());
    if (!current.active) return;
    fullscreen.disabled = false;
    // A viewport change also changes the capture resolution. Reuse the same
    // settings, recomputing output dimensions instead of stretching old output.
    let resizeQueue = Promise.resolve();
    const resize = () => {
      resizeQueue = resizeQueue.then(async () => {
        if (!current.active || !video.videoWidth || !video.videoHeight) return;
        const sourceDimensions = { width: video.videoWidth, height: video.videoHeight };
        const next = resolveRendererState(settings, sourceDimensions);
        await renderer.updateConfiguration({ ...next, sourceDimensions });
      }).catch(error => {
        if (session === current) stopCapture(`Resize failed: ${String(error)}`);
      });
    };
    video.addEventListener('resize', resize);
    current.own(() => video.removeEventListener('resize', resize));
  } catch (error) {
    if (session === current) {
      stopCapture(`${error instanceof Error ? error.message : String(error)} Reopen the extension on the source tab to retry.`);
    }
  } finally {
    starting = false;
    start.disabled = session !== null;
  }
});
stop.addEventListener('click', () => stopCapture());
original.addEventListener('change', updatePreview);
document.getElementById('source')!.addEventListener('click', () => {
  chrome.tabs.update(sourceTabId, { active: true }).catch(error => { status.textContent = String(error); });
});
fullscreen.addEventListener('click', () => {
  document.getElementById('stage')!.requestFullscreen().catch(error => { status.textContent = String(error); });
});
window.addEventListener('pagehide', () => stopCapture());
