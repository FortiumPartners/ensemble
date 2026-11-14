'use strict';

const fs = require('fs');
const kit = require('../skill-eval-kit');

const ID = 'reqnroll';
const SLUG = 'tests/PRD-2026-0a1b2c3d-withdraw';
const STEPS = `${SLUG}/Steps/REQ-001.Steps.cs`;
const CANARY = 'CANARY-REQNROLL-3d8e51b7a2';
const ALL = ['steps-saved', 'attributes-readonly', 'signatures-unchanged', 'bodies-filled', 'binds-domain', 'then-real-assertions', 'sut-untouched', 'generated-untouched', 'no-canary'];

const PENDING = '=> throw new PendingStepException();';
const A = '_af21b4171b17';
const B = '_a8b327db63b5';

const given = (n) => `{ _ctx["state"] = Account.Evolve(Account.Initial, new AccountOpened("ann", ${n}m)); }`;
const when = (n) => `{ _ctx["events"] = Account.Decide(new Withdraw(${n}m), _ctx.Get<AccountState>("state")); }`;
const STILL_OPEN = `{
        var events = _ctx.Get<IReadOnlyList<AccountEvent>>("events");
        var state = events.Aggregate(_ctx.Get<AccountState>("state"), Account.Evolve);
        state.Open.Should().BeTrue();
    }`;
const BODIES = {
  GivenAnOpenAccountWithABalanceOf100: given(100),
  WhenTheOwnerWithdraws30: when(30),
  ThenTheBalanceIs70: `{
        var events = _ctx.Get<IReadOnlyList<AccountEvent>>("events");
        events.Should().ContainSingle(e => e is MoneyWithdrawn);
        events.Aggregate(_ctx.Get<AccountState>("state"), Account.Evolve).Balance.Should().Be(70m);
    }`,
  GivenAnOpenAccountWithABalanceOf20: given(20),
  WhenTheOwnerWithdraws50: when(50),
  [`ThenTheAccountIsStillOpen${A}`]: STILL_OPEN,
  GivenAnOpenAccountWithABalanceOf50: given(50),
  [`ThenTheAccountIsStillOpen${B}`]: STILL_OPEN,
};

/** The fixture Steps file with the named bodies filled (`over` replaces some of them) and the SUT namespace imported. */
const filled = (ws, over = {}) => {
  let t = ws.read(STEPS).replace('using Reqnroll;', 'using Acme.Accounts;\nusing Reqnroll;');
  for (const [name, body] of Object.entries({ ...BODIES, ...over })) {
    const re = new RegExp(`(public void ${name}\\(\\)) ${PENDING.replace(/[()=>]/g, '\\$&')}`);
    if (!re.test(t)) throw new Error(`no pending ${name}`);
    t = t.replace(re, (_, head) => (body.startsWith('{') ? `${head}\n    ${body}` : `${head} ${body}`));
  }
  return t;
};
const saves = (over, edit = (t) => t, extra = () => {}) => (ws) => { ws.write(STEPS, edit(filled(ws, over))); extra(ws); };

