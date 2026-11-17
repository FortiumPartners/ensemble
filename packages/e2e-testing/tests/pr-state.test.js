'use strict';

const { checkPrState, checkPrStateAdo, detectRepoHost, isAdoStatusActive, NO_OPEN_PR_MESSAGE } = require('../lib/pr-state');

describe('checkPrState (AC-038-3: explicit error, not silently conflated with "no PR found")', () => {
  test('exec() throwing (toolchain-cli missing, adapter not installed, non-zero exit, etc.) propagates as a thrown error', () => {
    const exec = jest.fn(() => {
      throw new Error('spawn toolchain-cli.js ENOENT');
    });
    expect(() => checkPrState('feature/x', { exec })).toThrow('spawn toolchain-cli.js ENOENT');
  });

  test('malformed/non-JSON toolchain-cli stdout throws, rather than returning hasOpenPr: false', () => {
    const exec = jest.fn(() => 'not json at all');
    expect(() => checkPrState('feature/x', { exec })).toThrow(/non-JSON output/);
  });

  test('a {ok:false} toolchain-cli envelope throws, naming the envelope error message', () => {
    const exec = jest.fn(() =>
      JSON.stringify({ ok: false, error: { code: 'NOT_INSTALLED', message: 'gh is not installed' } })
    );
    expect(() => checkPrState('feature/x', { exec })).toThrow(/gh is not installed/);
  });

  test('NO_OPEN_PR_MESSAGE documents the halt instruction', () => {
    expect(NO_OPEN_PR_MESSAGE).toMatch(/implement-trd-tasks/);
    expect(NO_OPEN_PR_MESSAGE).toMatch(/No open PR/i);
  });

  test('an {ok:true} envelope with an empty items array -> hasOpenPr: false (legitimate "no PR", does not throw)', () => {
    const exec = jest.fn(() => JSON.stringify({ ok: true, data: { items: [] } }));
    const result = checkPrState('feature/x', { exec });
    expect(result).toEqual({ hasOpenPr: false, state: null, url: null, number: null, baseBranch: null });
  });

  test('an {ok:true} envelope whose items list has no item for this branch -> hasOpenPr: false', () => {
    const exec = jest.fn(() =>
      JSON.stringify({
        ok: true,
        data: { items: [{ id: '7', url: 'https://x/7', state: 'OPEN', baseBranch: 'main', headBranch: 'some-other-branch' }] },
      })
    );
    const result = checkPrState('feature/x', { exec });
    expect(result).toEqual({ hasOpenPr: false, state: null, url: null, number: null, baseBranch: null });
  });
});

describe('checkPrState (AC-038-3/AC-001-2: open PR is detected and surfaced via host.change-request-list)', () => {
  test('matching item -> hasOpenPr: true with state/url/number surfaced', () => {
    const exec = jest.fn(() =>
      JSON.stringify({
        ok: true,
        data: {
          items: [
            { id: '42', url: 'https://github.com/org/repo/pull/42', state: 'OPEN', baseBranch: null, headBranch: 'feature/trd-003' },
          ],
        },
      })
    );
    const result = checkPrState('feature/trd-003', { exec });
    expect(result).toEqual({
      hasOpenPr: true,
      state: 'OPEN',
      url: 'https://github.com/org/repo/pull/42',
      number: 42,
      baseBranch: null,
    });
  });

  test('matching item with baseBranch -> baseBranch surfaced for grounding to diff against', () => {
    const exec = jest.fn(() =>
      JSON.stringify({
        ok: true,
        data: {
          items: [
            { id: '42', url: 'https://github.com/org/repo/pull/42', state: 'OPEN', baseBranch: 'develop', headBranch: 'feature/trd-003' },
          ],
        },
      })
    );
    const result = checkPrState('feature/trd-003', { exec });
    expect(result.baseBranch).toBe('develop');
  });

  test('two open change requests, one matching this branch -> hasOpenPr: true for the match only', () => {
    const exec = jest.fn(() =>
      JSON.stringify({
        ok: true,
        data: {
          items: [
            { id: '10', url: 'https://github.com/org/repo/pull/10', state: 'OPEN', baseBranch: 'main', headBranch: 'feature/other' },
            { id: '11', url: 'https://github.com/org/repo/pull/11', state: 'OPEN', baseBranch: 'main', headBranch: 'feature/trd-038' },
          ],
        },
      })
    );
    const result = checkPrState('feature/trd-038', { exec });
    expect(result).toEqual({
      hasOpenPr: true,
      state: 'OPEN',
      url: 'https://github.com/org/repo/pull/11',
      number: 11,
      baseBranch: 'main',
    });
  });
});

