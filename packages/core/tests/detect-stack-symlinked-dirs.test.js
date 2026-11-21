'use strict';

/**
 * A project whose `Controllers/` and `Pages/` directories are symbolic links (a monorepo sharing
 * them from one location) must score the same with the skill's own matcher as it does with the
 * npm `glob` package. The shipped patterns `Controllers/*.cs` and `Pages/*.razor` name those
 * directories literally, and the package descends a link named that way. A matcher that skipped
 * every link left the .NET and Blazor evidence at two files each and flipped the top candidate.
 *
 * It lives here and not in the skill's own __tests__ because it requires the npm package, a dev
 * dependency of the repository that the installed bundle does not have.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDirs = [];

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function linkedProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-stack-links-'));
  tempDirs.push(root);
  const project = path.join(root, 'project');
  const shared = path.join(root, 'shared');
  fs.mkdirSync(path.join(shared, 'Controllers'), { recursive: true });
  fs.mkdirSync(path.join(shared, 'Pages'), { recursive: true });
  fs.mkdirSync(project);
  fs.writeFileSync(
    path.join(project, 'App.csproj'),
    '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>'
  );
  fs.writeFileSync(
    path.join(shared, 'Controllers', 'HomeController.cs'),
    'using Microsoft.AspNetCore.Mvc;\n[ApiController]\n[Route("api")]\npublic class HomeController : ControllerBase {}\n'
  );
  fs.writeFileSync(path.join(shared, 'Pages', 'Index.razor'), '@page\n<h1>Hi</h1>\n');
  fs.symlinkSync(path.join(shared, 'Controllers'), path.join(project, 'Controllers'));
  fs.symlinkSync(path.join(shared, 'Pages'), path.join(project, 'Pages'));
  return project;
}

/** detect-stack with the npm `glob` package standing in for the skill's matcher. */
function detectWithPackage() {
  let loaded;
  jest.isolateModules(() => {
    jest.doMock('../skills/detect-stack/glob', () => ({ glob: require('glob').glob }));
    loaded = require('../skills/detect-stack/detect-stack');
  });
  return loaded.detect;
}

describe('detect-stack on a project with symlinked directories', () => {
  const project = linkedProject();

  test('the framework axis scores exactly as it does with the npm glob package', async () => {
    const { detect } = require('../skills/detect-stack/detect-stack');
    const mine = await detect('framework', project, {});
    const theirs = await detectWithPackage()('framework', project, {});
    expect(mine.all_results).toEqual(theirs.all_results);
    expect(mine.all_results.length).toBeGreaterThan(0);
  });

  test('the linked directories count: both frameworks keep their three files of evidence', async () => {
    const { detect } = require('../skills/detect-stack/detect-stack');
    const { all_results: scored } = await detect('framework', project, {});
    const byName = Object.fromEntries(scored.map((entry) => [entry.name, entry]));
    expect(byName.blazor.details.files.matches).toBe(3);
    expect(byName.dotnet.details.files.matches).toBe(3);
    expect(scored[0].name).toBe('blazor');
  });
});
