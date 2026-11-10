import { getSettings, getLocalSettings } from './utils/settings';
import { ensureLatestConfig } from './utils/migration';
import { createLogger } from './utils/logger';
import type { LocalSettings } from './types';
import { compareExtensionVersions } from './utils/extension-version';
import { registerCaptureCompositing } from './features/capture-compositing';

const RULESET_ID = 'ruleset_1';
export const ONBOARDING_UPGRADE_VERSION = '0.5.0';
const logger = createLogger('background');

export type OnboardingMode = 'initial' | 'upgrade';

export type BackgroundBootstrapDeps = {
  chromeApi: typeof chrome;
  getSettings: typeof getSettings;
  getLocalSettings: typeof getLocalSettings;
  ensureLatestConfig: typeof ensureLatestConfig;
};

type ResolvedBackgroundBootstrapDeps = BackgroundBootstrapDeps;

export interface BackgroundBootstrap {
  updateDNRuleset(): Promise<void>;
  checkOnboarding(mode?: OnboardingMode): Promise<boolean>;
  checkBenchmarkCrash(): Promise<void>;
  registerListeners(): void;
  dispose(): void;
}

function resolveBackgroundDependencies(overrides: Partial<BackgroundBootstrapDeps> = {}): ResolvedBackgroundBootstrapDeps {
  return {
    chromeApi: chrome,
    getSettings,
    getLocalSettings,
    ensureLatestConfig,
    ...overrides,
  };
}