describe('checkPrState (routing)', () => {
  test('invokes exec with the discrete, fixed host.change-request-list argv, never string-interpolating the branch into argv', () => {
    const exec = jest.fn(() => JSON.stringify({ ok: true, data: { items: [] } }));
    checkPrState('feature/some-branch; rm -rf /', { exec });
    expect(exec).toHaveBeenCalledWith(['run', 'host.change-request-list', '--json']);
  });
});

describe('detectRepoHost (TRD-031)', () => {
  test('github.com remote -> host: github, checkPrState behavior untouched', () => {
    const gitExec = jest.fn(() => 'https://github.com/example-org/some-app.git\n');
    expect(detectRepoHost({ gitExec })).toEqual({
      host: 'github',
      remoteUrl: 'https://github.com/example-org/some-app.git',
    });
  });

  test('modern Azure DevOps remote (with user@ prefix) -> host: azure-devops, org/project/repo parsed', () => {
    const gitExec = jest.fn(() => 'https://contoso@dev.azure.com/contoso/SampleApp/_git/SampleApp\n');
    expect(detectRepoHost({ gitExec })).toEqual({
      host: 'azure-devops',
      remoteUrl: 'https://contoso@dev.azure.com/contoso/SampleApp/_git/SampleApp',
      organization: 'contoso',
      project: 'SampleApp',
      repository: 'SampleApp',
    });
  });

  test('modern Azure DevOps remote (no user@ prefix, trailing .git) -> parsed the same', () => {
    const gitExec = jest.fn(() => 'https://dev.azure.com/myorg/My%20Project/_git/my-repo.git\n');
    expect(detectRepoHost({ gitExec })).toEqual({
      host: 'azure-devops',
      remoteUrl: 'https://dev.azure.com/myorg/My%20Project/_git/my-repo.git',
      organization: 'myorg',
      project: 'My Project',
      repository: 'my-repo',
    });
  });

  test('legacy *.visualstudio.com remote -> host: azure-devops, org/project/repo parsed', () => {
    const gitExec = jest.fn(() => 'https://myorg.visualstudio.com/MyProject/_git/my-repo\n');
    expect(detectRepoHost({ gitExec })).toEqual({
      host: 'azure-devops',
      remoteUrl: 'https://myorg.visualstudio.com/MyProject/_git/my-repo',
      organization: 'myorg',
      project: 'MyProject',
      repository: 'my-repo',
    });
  });

  test('unrecognized host -> host: unknown, never guessed as github or azure-devops', () => {
    const gitExec = jest.fn(() => 'https://bitbucket.org/someorg/somerepo.git\n');
    expect(detectRepoHost({ gitExec })).toEqual({
      host: 'unknown',
      remoteUrl: 'https://bitbucket.org/someorg/somerepo.git',
    });
  });

  test('gitExec throws (no origin remote, git not available) -> host: unknown, never throws', () => {
    const gitExec = jest.fn(() => {
      throw new Error('fatal: No such remote \'origin\'');
    });
    expect(detectRepoHost({ gitExec })).toEqual({ host: 'unknown', remoteUrl: null });
  });
});

