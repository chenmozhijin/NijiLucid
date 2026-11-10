const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

const defaultDistDirs = ['dist-chrome', 'dist-firefox'];
const scannedExtensions = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json']);
const forbiddenTokens = [
  'libplacebo',
  'verify-effects',
  'reference-luma',
  'candidate-luma',
  'reference-rgba',
  'candidate-rgba',
  '__runEffectVerification',
  'scripts/verify',
  'test/verify',
  '.reference/Anime4K',
  '.reference/ArtCNN',
  '.reference/ACNetGLSL',
  '.reference/CuNNy',
];
const expectedManifestExposure = {
  hostPattern: '<all_urls>',
  webAccessibleResources: ['*.js'],
  permissions: [
    'activeTab',
    'tabCapture',
    'storage',
    'tabs',
    'scripting',
    'declarativeNetRequest',
    'declarativeNetRequestWithHostAccess',
  ],
  dnrRulesetId: 'ruleset_1',
  dnrRulesetPath: 'rules.json',
};

function parseArgs(argv) {
  const distDirs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dist') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--dist requires a directory.');
      }
      distDirs.push(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--dist=')) {
      distDirs.push(arg.slice('--dist='.length));
      continue;
    }
    throw new Error(`Unknown check:production-bundle option: ${arg}`);
  }

  return { distDirs: distDirs.length > 0 ? distDirs : defaultDistDirs };
}

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolute));
    } else if (entry.isFile() && scannedExtensions.has(path.extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files;
}

function scanProductionBundle({ distDirs }) {
  const findings = [];
  const scannedDirs = [];

  for (const distDir of distDirs) {
    const root = path.resolve(repoRoot, distDir);
    if (!fs.existsSync(root)) {
      if (distDirs.length === 1) {
        throw new Error(`Production bundle directory does not exist: ${root}`);
      }
      continue;
    }

    scannedDirs.push(root);
    const manifestPath = path.join(root, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      findings.push({
        file: path.relative(repoRoot, manifestPath).replace(/\\/g, '/'),
        token: 'missing manifest.json',
      });
    } else {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      findings.push(...validateManifestExposure(
        manifest,
        path.relative(repoRoot, manifestPath).replace(/\\/g, '/'),
      ));
    }

    for (const file of walkFiles(root)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const token of forbiddenTokens) {
        if (source.includes(token)) {
          findings.push({
            file: path.relative(repoRoot, file).replace(/\\/g, '/'),
            token,
          });
        }
      }
    }
  }

  if (scannedDirs.length === 0) {
    throw new Error(`No production bundle directories found: ${distDirs.join(', ')}`);
  }

  return { scannedDirs, findings };
}

function sameStringSet(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && expected.every(value => actual.includes(value));
}

function validateManifestExposure(manifest, file = 'manifest.json') {
  const findings = [];
  const expected = expectedManifestExposure;

  if (!sameStringSet(manifest.host_permissions, [expected.hostPattern])) {
    findings.push({ file, token: 'unexpected host_permissions' });
  }

  const permissions = manifest.browser_specific_settings?.gecko
    ? expected.permissions.filter(permission => permission !== 'tabCapture' && permission !== 'activeTab')
    : expected.permissions;
  if (!sameStringSet(manifest.permissions, permissions)) {
    findings.push({ file, token: 'unexpected permissions' });
  }

  const contentScriptMatches = manifest.content_scripts?.flatMap(script => script.matches ?? []) ?? [];
  if (!contentScriptMatches.includes(expected.hostPattern)) {
    findings.push({ file, token: 'content script does not cover expected host pattern' });
  }

  const webAccessibleResources = manifest.web_accessible_resources ?? [];
  if (webAccessibleResources.length !== 1) {
    findings.push({ file, token: 'unexpected web_accessible_resources entry count' });
  } else {
    const [entry] = webAccessibleResources;
    if (!sameStringSet(entry.resources, expected.webAccessibleResources)) {
      findings.push({ file, token: 'unexpected web_accessible_resources resources' });
    }
    if (!sameStringSet(entry.matches, [expected.hostPattern])) {
      findings.push({ file, token: 'unexpected web_accessible_resources matches' });
    }
  }

  const ruleResources = manifest.declarative_net_request?.rule_resources ?? [];
  const expectedRuleset = ruleResources.find(rule => rule.id === expected.dnrRulesetId);
  if (!expectedRuleset) {
    findings.push({ file, token: 'missing expected DNR ruleset' });
  } else {
    if (expectedRuleset.enabled !== false) {
      findings.push({ file, token: 'DNR ruleset must be disabled by default' });
    }
    if (expectedRuleset.path !== expected.dnrRulesetPath) {
      findings.push({ file, token: 'unexpected DNR ruleset path' });
    }
  }

  return findings;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { scannedDirs, findings } = scanProductionBundle(args);
  if (findings.length > 0) {
    console.error('Production bundle contains verify/reference-only strings:');
    for (const finding of findings) {
      console.error(`- ${finding.file}: ${finding.token}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Production bundle scan passed (${scannedDirs.length} dist dirs).`);
}

if (require.main === module) {
  main();
}

module.exports = {
  forbiddenTokens,
  expectedManifestExposure,
  parseArgs,
  scanProductionBundle,
  scannedExtensions,
  validateManifestExposure,
};