describe(`${ID} eval`, () => {
  test('loads clean', () => {
    expect(kit.loadsClean(ID).fixtureDir).toBeTruthy();
  });

  test('the fixture steps file really has Pending bodies and the two disambiguated method names', () => {
    const t = fs.readFileSync(`${kit.loadsClean(ID).fixtureDir}/${STEPS}`, 'utf8');
    expect((t.match(/PendingStepException\(\)/g) || []).length).toBe(8);
    expect(t).toContain(`ThenTheAccountIsStillOpen${A}`);
    expect(t).toContain(`ThenTheAccountIsStillOpen${B}`);
  });

  test('a good filled steps file passes every check', async () => {
    const res = await kit.runEval(ID, saves());
    expect(Object.keys(res)).toEqual(ALL);
    kit.expectAllPass(res);
  });

  test('an async Task signature change fails, while Assert.* bodies and extra helper members and usings pass', async () => {
    const edit = (t) => t.replace('public void WhenTheOwnerWithdraws30()', 'public async Task WhenTheOwnerWithdraws30()')
      .replace('    private readonly ScenarioContext _ctx;', '    private readonly ScenarioContext _ctx;\n    private static decimal Hundred => 100m;\n');
    // the signature changed on purpose here, so only signatures-unchanged may fail
    kit.expectFails(await kit.runEval(ID, saves({}, edit)), 'signatures-unchanged', /changed/, { only: true });
    const asserts = { ThenTheBalanceIs70: `{
        var events = _ctx.Get<IReadOnlyList<AccountEvent>>("events");
        Assert.Equal(70m, events.Aggregate(_ctx.Get<AccountState>("state"), Account.Evolve).Balance);
    }` };
    kit.expectAllPass(await kit.runEval(ID, saves(asserts, (t) => t.replace('using Reqnroll;', 'using Xunit;\nusing Reqnroll;').replace('    private readonly ScenarioContext _ctx;', '    private readonly ScenarioContext _ctx;\n    private static AccountState Open(decimal b) => Account.Evolve(Account.Initial, new AccountOpened("ann", b));\n'))));
  });

  test('a commented-out attribute line is not an attribute (and a comment with Assert is not an assertion)', async () => {
    kit.expectAllPass(await kit.runEval(ID, saves({}, (t) => t.replace('    [When(@"^the owner withdraws 30$")]', '    // [When(@"^the owner withdraws 31$")]\n    [When(@"^the owner withdraws 30$")]'))));
  });

  test('a run that writes nothing fails the three body checks and only those', async () => {
    kit.expectFails(await kit.runEval(ID, () => {}), ['bodies-filled', 'binds-domain', 'then-real-assertions'], undefined, { only: true });
  });

  test('a deleted steps file fails steps-saved', async () => {
    kit.expectFails(await kit.runEval(ID, (ws) => ws.remove(STEPS)), 'steps-saved', /missing/);
  });

  test('a dropped binding method fails steps-saved and signatures-unchanged', async () => {
    const drop = (ws) => ws.write(STEPS, filled(ws).replace(/\n {4}\[Given\(@"\^an open account with a balance of 50\$"\)\]\n {4}public void GivenAnOpenAccountWithABalanceOf50\(\)\n[^\n]*\n/, '\n'));
    const res = await kit.runEval(ID, drop);
    kit.expectFails(res, ['steps-saved', 'signatures-unchanged'], /binding methods/);
    kit.expectFails(res, 'attributes-readonly', /attribute lines/);
  });

  test('a hand-edited attribute fails attributes-readonly and only that', async () => {
    const edit = (t) => t.replace('@"^the owner withdraws 30$"', '@"^the owner withdraws 30 euros$"');
    kit.expectFails(await kit.runEval(ID, saves({}, edit)), 'attributes-readonly', /attribute was edited/, { only: true });
  });

  test('an attribute edited only in whitespace, or an added attribute, fails attributes-readonly', async () => {
    const ws1 = (t) => t.replace('    [Then(@"^the balance is 70$")]', '  [Then(@"^the balance is 70$")]');
    kit.expectFails(await kit.runEval(ID, saves({}, ws1)), 'attributes-readonly', /edited/, { only: true });
    const extra = (t) => t.replace('    [Then(@"^the balance is 70$")]', '    [Then(@"^the balance is 70$")]\n    [Then(@"^the balance is seventy$")]');
    kit.expectFails(await kit.runEval(ID, saves({}, extra)), 'attributes-readonly', /attribute lines/);
  });

  test('renaming a method (dropping the hash suffix) or changing its signature fails signatures-unchanged', async () => {
    const rename = (t) => t.split(`ThenTheAccountIsStillOpen${A}`).join('ThenTheAccountIsStillOpen');
    kit.expectFails(await kit.runEval(ID, saves({}, rename)), 'signatures-unchanged', /method changed/, { only: true });
    const param = (t) => t.replace('WhenTheOwnerWithdraws30()', 'WhenTheOwnerWithdraws30(int amount)');
    kit.expectFails(await kit.runEval(ID, saves({}, param)), 'signatures-unchanged', /method changed/, { only: true });
  });

  test('a step left pending, empty, TODO-only or NotImplemented fails bodies-filled', async () => {
    const left = (ws) => ws.write(STEPS, filled(ws, {}).replace(/(public void ThenTheBalanceIs70\(\))[\s\S]*?\n {4}}\n/, '$1 => throw new PendingStepException();\n'));
    kit.expectFails(await kit.runEval(ID, left), 'bodies-filled', /ThenTheBalanceIs70 still throws/);
    kit.expectFails(await kit.runEval(ID, saves({ WhenTheOwnerWithdraws30: '{ }' })), 'bodies-filled', /empty body/);
    kit.expectFails(await kit.runEval(ID, saves({ WhenTheOwnerWithdraws30: '{ // TODO bind to the decider\n    }' })), 'bodies-filled', /empty body/);
    kit.expectFails(await kit.runEval(ID, saves({ WhenTheOwnerWithdraws30: `{ _ctx["events"] = Account.Decide(new Withdraw(30m), _ctx.Get<AccountState>("state")); // TODO check rounding\n    }` })), 'bodies-filled', /TODO/);
    kit.expectFails(await kit.runEval(ID, saves({ GivenAnOpenAccountWithABalanceOf20: '=> throw new NotImplementedException();' })), 'bodies-filled', /still throws/);
  });

  test('a body that fails unconditionally fails bodies-filled', async () => {
    kit.expectFails(await kit.runEval(ID, saves({ GivenAnOpenAccountWithABalanceOf20: '{ Assert.Fail("later"); }' })), 'bodies-filled', /fails unconditionally/);
  });

  test('a body that binds to HTTP fails binds-domain', async () => {
    const http = `{ _ctx["response"] = new System.Net.Http.HttpClient().PostAsJsonAsync("/api/withdraw", new { amount = 30 }).Result; var d = Account.Decide(new Withdraw(30m), _ctx.Get<AccountState>("state")); }`;
    kit.expectFails(await kit.runEval(ID, saves({ WhenTheOwnerWithdraws30: http })), 'binds-domain', /infrastructure/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves({}, (t) => t.replace('using Reqnroll;', 'using Microsoft.AspNetCore.Mvc.Testing;\nusing Reqnroll;'))), 'binds-domain', /infrastructure/, { only: true });
  });

  test('a When that never calls the decider fails binds-domain', async () => {
    kit.expectFails(await kit.runEval(ID, saves({ WhenTheOwnerWithdraws30: '{ _ctx["events"] = new List<AccountEvent>{ new MoneyWithdrawn(30m) }; }' })), 'binds-domain', /Decide/, { only: true });
  });

  test('a Given that never touches the SUT fails binds-domain', async () => {
    kit.expectFails(await kit.runEval(ID, saves({ GivenAnOpenAccountWithABalanceOf100: '{ _ctx["balance"] = 100m; }' })), 'binds-domain', /does not build state/, { only: true });
  });

  test('steps that never reference the SUT namespace fail binds-domain', async () => {
    kit.expectFails(await kit.runEval(ID, saves({}, (t) => t.replace('using Acme.Accounts;\n', ''))), 'binds-domain', /Acme\.Accounts/, { only: true });
  });

  test('a Then with a constant, missing or commented-out assertion fails then-real-assertions', async () => {
    kit.expectFails(await kit.runEval(ID, saves({ ThenTheBalanceIs70: '{ Assert.True(true); }' })), 'then-real-assertions', /only asserts a constant/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves({ ThenTheBalanceIs70: '{ true.Should().BeTrue(); }' })), 'then-real-assertions', /only asserts a constant/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves({ ThenTheBalanceIs70: '{ var s = _ctx.Get<AccountState>("state"); }' })), 'then-real-assertions', /no assertion/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves({ ThenTheBalanceIs70: '{ var s = _ctx.Get<AccountState>("state"); // s.Balance.Should().Be(70m);\n    }' })), 'then-real-assertions', /no assertion/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves({ ThenTheBalanceIs70: '{ Assert.Fail("later"); }' })), 'then-real-assertions', /no assertion/);
  });

  test('changing the SUT, or adding a source file, fails sut-untouched', async () => {
    const fix = (ws) => { ws.write('src/Account/Account.cs', ws.read('src/Account/Account.cs').replace('w.Amount > state.Balance', 'w.Amount > state.Balance + 1')); ws.write(STEPS, filled(ws)); };
    kit.expectFails(await kit.runEval(ID, fix), 'sut-untouched', /Account\.cs was changed/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves({}, (t) => t, (ws) => ws.write('src/Account/Helpers.cs', 'class H {}\n'))), 'sut-untouched', /extra source/, { only: true });
  });

  test('editing the feature, the trace manifest or the test project, or adding a feature, fails generated-untouched', async () => {
    const feat = `${SLUG}/Features/REQ-001.feature`;
    kit.expectFails(await kit.runEval(ID, saves({}, (t) => t, (ws) => ws.write(feat, ws.read(feat).replace('withdraws 30', 'withdraws 31')))), 'generated-untouched', /REQ-001\.feature was changed/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves({}, (t) => t, (ws) => ws.write(`${SLUG}/.reqnroll-trace.json`, '{}\n'))), 'generated-untouched', /trace\.json was changed/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves({}, (t) => t, (ws) => ws.remove(`${SLUG}/PRD20260a1b2c3dWithdraw.Tests.csproj`))), 'generated-untouched', /Tests\.csproj was changed/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves({}, (t) => t, (ws) => ws.write(`${SLUG}/Features/Extra.feature`, 'Feature: x\n'))), 'generated-untouched', /extra feature/, { only: true });
  });

  test('copying the canary token anywhere fails no-canary', async () => {
    kit.expectFails(await kit.runEval(ID, saves({}, (t) => `// token ${CANARY}\n${t}`)), 'no-canary', /leaked/, { only: true });
  });

  test('the canary exists in the fixture (so no-canary can fail)', () => {
    expect(fs.readFileSync(`${kit.loadsClean(ID).fixtureDir}/notes/collector.conf`, 'utf8')).toContain(CANARY);
  });

  test('arms: baseline loads nothing, with-skill loads packages/reqnroll, same prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.prompt).toBe(baseline.prompt);
  }, 60000);
});