describe('checkPrStateAdo (TRD-031: same {hasOpenPr, state, url, number, baseBranch} contract as checkPrState)', () => {
  test('an active PR on the matching branch -> hasOpenPr: true', () => {
    const prs = [
      {
        pullRequestId: 42,
        status: 'active',
        sourceRefName: 'refs/heads/feature/trd-003',
        targetRefName: 'refs/heads/main',
        url: 'https://dev.azure.com/org/proj/_git/repo/pullrequest/42',
      },
    ];
    expect(checkPrStateAdo('feature/trd-003', prs)).toEqual({
      hasOpenPr: true,
      state: 'active',
      url: 'https://dev.azure.com/org/proj/_git/repo/pullrequest/42',
      number: 42,
      baseBranch: 'main',
    });
  });

  test('targetRefName surfaces as baseBranch stripped of refs/heads/ (e.g. some repos targeting integration, not main)', () => {
    const prs = [
      { pullRequestId: 4129, status: 'active', sourceRefName: 'refs/heads/feature/mike/topnav-icon-text-layout', targetRefName: 'refs/heads/integration' },
    ];
    expect(checkPrStateAdo('feature/mike/topnav-icon-text-layout', prs).baseBranch).toBe('integration');
  });

  test('the Azure DevOps MCP server\'s numeric status (1 = Active) is accepted, not just the string form', () => {
    const prs = [
      { pullRequestId: 4129, status: 1, sourceRefName: 'refs/heads/feature/x', targetRefName: 'refs/heads/integration' },
    ];
    expect(checkPrStateAdo('feature/x', prs)).toEqual({
      hasOpenPr: true,
      state: 'active',
      url: null,
      number: 4129,
      baseBranch: 'integration',
    });
  });

  test('a completed/abandoned PR on the matching branch -> hasOpenPr: false (not "active")', () => {
    const prs = [
      { pullRequestId: 41, status: 'completed', sourceRefName: 'refs/heads/feature/trd-003' },
      { pullRequestId: 40, status: 'abandoned', sourceRefName: 'refs/heads/feature/trd-003' },
    ];
    expect(checkPrStateAdo('feature/trd-003', prs)).toEqual({ hasOpenPr: false, state: null, url: null, number: null, baseBranch: null });
  });

  test('numeric completed/abandoned/notSet statuses (3/2/0) are also rejected, not just their string forms', () => {
    const prs = [
      { pullRequestId: 43, status: 3, sourceRefName: 'refs/heads/feature/trd-003' },
      { pullRequestId: 44, status: 2, sourceRefName: 'refs/heads/feature/trd-003' },
      { pullRequestId: 45, status: 0, sourceRefName: 'refs/heads/feature/trd-003' },
    ];
    expect(checkPrStateAdo('feature/trd-003', prs)).toEqual({ hasOpenPr: false, state: null, url: null, number: null, baseBranch: null });
  });

  test('an active PR on a different branch -> hasOpenPr: false', () => {
    const prs = [{ pullRequestId: 42, status: 'active', sourceRefName: 'refs/heads/some-other-branch' }];
    expect(checkPrStateAdo('feature/trd-003', prs)).toEqual({ hasOpenPr: false, state: null, url: null, number: null, baseBranch: null });
  });

  test('empty/non-array input -> hasOpenPr: false, never throws', () => {
    expect(checkPrStateAdo('feature/x', [])).toEqual({ hasOpenPr: false, state: null, url: null, number: null, baseBranch: null });
    expect(checkPrStateAdo('feature/x', null)).toEqual({ hasOpenPr: false, state: null, url: null, number: null, baseBranch: null });
    expect(checkPrStateAdo('feature/x', undefined)).toEqual({ hasOpenPr: false, state: null, url: null, number: null, baseBranch: null });
  });
});

describe('isAdoStatusActive', () => {
  test('numeric 1 (Active) -> true', () => {
    expect(isAdoStatusActive(1)).toBe(true);
  });

  test('numeric 0/2/3 (NotSet/Abandoned/Completed) -> false', () => {
    expect(isAdoStatusActive(0)).toBe(false);
    expect(isAdoStatusActive(2)).toBe(false);
    expect(isAdoStatusActive(3)).toBe(false);
  });

  test('string "active" (any case) -> true', () => {
    expect(isAdoStatusActive('active')).toBe(true);
    expect(isAdoStatusActive('Active')).toBe(true);
  });

  test('string "completed"/"abandoned" -> false', () => {
    expect(isAdoStatusActive('completed')).toBe(false);
    expect(isAdoStatusActive('abandoned')).toBe(false);
  });

  test('null/undefined/other types -> false, never throws', () => {
    expect(isAdoStatusActive(null)).toBe(false);
    expect(isAdoStatusActive(undefined)).toBe(false);
    expect(isAdoStatusActive({})).toBe(false);
  });
});
