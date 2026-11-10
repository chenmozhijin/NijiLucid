/** The stream is consumed in the same extension frame that requests its ID. */
export async function captureTab(tabId: number): Promise<MediaStream> {
  if (!Number.isSafeInteger(tabId) || tabId < 0) {
    throw new Error('Invalid source tab. Reopen the viewer from the extension popup.');
  }
  if (!chrome.tabCapture?.getMediaStreamId) {
    throw new Error('Tab capture requires Chrome or Edge.');
  }
  const streamId = await new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, id => {
      const error = chrome.runtime.lastError;
      if (error || !id) reject(new Error(error?.message || 'No capture stream was returned.'));
      else resolve(id);
    });
  });
  // Video only: leave audio playing in the source tab, avoiding duplicate audio.
  const video = {
    mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
  } as unknown as MediaTrackConstraints;
  return navigator.mediaDevices.getUserMedia({ audio: false, video });
}

/** Own async startup resources, including resources acquired after Stop. */
export class CaptureSession {
  private cleanups: Array<() => void> = [];
  private stopped = false;
  public get active(): boolean { return !this.stopped; }
  public own(cleanup: () => void): void {
    if (this.stopped) cleanup();
    else this.cleanups.push(cleanup);
  }
  public stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const cleanup of this.cleanups.reverse()) {
      try { cleanup(); } catch { /* Continue releasing the remaining resources. */ }
    }
    this.cleanups = [];
  }
}