export function createBackgroundBootstrap(
  overrides: Partial<BackgroundBootstrapDeps> = {},
): BackgroundBootstrap {
  const deps = resolveBackgroundDependencies(overrides);
  const { chromeApi } = deps;
  let listenersRegistered = false;

  async function updateDNRuleset(): Promise<void> {
    const { enableCrossOriginFix } = await deps.getSettings();
    if (enableCrossOriginFix) {
      await chromeApi.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: [RULESET_ID],
      });
      logger.info('Cross-origin DNR ruleset enabled.');
    } else {
      await chromeApi.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: [RULESET_ID],
      });
      logger.info('Cross-origin DNR ruleset disabled.');
    }
  }

  async function openOnboarding(mode: OnboardingMode): Promise<void> {
    const onboardingUrl = new URL(chromeApi.runtime.getURL('onboarding.html'));
    if (mode === 'upgrade') {
      onboardingUrl.searchParams.set('mode', 'upgrade');
    }

    await chromeApi.tabs.create({ url: onboardingUrl.toString() });
  }

  async function checkOnboarding(mode: OnboardingMode = 'initial'): Promise<boolean> {
    if (mode === 'upgrade') {
      logger.info('Opening upgrade onboarding page.');
      await openOnboarding(mode);
      return true;
    }

    const local = await deps.getLocalSettings();

    if (!local.hasCompletedOnboarding) {
      logger.info('Opening onboarding page.');
      await openOnboarding(mode);
      return true;
    }

    return false;
  }

  function resolveOnboardingMode(details: chrome.runtime.InstalledDetails): OnboardingMode {
    if (details.reason !== 'update') {
      return 'initial';
    }

    const previousComparison = compareExtensionVersions(
      details.previousVersion,
      ONBOARDING_UPGRADE_VERSION,
    );
    const currentComparison = compareExtensionVersions(
      chromeApi.runtime.getManifest().version,
      ONBOARDING_UPGRADE_VERSION,
    );

    if (previousComparison === -1 && (currentComparison === 0 || currentComparison === 1)) {
      return 'upgrade';
    }

    return 'initial';
  }

  async function resetUpgradeBenchmarkState(): Promise<void> {
    await chromeApi.storage.local.set({
      gpuBenchmarkResult: null,
      benchmarkRunState: {
        status: 'idle',
        fallbackTierApplied: null,
      },
      _benchmarkInProgress: false,
    });
    await chromeApi.storage.local.remove('_benchmarkInProgress');
  }

  async function checkBenchmarkCrash(): Promise<void> {
    const local = await chromeApi.storage.local.get<Partial<LocalSettings> & { _benchmarkInProgress?: boolean }>([
      '_benchmarkInProgress',
      'benchmarkRunState',
    ]);
    const currentLocalSettings = await deps.getLocalSettings();
    const benchmarkRunState = local.benchmarkRunState ?? currentLocalSettings.benchmarkRunState;

    if (local._benchmarkInProgress || benchmarkRunState?.status === 'running') {
      logger.warn('Previous benchmark did not finish. Falling back to performance tier.');

      await chromeApi.storage.local.set({
        performanceTier: 'performance',
        benchmarkRunState: {
          status: 'interrupted',
          failureReason: 'crash',
          fallbackTierApplied: 'performance',
          startedAt: benchmarkRunState?.startedAt,
          endedAt: Date.now(),
        },
      });
      await chromeApi.storage.local.remove('_benchmarkInProgress');
    }
  }

  const onStartup = async () => {
    logger.info('Browser startup.');

    await checkBenchmarkCrash();
    await updateDNRuleset();
  };

  const onInstalled = async (details: chrome.runtime.InstalledDetails) => {
    logger.info('Extension installed/updated:', details.reason);

    const shouldCheckOnboarding = details.reason === 'install' || details.reason === 'update';
    let onboardingMode: OnboardingMode = 'initial';
    if (shouldCheckOnboarding) {
      try {
        onboardingMode = resolveOnboardingMode(details);
      } catch (error) {
        logger.error('Failed to resolve onboarding mode:', error);
      }
    }

    try {
      await deps.ensureLatestConfig();
    } catch (error) {
      logger.error('Failed to ensure latest config after install/update:', error);
    }

    if (onboardingMode === 'upgrade') {
      try {
        await resetUpgradeBenchmarkState();
      } catch (error) {
        logger.error('Failed to reset benchmark state for upgrade onboarding:', error);
      }
    }

    try {
      await checkBenchmarkCrash();
    } catch (error) {
      logger.error('Failed to check benchmark crash state after install/update:', error);
    }

    try {
      await updateDNRuleset();
    } catch (error) {
      logger.error('Failed to update DNR ruleset after install/update:', error);
    }

    if (shouldCheckOnboarding) {
      try {
        await checkOnboarding(onboardingMode);
      } catch (error) {
        logger.error('Failed to open onboarding page:', error);
      }
    }
  };

  const onTabUpdated = (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
      chromeApi.tabs.sendMessage(tabId, {
        type: 'URL_UPDATED',
        url: tab.url,
      }).catch(error => {
        if (!error.message.includes('Receiving end does not exist')) {
          logger.error(`Error sending URL_UPDATED message: ${error.message}`);
        }
      });
    }
  };

  const onMessage = (request: { type?: string }) => {
    if (request.type === 'SETTINGS_UPDATED') {
      logger.debug('Settings updated, checking DNR rules.');
      void updateDNRuleset();
    } else if (request.type === 'OPEN_OPTIONS_PAGE') {
      chromeApi.runtime.openOptionsPage();
    } else if (request.type === 'OPEN_ONBOARDING') {
      void openOnboarding('initial').catch(error => {
        logger.error('Failed to open onboarding page from message:', error);
      });
    }
  };

  function registerListeners(): void {
    if (listenersRegistered) {
      return;
    }

    listenersRegistered = true;
    chromeApi.runtime.onStartup.addListener(onStartup);
    chromeApi.runtime.onInstalled.addListener(onInstalled);
    chromeApi.tabs.onUpdated.addListener(onTabUpdated);
    chromeApi.runtime.onMessage.addListener(onMessage);
  }

  function dispose(): void {
    if (!listenersRegistered) {
      return;
    }

    listenersRegistered = false;
    chromeApi.runtime.onStartup.removeListener(onStartup);
    chromeApi.runtime.onInstalled.removeListener(onInstalled);
    chromeApi.tabs.onUpdated.removeListener(onTabUpdated);
    chromeApi.runtime.onMessage.removeListener(onMessage);
  }

  return {
    updateDNRuleset,
    checkOnboarding,
    checkBenchmarkCrash,
    registerListeners,
    dispose,
  };
}

let defaultBackgroundBootstrap: BackgroundBootstrap | null = null;

function getDefaultBackgroundBootstrap(): BackgroundBootstrap {
  defaultBackgroundBootstrap ??= createBackgroundBootstrap();
  return defaultBackgroundBootstrap;
}

/**
 * 根据当前设置更新 declarativeNetRequest 规则集。
 */
export async function updateDNRuleset(): Promise<void> {
  await getDefaultBackgroundBootstrap().updateDNRuleset();
}

/**
 * 检查是否需要打开引导页面
 */
export async function checkOnboarding(mode: OnboardingMode = 'initial'): Promise<boolean> {
  return getDefaultBackgroundBootstrap().checkOnboarding(mode);
}

/**
 * 检查上次测试是否崩溃
 */
export async function checkBenchmarkCrash(): Promise<void> {
  await getDefaultBackgroundBootstrap().checkBenchmarkCrash();
}

export function registerBackgroundListeners(): void {
  getDefaultBackgroundBootstrap().registerListeners();
}

export function resetBackgroundBootstrapForTests(): void {
  defaultBackgroundBootstrap?.dispose();
  defaultBackgroundBootstrap = null;
}

if (!globalThis.__NIJILUCID_DISABLE_AUTO_BOOTSTRAP__) {
  registerBackgroundListeners();
  if (typeof chrome.tabCapture?.getMediaStreamId === 'function') registerCaptureCompositing();
}
