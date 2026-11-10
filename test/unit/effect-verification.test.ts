import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acnetGeneratedModelMetas } from '../../src/engines/acnet/generated/models';
import { acnetGeneratedReferenceModelMetas } from '../../src/engines/acnet/generated/reference-models';
import { cunnyEffectDescriptors } from '../../src/engines/cunny/catalog';
import { cunnyGeneratedModelMetas } from '../../src/engines/cunny/generated/models';
import { cunnyGeneratedReferenceModelMetas } from '../../src/engines/cunny/generated/reference-models';

const require = createRequire(import.meta.url);
const { createBuiltInFixtures } = require('../../scripts/verify/lib/fixtures');
const {
  anime4kReferenceShaders,
  artcnnReferenceShaders,
  generatedBackendSourceMeta,
  rawLumaCompare,
  rawRgbaCompare,
  staticBackendSourceMeta,
} = require('../../scripts/verify/lib/effect-source-meta');
const { createManifest, readCatalogDescriptors, repoRoot } = require('../../scripts/verify/lib/manifest');
const { decodePng, encodePng } = require('../../scripts/verify/lib/png');
const { startStaticServer } = require('../../scripts/verify/lib/static-server');
const {
  applyShard,
  createCaseList,
  createReferenceCacheKey,
  createSummaryPayload,
  filterFixtures,
  isCandidateTimeoutError,
  parseArgs: parseVerifyEffectsArgs,
} = require('../../scripts/verify-effects');
const {
  loadReport,
  parseArgs: parseVerifyReportArgs,
  renderMarkdown,
} = require('../../scripts/verify-report');
const {
  parseArgs: parseProductionBundleArgs,
  scanProductionBundle,
} = require('../../scripts/check-production-bundle');

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function makePngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  return chunk;
}

function makeUnsupported16BitPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 16;
  ihdr[9] = 6;
  return Buffer.concat([
    pngSignature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function writeMinimalProductionManifest(dist: string): void {
  writeFileSync(join(dist, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: 'test',
    version: '0.0.0',
    permissions: [
      'activeTab',
      'tabCapture',
      'storage',
      'tabs',
      'scripting',
      'declarativeNetRequest',
      'declarativeNetRequestWithHostAccess',
    ],
    host_permissions: ['<all_urls>'],
    content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }],
    web_accessible_resources: [{ resources: ['*.js'], matches: ['<all_urls>'] }],
    declarative_net_request: {
      rule_resources: [{ id: 'ruleset_1', enabled: false, path: 'rules.json' }],
    },
  }));
}

