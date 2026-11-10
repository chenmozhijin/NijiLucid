# NijiLucid

[中文](./README.md) | English | [日本語](./README.ja.md) | [Русский](./README.ru.md)

[![Edge Store Users](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fffopffngebibpmeodlhhkdlaejnmdlam&query=%24.activeInstallCount&style=flat-square&label=Edge%20Users)](https://microsoftedge.microsoft.com/addons/detail/ffopffngebibpmeodlhhkdlaejnmdlam) [![Chrome Web Store Users](https://img.shields.io/chrome-web-store/users/hpmbccepehpoanjpjkamfdpdkbmfmhek?style=flat-square&label=Chrome%20Users)](https://chromewebstore.google.com/detail/hpmbccepehpoanjpjkamfdpdkbmfmhek) [![Mozilla Add-on Users](https://img.shields.io/amo/users/nijilucid?style=flat-square&label=Firefox%20Users)](https://addons.mozilla.org/firefox/addon/nijilucid/) [![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/chenmozhijin/NijiLucid/total?style=flat-square&label=GitHub%20Downloads)](https://github.com/chenmozhijin/NijiLucid/releases/latest)

NijiLucid uses WebGPU to enhance anime video quality in real time, delivering a clearer and sharper visual experience frame by frame!

## Features

- 🚀 **Real-time Super-Resolution:** Leverage advanced WebGPU technology to achieve low-latency, high-performance real-time video super-resolution enhancement directly in the browser.
- ⚡ **Multiple Performance Tiers:** Offers four performance tiers: Fast/Balanced/Quality/Ultra, and supports Custom Modes to flexibly balance image quality improvement and hardware load.
- 🧪 **Advanced Custom Effects:** Freely combine multiple enhancement effects to create a visual style that suits your preferences; Recommended Presets automatically adjust their effect configuration for the selected performance tier.
- 📊 **Hardware Performance Evaluation:** Built-in GPU benchmark test to recommend the best super-resolution tier for your hardware.
- 📏 **Flexible Resolution Control:** Supports 2x/4x/8x upscaling factors, or can lock to target resolutions like 2K/4K to meet diverse viewing needs.
- ✨ **One-Click Enhance:** A purple "✨ Enhance" button automatically appears on the video player for one-click image quality boost.
- 🛡️ **Broad Compatibility:** Supports regular DOM structures, open Shadow DOM, and iframes; when cross-origin video loading fails, try enabling Cross-Origin Compatibility Mode.
- 📋 **On-Demand Activation Mechanism:** Supports precise Whitelist strategy, effective only on specified sites to avoid resource waste and page interference.
- 🌈 **Modern UI Design:** Follows Material Design guidelines, adapting to Light/Dark/System themes for a comfortable and smooth visual experience.
- 🌐 **Internationalization Support:** Supports multiple languages including Chinese, English, Japanese, and Russian to serve global users.

> [!WARNING]
> Direct video enhancement does not support Encrypted Media Extensions (EME) or DRM-protected video. The experimental capture viewer below can only enhance pixels the browser makes available; protected video may still be black.

### Experimental capture viewer (Chrome / Edge)

Open the extension popup **on the playing source tab**, then choose **Experimental capture viewer** and **Start capture**. The viewer uses the saved enhancement mode, performance tier, and resolution. Keep the source playing and use its theater mode where available. Disable any NijiLucid enhancement overlay in the source tab first.

The enhanced picture appears in a separate tab so it cannot be captured recursively. **Show unprocessed capture** compares the incoming picture with the enhancement; **Fullscreen** expands the viewer. Audio remains in the source tab. Stop capture or close the viewer to release the stream and GPU resources. No video is recorded or uploaded.

Capture includes the entire tab viewport, including controls, subtitles, and letterboxing. Its resolution is the captured viewport rather than the original encoded video. Settings changes take effect on the next capture start. Navigation can revoke the source tab grant; reopen the popup on the source if capture is denied. Firefox does not expose this feature or request its capture permissions.

For Crunchyroll only, an opt-in checkbox tries the overlay `mix-blend-mode` CSS reported in [issue #4](https://github.com/chenmozhijin/NijiLucid/issues/4). This compositing experiment may change colors; it does not decrypt video or make protected video elements readable by WebGPU. The CSS is removed on Stop, viewer navigation, or viewer closure. The report is not evidence of compatibility with HIDIVE or other services. Verify both the raw capture and enhanced playback on the intended browser/site before claiming support.

## User Guide

### Install the Extension

#### From App Store (Recommended)

- [![GitHub Release](https://img.shields.io/github/v/release/chenmozhijin/NijiLucid?style=flat-square&label=Latest%20Version)](https://github.com/chenmozhijin/NijiLucid/releases/latest)
- [![Edge Store Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fffopffngebibpmeodlhhkdlaejnmdlam&query=%24.version&style=flat-square&label=Edge%20Add-ons)](https://microsoftedge.microsoft.com/addons/detail/ffopffngebibpmeodlhhkdlaejnmdlam)
- [![Chrome Web Store Version](https://img.shields.io/chrome-web-store/v/hpmbccepehpoanjpjkamfdpdkbmfmhek?style=flat-square&label=Chrome%20Web%20Store)](https://chromewebstore.google.com/detail/hpmbccepehpoanjpjkamfdpdkbmfmhek)
- [![Mozilla Add-on Version](https://img.shields.io/amo/v/nijilucid?style=flat-square&label=Firefox%20Add-on)](https://addons.mozilla.org/firefox/addon/nijilucid/)

> [!NOTE]
>
> 1. Click the badges above to go to the store page.
> 2. Due to the review process, the version in the store may not be the latest. For the latest version, please use the pre-built package or build from source.

#### Using Pre-built Packages

1. Go to [GitHub Releases](https://github.com/chenmozhijin/NijiLucid/releases/latest)
2. Under "Assets", download the latest extension package:
   - Chrome/Edge: `nijilucid.zip`
   - Firefox: `nijilucid-firefox.zip`
3. Unzip the downloaded file
4. Load the unpacked extension in your browser:
   - Chrome: Open extensions page (`chrome://extensions`) → Enable "Developer mode" → "Load unpacked" → Select the unzipped directory
   - Edge: Open extensions page (`edge://extensions`) → Enable "Developer mode" → "Load unpacked" → Select the unzipped directory
   - Firefox: Open `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `manifest.json` from the unzipped directory

#### From Source Code

1. Clone this repository
2. Run `npm install` to install dependencies
3. Build for your browser:
   - Chrome/Edge: Run `npm run build:chrome`
   - Firefox: Run `npm run build:firefox`
4. Load the built extension in your browser:
   - Chrome/Edge: Open the extensions page (`chrome://extensions` or `edge://extensions`) → enable Developer mode → Load unpacked → select the `dist-chrome` directory
   - Firefox: Open `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `dist-firefox/manifest.json`

### I. First Run (Onboarding)

After installing the extension, an onboarding page will automatically open. For the best experience, please follow the guide to complete the setup:

1.  **GPU Benchmark**: The extension will run a short benchmark (Target: 1080p -> 4K 24fps) to evaluate your graphics card performance.
2.  **Recommended Tier**: Based on the results, the extension will automatically recommend a suitable Performance Tier:
    *   🚀 **Fast**: Best for integrated graphics or older devices, prioritizing smoothness.
    *   ⚖️ **Balanced**: Balances quality and performance, suitable for most mid-range devices.
    *   🎨 **Quality**: Provides better image detail, suitable for discrete graphics cards.
    *   🔬 **Ultra**: Maximum quality, requires strong graphics card performance.
3.  **Apply**: You can accept the recommendation or manually select another tier.

### II. Daily Use

1.  **Enable Enhancement**: Play a video on a supported website (e.g., Bilibili, YouTube).
2.  **Click to Toggle**: Hover over the left-center area of the video player to reveal the purple **"✨ Enhance"** button. Click it to turn super-resolution on or off. While starting, the button shows "⏳ Starting..."; after it is enabled, it shows "❌ Cancel".
3.  **Auto-hide**: The button automatically hides after the pointer leaves the left-center area or the button to keep the video unobstructed.

#### Firefox Permissions and Usage

Firefox users are encouraged to enable **"Access your data for all websites"** on the extension's **Permissions & Data** page. Once enabled, NijiLucid can be used directly on supported video websites without manually activating each site.

If you do not want to enable access for all websites, you can use NijiLucid on demand:

1. Open the webpage containing the video.
2. Click the NijiLucid extension icon in the Firefox toolbar to activate the current webpage.
3. To keep NijiLucid authorized on the current website, right-click the extension icon and use the menu to allow continued access on that website.
4. Repeat these steps when switching to another website that has not been authorized.

### III. Popup Panel Settings

Click the NijiLucid extension icon in the browser toolbar to open the quick settings panel:

*   **Performance Tier**: Quickly switch between four performance tiers.
    *   *Note: When a "Custom Mode" is selected, the Performance Tier is unavailable because custom modes are defined by their specific effect combinations.*
*   **Enhancement Mode**:
    *   **Built-in Modes**: Includes three Recommended Presets and six Compatibility Modes.
    *   **Recommended Presets**: Detail Preserving, Compression Cleanup, and Soft Style; their effect configuration adjusts for the selected performance tier.
    *   **Compatibility Modes**: Mode A, Mode B, Mode C, Mode A+A, Mode B+B, and Mode C+A.
    *   **Custom Modes**: Modes created or imported by you, with freely combinable effects.
*   **Resolution**: Choose x2, x4, or x8 scaling, or fixed 720p, 1080p, 2K (1440p), and 4K (2160p) target resolutions. Fixed target resolutions preserve the source video aspect ratio; Native uses the original resolution without upscaling, but does not turn enhancement off.
*   **Whitelist**:
    *   Quickly add the current page, domain, or parent path to the whitelist.
    *   Enable/disable the global whitelist feature.

### IV. Advanced Options

Click the **"Settings"** button at the bottom of the panel to access the detailed settings page:

#### 1. General Settings
*   **Appearance**: Switch between Light/Dark themes.
*   **Compatibility**: If a video cannot be enhanced because of browser security policies (common with nested third-party players), enable **"Cross-Origin Compatibility Mode"**. This mode attempts to fix cross-origin loading issues; refresh open pages after enabling it.

#### 2. Performance Settings
*   **GPU Benchmark**: Re-run the benchmark at any time to update your performance score.
*   **Current Tier**: View the currently active performance configuration.
*   **Performance Monitor**: Offers Off, Lite, and GPU Diagnostics modes. Lite shows overall frame performance; GPU Diagnostics shows per-effect GPU time when the browser supports GPU timestamp queries. The HUD can be collapsed, copied as a performance snapshot, repositioned, resized, or closed.

#### 3. Enhancement Modes
*   **Visual Editor**: Create brand new custom modes.
*   **Advanced Effects**: Add ArtCNN, ACNet, ARNet, CuNNy, and other effects manually in Custom Modes; Recommended Presets also use the corresponding effect configuration for the selected performance tier.
*   **Drag & Drop Sorting**: Adjust the order of applied effects or the mode list itself.
*   **Share Config**: Import/Export your custom mode configurations (JSON format).

#### 4. Whitelist Management
*   **Rule Management**: View, edit, or delete added URL rules.
*   **Wildcard Support**: Use `*` to match multiple pages (e.g., `*.bilibili.com/*`).
*   **Match Scope**: Whitelist rules match `hostname + pathname` only. Protocol, port, query, and hash are ignored. For example, `example.com/watch/*` matches `https://example.com:8443/watch/1?from=home`.


## Acknowledgments

- [bloc97/Anime4K](https://github.com/bloc97/Anime4K)
- [Anime4K-WebGPU](https://github.com/Anime4KWebBoost/Anime4K-WebGPU) (historical implementation reference)
- [ArtCNN](https://github.com/Artoriuz/ArtCNN)
- [ACNetGLSL](https://github.com/TianZerL/ACNetGLSL)
- [CuNNy](https://github.com/funnyplanter/CuNNy)

## License

The project core is licensed under MIT. The CuNNy generated components bundled
with the default extension package are licensed under LGPL-3.0-or-later; see
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for notices and
corresponding-source details.
