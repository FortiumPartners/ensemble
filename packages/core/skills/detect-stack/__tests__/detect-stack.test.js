/**
 * detect-stack end to end: the CLI contract (axes, flags, exit codes), the
 * shared output envelope, and checks that would fail if the four axes were
 * wired to each other's engines or if detector names drifted from skill names.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { AXES, detect } = require('../detect-stack');

const SKILL_DIR = path.join(__dirname, '..');
const SCRIPT = path.join(SKILL_DIR, 'detect-stack.js');
const PACKAGES_DIR = path.join(SKILL_DIR, '..', '..', '..');

const created = [];

/** Create a throwaway project directory containing { relativePath: content }. */
function makeProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-stack-cli-'));
  created.push(dir);
  for (const [relativePath, content] of Object.entries(files)) {
    const file = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}

afterAll(() => {
  for (const dir of created) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Run the CLI and parse stdout as JSON when possible. */
function run(args, options = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 30000, ...options });
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    // not JSON (usage errors, --help)
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

const names = list => list.map(entry => entry.name);

// A React app with Jest: the framework axis must answer "react", the test axis "jest".
const REACT_JEST = {
  'package.json': {
    name: 'web',
    dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' },
    devDependencies: { jest: '^29.7.0' }
  },
  'public/index.html': '<div id="root"></div>',
  'src/App.tsx': [
    "import React, { useState, useEffect } from 'react';",
    'export default function App() {',
    '  const [n, setN] = useState(0);',
    '  useEffect(() => {}, []);',
    '  return <div>{n}</div>;',
    '}'
  ].join('\n'),
  'src/index.tsx': [
    "import { createRoot } from 'react-dom/client';",
    "import App from './App';",
    "createRoot(document.getElementById('root')).render(<App />);"
  ].join('\n'),
  'jest.config.js': 'module.exports = {};',
  'src/App.test.tsx': "test('renders', () => {});"
};

// Terraform + SDK + CLI script: three AWS signals, enough for the default threshold.
const AWS_STACK = {
  'main.tf': 'provider "aws" {\n  region = "us-east-1"\n}\nresource "aws_s3_bucket" "data" {}\n',
  'package.json': { name: 'infra', dependencies: { '@aws-sdk/client-s3': '^3.0.0' } },
  'deploy.sh': 'aws s3 sync ./dist s3://bucket\n'
};

const HELM_CHART = {
  'Chart.yaml': 'name: web\nversion: 0.1.0\n',
  'values.yaml': 'replicas: 1\n',
  'templates/deployment.yaml': 'apiVersion: apps/v1\nkind: Deployment\n'
};

describe('axes are independent', () => {
  test('a React + Jest project is react on the framework axis and jest on the test axis', async () => {
    const dir = makeProject(REACT_JEST);

    const framework = await detect('framework', dir);
    const test = await detect('test', dir);

    expect(framework.primary).toBe('react');
    expect(test.primary).toBe('jest');

    // Neither axis answers with the other's vocabulary
    expect(names(framework.all_results).sort()).toEqual(['blazor', 'dotnet', 'nestjs', 'phoenix', 'rails', 'react']);
    expect(names(test.all_results).sort()).toEqual(['exunit', 'jest', 'pytest', 'rspec', 'xunit']);
    expect(names(framework.all_results)).not.toContain('jest');
    expect(names(test.all_results)).not.toContain('react');
  });

  test('the same project has no tooling and no cloud provider', async () => {
    const dir = makeProject(REACT_JEST);

    const tooling = await detect('tooling', dir);
    const cloud = await detect('cloud', dir);

    expect(tooling.detected).toBe(false);
    expect(names(tooling.all_results).sort()).toEqual(['argocd', 'flyio', 'helm', 'kubernetes', 'kustomize']);
    expect(cloud.detected).toBe(false);
    expect(names(cloud.all_results).sort()).toEqual(['aws', 'azure', 'gcp']);
  });

  test('a Terraform/AWS project is aws on the cloud axis and nothing on the others', async () => {
    const dir = makeProject(AWS_STACK);

    const results = {};
    for (const axis of AXES) {
      results[axis] = await detect(axis, dir);
    }

    expect(results.cloud.primary).toBe('aws');
    expect(results.cloud.results[0].signals).toMatchObject({ terraform: true, npm: true, cli: true });
    expect(results.framework.detected).toBe(false);
    expect(results.test.detected).toBe(false);
    expect(results.tooling.detected).toBe(false);
  });

  test('a Helm chart is helm on the tooling axis and nothing on the cloud axis', async () => {
    const dir = makeProject(HELM_CHART);

    expect((await detect('tooling', dir)).primary).toBe('helm');
    expect((await detect('cloud', dir)).detected).toBe(false);
    expect((await detect('framework', dir)).detected).toBe(false);
  });

  test('the CLI routes each --axis to its own engine', () => {
    const dir = makeProject({ ...REACT_JEST, ...AWS_STACK, 'package.json': {
      dependencies: { react: '^18', 'react-dom': '^18', '@aws-sdk/client-s3': '^3' },
      devDependencies: { jest: '^29' }
    } });

    const framework = run(['--axis=framework', dir]);
    const test = run(['--axis=test', dir]);
    const tooling = run(['--axis=tooling', dir]);
    const cloud = run(['--axis=cloud', dir]);

    expect(framework.json.axis).toBe('framework');
    expect(framework.json.primary).toBe('react');
    expect(test.json.axis).toBe('test');
    expect(test.json.primary).toBe('jest');
    expect(tooling.json.axis).toBe('tooling');
    expect(tooling.json.primary).toBeNull();
    expect(cloud.json.axis).toBe('cloud');
    expect(cloud.json.primary).toBe('aws');

    // exit codes: 0 when detected, 1 when not
    expect([framework.status, test.status, tooling.status, cloud.status]).toEqual([0, 0, 1, 0]);
  });

  test('--axis=all runs every axis and keys each result by its axis', () => {
    const dir = makeProject(REACT_JEST);

    const { status, json } = run(['--axis=all', dir]);

    expect(status).toBe(0);
    expect(json.axis).toBe('all');
    expect(json.detected).toBe(true);
    expect(Object.keys(json.axes)).toEqual(AXES);
    for (const axis of AXES) {
      expect(json.axes[axis].axis).toBe(axis);
    }
    expect(json.axes.framework.primary).toBe('react');
    expect(json.axes.test.primary).toBe('jest');
    expect(json.axes.tooling.detected).toBe(false);
    expect(json.axes.cloud.detected).toBe(false);
  });

  test('--axis=all is the default and exits 1 when no axis detects anything', () => {
    const { status, json } = run([makeProject()]);

    expect(status).toBe(1);
    expect(json.axis).toBe('all');
    expect(json.detected).toBe(false);
  });
});

describe('cloud axis on a Terraform-only project', () => {
  const TERRAFORM_ONLY = { 'main.tf': 'provider "aws" {}\nresource "aws_vpc" "main" {}\n' };

  test('aws is the top candidate through the terraform signal but under the default threshold', () => {
    const { status, json } = run(['--axis=cloud', makeProject(TERRAFORM_ONLY)]);

    expect(status).toBe(1);
    expect(json.detected).toBe(false);
    expect(json.all_results[0].name).toBe('aws');
    expect(json.all_results[0].signals.terraform).toBe(true);
  });

  test('--min-confidence lets it through', () => {
    const { status, json } = run(['--axis=cloud', '--min-confidence=0.25', makeProject(TERRAFORM_ONLY)]);

    expect(status).toBe(0);
    expect(json.primary).toBe('aws');
    expect(json.threshold).toBe(0.25);
  });
});

describe('output envelope', () => {
  const rich = {
    ...REACT_JEST,
    'main.tf': AWS_STACK['main.tf'],
    'deploy.sh': 'aws s3 sync ./dist s3://bucket\nhelm install web .\n',
    ...HELM_CHART,
    'package.json': {
      dependencies: { react: '^18', 'react-dom': '^18', '@aws-sdk/client-s3': '^3' },
      devDependencies: { jest: '^29' }
    }
  };

  test.each(AXES)('%s: shape and invariants', async axis => {
    const result = await detect(axis, makeProject(rich));

    expect(Object.keys(result).slice(0, 7)).toEqual([
      'axis', 'detected', 'primary', 'confidence', 'threshold', 'results', 'all_results'
    ]);
    expect(result.axis).toBe(axis);
    expect(result.detected).toBe(result.results.length > 0);
    expect(result.primary).toBe(result.results.length > 0 ? result.results[0].name : null);
    expect(result.confidence).toBe(result.results.length > 0 ? result.results[0].confidence : 0);

    // everything reported as detected is also in all_results, in the same order
    const allNames = names(result.all_results);
    expect(allNames.filter(name => names(result.results).includes(name))).toEqual(names(result.results));
    const confidences = result.all_results.map(entry => entry.confidence);
    expect(confidences).toEqual([...confidences].sort((a, b) => b - a));

    for (const entry of [...result.results, ...result.all_results]) {
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.display_name).toBe('string');
      expect(typeof entry.confidence).toBe('number');
      expect(entry.signals).toEqual(expect.any(Object));
      expect(entry.signal_count).toBe(Object.values(entry.signals).filter(Boolean).length);
    }

    // plain JSON: survives a round trip unchanged
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  test('the CLI prints exactly the envelope detect() returns', async () => {
    const dir = makeProject(rich);

    const cli = run(['--axis=test', dir]);

    expect(cli.stderr).toBe('');
    expect(cli.json).toEqual(await detect('test', dir));
  });

  test('threshold is the numeric cut-off per axis, null where any signal counts', async () => {
    const dir = makeProject(rich);

    expect((await detect('framework', dir)).threshold).toBe(0.8);
    expect((await detect('test', dir)).threshold).toBeNull();
    expect((await detect('tooling', dir)).threshold).toBe(0.7);
    expect((await detect('cloud', dir)).threshold).toBe(0.7);
  });
});

describe('CLI arguments', () => {
  test('accepts --flag value as well as --flag=value', () => {
    const dir = makeProject(HELM_CHART);

    const equals = run(['--axis=tooling', dir]);
    const spaced = run(['--axis', 'tooling', dir]);

    expect(spaced.json).toEqual(equals.json);
    expect(equals.json.primary).toBe('helm');
  });

  test('analyzes the current directory when no path is given', () => {
    const { status, json } = run(['--axis=tooling'], { cwd: makeProject(HELM_CHART) });

    expect(status).toBe(0);
    expect(json.primary).toBe('helm');
  });

  test('--framework overrides framework detection', () => {
    const { status, json } = run(['--axis=framework', '--framework=rails', makeProject()]);

    expect(status).toBe(0);
    expect(json.manual_override).toBe(true);
    expect(json.primary).toBe('rails');
    expect(json.confidence).toBe(1);
  });

  test('--provider overrides cloud detection', () => {
    const { status, json } = run(['--axis', 'cloud', '--provider', 'gcp', makeProject()]);

    expect(status).toBe(0);
    expect(json.manual_override).toBe(true);
    expect(json.primary).toBe('gcp');
  });

  test('--tools limits the tools evaluated', () => {
    const { json } = run(['--axis=tooling', '--tools=helm,flyio', makeProject(HELM_CHART)]);

    expect(names(json.all_results).sort()).toEqual(['flyio', 'helm']);
  });

  test('--help prints usage and exits 0', () => {
    const { status, stdout } = run(['--help']);

    expect(status).toBe(0);
    expect(stdout).toContain('Usage: detect-stack.js');
    for (const axis of AXES) {
      expect(stdout).toContain(axis);
    }
  });
});

describe('CLI errors exit 2 and print nothing on stdout', () => {
  const dir = () => makeProject();

  test.each([
    ['an unknown axis', ['--axis=bogus'], "Unknown axis 'bogus'. Valid axes: framework, test, tooling, cloud, all"],
    ['an unknown axis (spaced)', ['--axis', 'detect'], "Unknown axis 'detect'"],
    ['a missing axis value', ['--axis'], 'Option --axis requires a value'],
    ['a flag in place of the axis value', ['--axis', '--framework=react'], 'Option --axis requires a value'],
    ['an unknown option', ['--axes=framework'], 'Unknown option: --axes'],
    ['a legacy option', ['--tool', 'helm'], 'Unknown option: --tool'],
    ['a single-dash option', ['-x'], 'Unknown option: -x'],
    ['an empty axis value', ['--axis='], 'Option --axis requires a value'],
    ['an empty tools value', ['--axis=tooling', '--tools='], 'Option --tools requires a value'],
    ['an unknown framework override', ['--axis=framework', '--framework=angular'], "Invalid framework 'angular'"],
    ['an unknown provider override', ['--axis=cloud', '--provider=gpc'], "Unknown provider 'gpc'"],
    ['an unknown tool', ['--axis=tooling', '--tools=terraform'], "Unknown tool 'terraform'"],
    ['a non-numeric --min-confidence', ['--axis=cloud', '--min-confidence=high'], '--min-confidence must be'],
    ['a zero --min-confidence', ['--axis=cloud', '--min-confidence=0'], '--min-confidence must be'],
    ['a --min-confidence above 1', ['--axis=cloud', '--min-confidence=1.5'], '--min-confidence must be']
  ])('%s', (_label, args, message) => {
    const { status, stdout, stderr } = run([dir(), ...args]);

    expect(status).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain(message);
  });

  test('a second positional argument', () => {
    const { status, stderr } = run([dir(), dir()]);

    expect(status).toBe(2);
    expect(stderr).toContain('Unexpected argument');
  });

  test('a project path that does not exist', () => {
    const { status, stdout, stderr } = run(['--axis=cloud', path.join(os.tmpdir(), 'detect-stack-does-not-exist')]);

    expect(status).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('project path is not a directory');
  });

  test('a project path that is a file', () => {
    const { status, stderr } = run(['--axis=cloud', SCRIPT]);

    expect(status).toBe(2);
    expect(stderr).toContain('project path is not a directory');
  });

  test('detect() rejects an unknown axis too', async () => {
    await expect(detect('framwork', makeProject())).rejects.toThrow("Unknown axis 'framwork'");
  });
});

describe('detector names equal skill names', () => {
  /** Skill names as Claude Code sees them under packages/<pkg>/skills: one directory per skill. */
  function collectSkillNames() {
    const found = new Set();
    for (const pkg of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
      if (!pkg.isDirectory() || pkg.name === 'pi' || pkg.name === 'full') continue;
      const skillsDir = path.join(PACKAGES_DIR, pkg.name, 'skills');
      if (!fs.existsSync(skillsDir)) continue;

      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (entry.isDirectory() && fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md'))) {
          found.add(entry.name);
        }
      }
    }
    return found;
  }

  // Detected tools and providers that have no dedicated skill (agents say so
  // explicitly: kustomize patterns live in kubernetes; gcp and azure are
  // handled with cloud-agnostic guidance).
  const WITHOUT_SKILL = ['argocd', 'azure', 'gcp', 'kustomize'];

  const detectorNames = () => {
    const read = file => JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'patterns', file), 'utf8'));
    return [
      ...Object.keys(read('framework.json').frameworks),
      ...Object.keys(read('test.json').frameworks),
      ...Object.keys(read('tooling.json').tools),
      ...Object.keys(read('cloud.json').providers)
    ];
  };

  test('every detector name is the name of an existing skill, apart from the listed exceptions', () => {
    const skills = collectSkillNames();

    const missing = detectorNames().filter(name => !skills.has(name) && !WITHOUT_SKILL.includes(name));

    expect(missing).toEqual([]);
  });

  test('the exceptions list stays honest: none of them has a skill yet', () => {
    const skills = collectSkillNames();

    expect(WITHOUT_SKILL.filter(name => skills.has(name))).toEqual([]);
    for (const name of WITHOUT_SKILL) {
      expect(detectorNames()).toContain(name);
    }
  });

  test('detector names are lowercase kebab-case and unique across axes', () => {
    const all = detectorNames();

    expect(all.every(name => /^[a-z][a-z0-9-]*$/.test(name))).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('skill documentation', () => {
  const skillMd = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const referenceMd = fs.readFileSync(path.join(SKILL_DIR, 'REFERENCE.md'), 'utf8');

  test('SKILL.md frontmatter name equals the directory name', () => {
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(skillMd)[1];

    expect(/^name:\s*(\S+)\s*$/m.exec(frontmatter)[1]).toBe(path.basename(SKILL_DIR));
    expect(path.basename(SKILL_DIR)).toBe('detect-stack');
    expect(frontmatter).toMatch(/^description:\s*\S/m);
  });

  test('SKILL.md has a section per axis', () => {
    for (const heading of ['## Framework', '## Test runners', '## Tooling', '## Cloud providers']) {
      expect(skillMd).toContain(`\n${heading}\n`);
    }
  });

  test('every --axis value shown in the docs is a real axis', () => {
    const valid = new Set([...AXES, 'all']);
    const shown = [...(skillMd + referenceMd).matchAll(/--axis[= ]([a-z]+)/g)].map(match => match[1]);

    expect(shown.length).toBeGreaterThan(0);
    expect(shown.filter(axis => !valid.has(axis))).toEqual([]);
  });
});