describe('effect verification tooling', () => {
  it('registers all currently implemented reference effects', () => {
    const manifest = createManifest();
    expect(manifest.filter((effect: any) => effect.backendId === 'anime4k')).toHaveLength(19);
    expect(manifest.filter((effect: any) => effect.backendId === 'artcnn')).toHaveLength(6);
    expect(manifest.filter((effect: any) => effect.backendId === 'acnet')).toHaveLength(33);
    expect(manifest.filter((effect: any) => effect.backendId === 'cunny')).toHaveLength(18);
    expect(new Set(manifest.map((effect: any) => effect.id)).size).toBe(manifest.length);
  });

  it('centralizes reference paths and raw tolerance in effect source metadata', () => {
    expect(anime4kReferenceShaders.size).toBe(19);
    expect(artcnnReferenceShaders.size).toBe(6);
    expect(staticBackendSourceMeta.anime4k.verification.compare).toBe(rawRgbaCompare);
    expect(staticBackendSourceMeta.artcnn.verification.compare).toBe(rawLumaCompare);
    expect(generatedBackendSourceMeta.acnet.verification.compare).toBe(rawLumaCompare);
    expect(generatedBackendSourceMeta.cunny.verification.compare).toBe(rawLumaCompare);
    expect(generatedBackendSourceMeta.cunny.verification.referenceTimeoutMs).toBeGreaterThan(
      generatedBackendSourceMeta.acnet.verification.referenceTimeoutMs,
    );
  });

  it('derives Anime4K and ArtCNN verify metadata from production descriptors', () => {
    const manifest = createManifest();
    const byId = new Map<string, any>(manifest.map((effect: any) => [effect.id, effect]));
    const descriptors: any[] = [
      ...readCatalogDescriptors('src/engines/anime4k/catalog.ts', 'anime4kEffectDescriptors'),
      ...readCatalogDescriptors('src/engines/artcnn/catalog.ts', 'artcnnEffectDescriptors'),
    ];

    for (const descriptor of descriptors) {
      const effect: any = byId.get(descriptor.id);
      expect(effect, descriptor.id).toBeTruthy();
      expect(effect.backendId).toBe(descriptor.backendId);
      expect(effect.key).toBe(descriptor.key);
      const expectedScale = descriptor.dimensionBehavior.kind === 'scale'
        ? descriptor.dimensionBehavior.scale ?? 1
        : 1;
      expect(effect.expectedScale).toBe(expectedScale);
    }
  });

  it('derives ACNet and CuNNy verify metadata from generated production metadata', () => {
    const manifest = createManifest();
    const byId = new Map<string, any>(manifest.map((effect: any) => [effect.id, effect]));

    const acnetReferencesByKey = new Map(acnetGeneratedReferenceModelMetas.map(model => [model.key, model]));
    for (const model of acnetGeneratedModelMetas) {
      const reference = acnetReferencesByKey.get(model.key);
      const effect: any = byId.get(model.id);
      expect(reference, model.key).toBeTruthy();
      expect(effect, model.id).toBeTruthy();
      expect(effect.backendId).toBe('acnet');
      expect(effect.key).toBe(model.key);
      expect(effect.referenceShader).toBe(reference?.sourceFile);
      expect(effect.expectedScale).toBe(2);
    }

    const cunnyReferencesByKey = new Map(cunnyGeneratedReferenceModelMetas.map(model => [model.key, model]));
    for (const model of cunnyGeneratedModelMetas) {
      const reference = cunnyReferencesByKey.get(model.key);
      const effect: any = byId.get(model.id);
      expect(reference, model.key).toBeTruthy();
      expect(effect, model.id).toBeTruthy();
      expect(effect.backendId).toBe('cunny');
      expect(effect.key).toBe(model.key);
      expect(effect.referenceShader).toBe(reference?.sourceFile);
      expect(effect.expectedScale).toBe(2);
    }
  });

  it('keeps CuNNy descriptor license metadata while verify uses reference-only source paths', () => {
    const manifest = createManifest();
    const byId = new Map<string, any>(manifest.map((effect: any) => [effect.id, effect]));

    for (const descriptor of cunnyEffectDescriptors) {
      const effect: any = byId.get(descriptor.id);
      expect(descriptor.license?.expression, descriptor.id).toBe('LGPL-3.0-or-later');
      expect(descriptor.license?.componentName, descriptor.id).toBe('CuNNy');
      expect(effect, descriptor.id).toBeTruthy();
      expect(effect.referenceShader, descriptor.id).toMatch(/^\.reference\/CuNNy\/mpv\//);
    }
  });

  it('points every manifest entry at an existing GLSL reference', () => {
    const manifest = createManifest();
    for (const effect of manifest) {
      expect(existsSync(`${repoRoot}/${effect.referenceShader}`), effect.id).toBe(true);
    }
  });

  it('marks manifest entries for strict raw math validation', () => {
    const manifest = createManifest();
    expect(new Set(manifest.map((effect: any) => effect.validationMode))).toEqual(new Set(['luma-math', 'rgb-math']));

    const lumaEffects = manifest.filter((effect: any) => ['acnet', 'artcnn', 'cunny'].includes(effect.backendId));
    expect(lumaEffects.length).toBeGreaterThan(0);
    for (const effect of lumaEffects) {
      expect(effect.validationMode, effect.id).toBe('luma-math');
      expect(effect.referenceTimeoutMs, effect.id).toBeGreaterThanOrEqual(180_000);
      expect(effect.compare.channels, effect.id).toBe('luma');
      expect(effect.compare.checkAlpha, effect.id).toBe(false);
    }

    const anime4kEffects = manifest.filter((effect: any) => effect.backendId === 'anime4k');
    for (const effect of anime4kEffects) {
      expect(effect.validationMode, effect.id).toBe('rgb-math');
      expect(effect.outputMode, effect.id).toBe('rgba');
      expect(effect.compare.channels, effect.id).toBe('rgba');
    }
  });

  it('round-trips built-in fixture PNGs', () => {
    const [fixture] = createBuiltInFixtures();
    const decoded = decodePng(encodePng(fixture));
    expect(decoded.width).toBe(fixture.width);
    expect(decoded.height).toBe(fixture.height);
    expect(Array.from(decoded.rgba.slice(0, 64))).toEqual(Array.from(fixture.rgba.slice(0, 64)));
  });

  it('rejects 16-bit PNG fixtures instead of silently truncating them', () => {
    expect(() => decodePng(makeUnsupported16BitPng())).toThrow(/bitDepth=16/);
  });

  it('keeps the verify static server inside its root directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-static-root-'));
    try {
      const publicDir = join(root, 'public');
      mkdirSync(publicDir);
      writeFileSync(join(publicDir, 'index.html'), 'ok');
      writeFileSync(join(root, 'outside.txt'), 'nope');
      const server = await startStaticServer(publicDir);
      try {
        const ok = await fetch(server.url);
        expect(ok.status).toBe(200);
        expect(await ok.text()).toBe('ok');

        const escaped = await fetch(`${server.url}/..%2Foutside.txt`);
        expect(escaped.status).toBe(403);
      } finally {
        await server.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps alpha-semantics fixtures diagnostic unless explicitly selected', () => {
    const fixtures = createBuiltInFixtures();
    const fixtureIds = fixtures.map((fixture: any) => fixture.id);
    expect(fixtureIds).toContain('deterministic_noise');
    expect(fixtureIds).toContain('deterministic_noise_alpha');

    const defaultFixtures = filterFixtures(fixtures, { fixture: null, fixtureExact: false });
    expect(defaultFixtures.map((fixture: any) => fixture.id)).toContain('deterministic_noise');
    expect(defaultFixtures.map((fixture: any) => fixture.id)).not.toContain('deterministic_noise_alpha');

    const explicitFixtures = filterFixtures(fixtures, {
      fixture: 'deterministic_noise_alpha',
      fixtureExact: true,
    });
    expect(explicitFixtures.map((fixture: any) => fixture.id)).toEqual(['deterministic_noise_alpha']);
  });

  it('parses long-run verification options', () => {
    const args = parseVerifyEffectsArgs([
      '--filter', 'artcnn',
      '--fixture=checker_edges',
      '--fixture-exact',
      '--keep-artifacts',
      '--case-timeout-ms', '12345',
      '--browser-recycle-every=1',
      '--shard', '2/3',
      '--no-build',
      '--no-reference-cache',
      '--run-id=baseline-2026-07-03',
      '--output=test-results/verify/effects/custom-summary.json',
    ]);
    expect(args.filter).toBe('artcnn');
    expect(args.fixture).toBe('checker_edges');
    expect(args.fixtureExact).toBe(true);
    expect(args.keepArtifacts).toBe(true);
    expect(args.caseTimeoutMs).toBe(12345);
    expect(args.browserRecycleEvery).toBe(1);
    expect(args.shard).toEqual({ index: 2, count: 3 });
    expect(args.noBuild).toBe(true);
    expect(args.referenceCache).toBe(false);
    expect(args.runId).toBe('baseline-2026-07-03');
    expect(args.output).toBe(resolve(repoRoot, 'test-results/verify/effects/custom-summary.json'));
  });

  it('keys reference cache by shader, runner, input, dimensions, and scale', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-reference-cache-'));
    try {
      const shaderPath = join(root, 'shader.glsl');
      const runnerPath = join(root, 'runner.exe');
      const inputAPath = join(root, 'input-a.f32');
      const inputBPath = join(root, 'input-b.f32');
      writeFileSync(shaderPath, '//!HOOK LUMA\nvec4 hook(){return vec4(0.0);}\n');
      writeFileSync(runnerPath, 'runner-v1');
      writeFileSync(inputAPath, Buffer.from([0, 0, 0, 0]));
      writeFileSync(inputBPath, Buffer.from([1, 0, 0, 0]));

      const effect = {
        validationMode: 'luma-math',
        outputMode: 'luma',
        referenceShader: shaderPath,
        expectedScale: 2,
      };
      const fixture = { width: 16, height: 8 };
      const keyA = createReferenceCacheKey({
        mode: 'luma',
        effect,
        fixture,
        inputPath: inputAPath,
        runnerPath,
      });
      const keyARepeat = createReferenceCacheKey({
        mode: 'luma',
        effect,
        fixture,
        inputPath: inputAPath,
        runnerPath,
      });
      const keyB = createReferenceCacheKey({
        mode: 'luma',
        effect,
        fixture,
        inputPath: inputBPath,
        runnerPath,
      });

      expect(keyA).toBe(keyARepeat);
      expect(keyA).not.toBe(keyB);
      expect(keyA).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('parses aggregate report hygiene options', () => {
    const args = parseVerifyReportArgs([
      '--format=json',
      '--run-id', '2026-07-03T00-00-00-000Z',
      '--include-diagnostic',
    ]);
    expect(args.format).toBe('json');
    expect(args.runId).toBe('2026-07-03T00-00-00-000Z');
    expect(args.includeDiagnostic).toBe(true);
  });

  it('parses production bundle scan dist options', () => {
    expect(parseProductionBundleArgs([]).distDirs).toEqual(['dist-chrome', 'dist-firefox']);
    expect(parseProductionBundleArgs(['--dist', 'dist-chrome']).distDirs).toEqual(['dist-chrome']);
    expect(parseProductionBundleArgs(['--dist=dist-firefox']).distDirs).toEqual(['dist-firefox']);
  });

  it('keeps release software gates in the CI aggregate command', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    expect(packageJson.scripts['test:ci']).toContain('npm run test:coverage');
    expect(packageJson.scripts['test:ci']).toContain('npm run build:chrome');
    expect(packageJson.scripts['test:ci']).toContain('npm run build:firefox');
    expect(packageJson.scripts['test:ci']).toContain('npm run check:production-bundle');
    expect(packageJson.scripts['test:ci']).toContain('npm run check:release-version');
  });

  it('fails production bundle scans when verify-only strings leak into assets', () => {
      const root = mkdtempSync(join(tmpdir(), 'verify-bundle-scan-'));
    try {
      const dist = join(root, 'dist');
      mkdirSync(dist);
      writeMinimalProductionManifest(dist);
      writeFileSync(join(dist, 'runtime.js'), 'window.__runEffectVerification = true;');

      const result = scanProductionBundle({ distDirs: [dist] });
      expect(result.findings).toEqual([{
        file: expect.stringContaining('runtime.js'),
        token: '__runEffectVerification',
      }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores notice files during production bundle scans', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-bundle-scan-notice-'));
    try {
      const dist = join(root, 'dist');
      mkdirSync(dist);
      writeMinimalProductionManifest(dist);
      writeFileSync(join(dist, 'background.js'), 'console.log("ok");');
      writeFileSync(join(dist, 'THIRD_PARTY_NOTICES.md'), 'libplacebo and .reference/CuNNy are mentioned here.');

      const result = scanProductionBundle({ distDirs: [dist] });
      expect(result.findings).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects stale verification options instead of silently ignoring them', () => {
    expect(() => parseVerifyEffectsArgs(['--removed-option'])).toThrow(/Unknown verify:effects option/);
  });

  it('classifies candidate timeout errors for page recycling', () => {
    expect(isCandidateTimeoutError(new Error('candidate acnet/Upscale/F8B4 / checker_edges timed out after 1000ms.'))).toBe(true);
    expect(isCandidateTimeoutError(new Error('libplacebo LUMA reference failed.'))).toBe(false);
    expect(isCandidateTimeoutError('candidate timed out after 1000ms.')).toBe(false);
  });

  it('splits verification cases into stable non-overlapping shards', () => {
    const manifest = createManifest().slice(0, 5);
    const fixtures = createBuiltInFixtures().slice(0, 2);
    const allCases = createCaseList(manifest, fixtures);
    const shard1 = applyShard(allCases, { index: 1, count: 2 });
    const shard2 = applyShard(allCases, { index: 2, count: 2 });
    const key = (testCase: any) => `${testCase.effect.id}/${testCase.fixture.id}`;
    const combined = [...shard1, ...shard2].map(key).sort();

    expect(new Set(shard1.map(key)).size).toBe(shard1.length);
    expect(new Set(shard2.map(key)).size).toBe(shard2.length);
    expect(new Set([...shard1, ...shard2].map(key)).size).toBe(allCases.length);
    expect(combined).toEqual(allCases.map(key).sort());
  });

  it('builds summaries with timings, shard info, and failure reasons', () => {
    const summary = createSummaryPayload({
      runId: '2026-06-17T00-00-00-000Z',
      startedAt: '2026-06-17T00:00:00.000Z',
      finishedAt: '2026-06-17T00:00:01.500Z',
      failures: [{ label: 'failed-case' }],
      caseTotal: 2,
      args: {
        effectId: null,
        filter: 'anime4k',
        fixture: 'gradient',
        fixtureExact: true,
        runId: '2026-06-17T00-00-00-000Z',
        shard: { index: 1, count: 2 },
      },
      cases: [{
        label: 'passed-case',
        passed: true,
        timings: { referenceMs: 1, candidateMs: 2, compareMs: 3, totalMs: 6 },
        reason: null,
      }, {
        label: 'failed-case',
        passed: false,
        timings: { referenceMs: null, candidateMs: null, compareMs: null, totalMs: 1500 },
        reason: 'candidate timed out',
      }],
    });

    expect(summary.caseCount).toBe(2);
    expect(summary.caseTotal).toBe(2);
    expect(summary.failureCount).toBe(1);
    expect(summary.runId).toBe('2026-06-17T00-00-00-000Z');
    expect(summary.durationMs).toBe(1500);
    expect(summary.shard).toBe('1/2');
    expect(summary.filters.runId).toBe('2026-06-17T00-00-00-000Z');
    expect(summary.cases[0].timings.totalMs).toBe(6);
    expect(summary.cases[1].reason).toBe('candidate timed out');
  });

  it('keeps diagnostic fixture metrics out of aggregate reports by default', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-report-diagnostic-'));
    try {
      const currentDir = join(root, 'current');
      const diagnosticDir = join(root, 'diagnostic');
      mkdirSync(currentDir);
      mkdirSync(diagnosticDir);
      writeFileSync(join(currentDir, 'metrics.json'), JSON.stringify({
        runId: 'run-a',
        effectId: 'anime4k/Upscale/CNNx2M',
        fixtureId: 'deterministic_noise_112x48',
        validationMode: 'rgb-math',
        passed: true,
        meanAbs: 0.001,
        maxAbs: 0.002,
        timings: { totalMs: 10 },
      }));
      writeFileSync(join(diagnosticDir, 'metrics.json'), JSON.stringify({
        runId: 'run-a',
        effectId: 'anime4k/Upscale/CNNx2M',
        fixtureId: 'deterministic_noise_alpha_112x48',
        validationMode: 'rgb-math',
        passed: false,
        reason: 'alpha semantics diagnostic',
      }));

      const defaultReport = loadReport(root);
      expect(defaultReport.caseCount).toBe(1);
      expect(defaultReport.failureCount).toBe(0);
      expect(defaultReport.skippedDiagnosticCount).toBe(1);

      const diagnosticReport = loadReport(root, { includeDiagnostic: true });
      expect(diagnosticReport.caseCount).toBe(2);
      expect(diagnosticReport.failureCount).toBe(1);
      expect(diagnosticReport.skippedDiagnosticCount).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('can filter aggregate reports to one run id', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-report-run-id-'));
    try {
      const runADir = join(root, 'run-a');
      const runBDir = join(root, 'run-b');
      mkdirSync(runADir);
      mkdirSync(runBDir);
      writeFileSync(join(runADir, 'metrics.json'), JSON.stringify({
        runId: 'run-a',
        effectId: 'anime4k/Upscale/CNNx2M',
        fixtureId: 'gradient_112x48',
        validationMode: 'rgb-math',
        passed: true,
      }));
      writeFileSync(join(runBDir, 'metrics.json'), JSON.stringify({
        runId: 'run-b',
        effectId: 'anime4k/Upscale/CNNx2M',
        fixtureId: 'checker_edges_112x48',
        validationMode: 'rgb-math',
        passed: false,
      }));

      const report = loadReport(root, { runId: 'run-a' });
      expect(report.caseCount).toBe(1);
      expect(report.failureCount).toBe(0);
      expect(report.skippedRunIdCount).toBe(1);
      expect(report.cases[0].fixtureId).toBe('gradient_112x48');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('renders aggregate verification reports with validation modes', () => {
    const markdown = renderMarkdown({
      generatedAt: '2026-06-17T00:00:00.000Z',
      root: 'test-results/verify/effects',
      caseCount: 1,
      skippedCount: 0,
      failureCount: 0,
      backends: [{ backendId: 'anime4k', caseCount: 1, passedCount: 1, failedCount: 0, totalMs: 10 }],
      cases: [{
        backendId: 'anime4k',
        effectId: 'anime4k/Upscale/CNNx2M',
        fixtureId: 'gradient_112x48',
        validationMode: 'rgb-math',
        passed: true,
        meanAbs: 0.001,
        maxAbs: 0.002,
        timings: { totalMs: 10 },
        reason: null,
      }],
    });

    expect(markdown).toContain('Effect Verification Report');
    expect(markdown).toContain('rgb-math');
    expect(markdown).toContain('anime4k/Upscale/CNNx2M');
  });

  it('filters stale metrics out of aggregate verification reports', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-report-'));
    try {
      const currentDir = join(root, 'current');
      const staleDir = join(root, 'stale');
      mkdirSync(currentDir);
      mkdirSync(staleDir);
      writeFileSync(join(currentDir, 'metrics.json'), JSON.stringify({
        effectId: 'anime4k/Upscale/CNNx2M',
        fixtureId: 'gradient_112x48',
        validationMode: 'rgb-math',
        passed: true,
        meanAbs: 0.001,
        maxAbs: 0.002,
        timings: { totalMs: 10 },
      }));
      writeFileSync(join(staleDir, 'metrics.json'), JSON.stringify({
        effectId: 'anime4k/Upscale/CNNx2M',
        fixtureId: 'constant_midgray_112x48',
        validationMode: 'obsolete-mode',
        passed: false,
        reason: 'old screenshot path',
      }));

      const report = loadReport(root);
      expect(report.caseCount).toBe(1);
      expect(report.failureCount).toBe(0);
      expect(report.skippedCount).toBe(1);
      expect(report.cases[0].validationMode).toBe('rgb-math');
      expect(report.skipped[0].validationMode).toBe('obsolete-mode');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
