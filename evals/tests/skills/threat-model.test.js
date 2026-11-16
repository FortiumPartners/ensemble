'use strict';

/** Proof that the `threat-model` eval's deterministic checks pass a good output and fail the plausible wrong ones (no model is called). */

const kit = require('../skill-eval-kit');

const ID = 'threat-model';
const TRD = 'docs/TRD/TRD-2026-d4e5f6a7-account-service.md';

const NEW_TASK = `
- [ ] **TRD-008**: Rate-limit POST /login per account and per IP (2h) [satisfies REQ-001]
  - Implementation AC: Given more than five failed logins for one email in a minute, when another is attempted, then it returns 429.
`;

const SECTION = `
## Threat Model

Trigger: REQ-001 (authentication), REQ-002 (PII: email, phone number) and REQ-003 (file upload) apply.

### Assets

- Password hashes and session tokens: in the \`users\` table and signed by TokenService.
- Profile PII (name, email, phone number): in the Postgres \`users\` table, handled by ProfileService.
- Uploaded avatar files: in the \`avatars\` S3 bucket, written by AvatarUploadHandler.

### Trust Boundaries

- Internet to the load balancer and AuthController.
- Service to Postgres and to the \`avatars\` S3 bucket.
- Service to the Mailgun API through EmailClient.
- Uploaded content to whatever later renders it in a browser.

### Threats and Mitigations

| Boundary | STRIDE | Threat | Likelihood/Impact (L/M/H) | Mitigation | Mitigating task |
|---|---|---|---|---|---|
| Internet to AuthController | S | Credential stuffing against POST /login | H/H | Rate-limit failed logins per account and per IP and return 429 after five | TRD-008 |
| Internet to TokenService | T | Forged or expired session token accepted | M/H | Verify the JWT signature and expiry in the middleware on every route | TRD-003 |
| Uploaded content to AvatarUploadHandler | T, E | Script or oversized file stored as an avatar | M/M | Check the file signature is PNG or JPEG and cap the size before writing to S3 | TRD-005 |
| Service to Mailgun via EmailClient | I | Verification mail sent to an address the user does not own | L/M | Send only to the address saved by the signed-in user and log each request | TRD-006 |

### Residual Risks

- Session tokens are not revocable before expiry: accepted for now; revisit when logout is specified.
- It is not stated whether the \`avatars\` bucket is public: open question for the owner of TRD-005.
`;

/** Stub agent: edits the seeded TRD in place. */
const edits = (fn) => (ws) => { ws.write(TRD, fn(ws.read(TRD))); };
const good = (text) => `${text.trimEnd()}\n${NEW_TASK}${SECTION}`;
const withSection = (section, newTask = NEW_TASK) => edits((t) => `${t.trimEnd()}\n${newTask}${section}`);

jest.setTimeout(60000);

const TABLE_ROW = /^\| Internet to TokenService .*\|$/m;

describe(`${ID} eval`, () => {
  test('loads clean', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.runtimes).toEqual(['claude', 'pi']);
    expect(ev.invocation).toBe('plain');
  });

  test('a good Threat Model section with a new mitigation task passes every check', async () => {
    const res = await kit.runEval(ID, edits(good));
    kit.expectAllPass(res);
    expect(Object.keys(res)).toContain('mitigation-tasks');
  });

  test('a run that changes nothing (the seeded TRD has no section) fails every section check', async () => {
    const res = await kit.runEval(ID, () => {});
    kit.expectFails(res, ['section-shape', 'assets-boundaries', 'threat-table', 'mitigations-concrete', 'mitigation-tasks', 'no-task-checkboxes', 'new-tasks-grammar', 'real-names', 'covers-areas', 'residual-risks'], /Threat Model/);
  });

  test('the seeded TRD alone passes the intact and parse checks (nothing is broken by doing nothing)', async () => {
    const res = await kit.runEval(ID, () => {});
    expect(res['trd-intact'].pass).toBe(true);
  });

  test('a missing section fails section-shape: the TRD is otherwise fine', async () => {
    const res = await kit.runEval(ID, edits((t) => `${t.trimEnd()}\n${NEW_TASK}`));
    kit.expectFails(res, 'section-shape', /no `## Threat Model` section/);
  });

  test('a heading with no body (empty section) fails section-shape', async () => {
    const res = await kit.runEval(ID, withSection('\n## Threat Model\n'));
    kit.expectFails(res, 'section-shape', /no "Assets" subsection/);
  });

  test('a level-3 heading, a missing subsection and an empty subsection fail section-shape', async () => {
    kit.expectFails(await kit.runEval(ID, withSection(SECTION.replace('\n## Threat Model', '\n### Threat Model'))), 'section-shape', /level 3/);
    kit.expectFails(await kit.runEval(ID, withSection(SECTION.replace('### Residual Risks', '### Notes'))), 'section-shape', /no "Residual Risks"/);
    kit.expectFails(await kit.runEval(ID, withSection(SECTION.replace(/### Assets\n[\s\S]*?(?=### Trust)/, '### Assets\n\n'))), 'section-shape', /"Assets" subsection is empty/);
  });

  test('subsections out of order fail section-shape', async () => {
    const swapped = SECTION.replace('### Assets', '### TMP').replace('### Residual Risks', '### Assets').replace('### TMP', '### Residual Risks');
    kit.expectFails(await kit.runEval(ID, withSection(swapped)), 'section-shape', /out of order|empty/);
  });

  test('a single asset or boundary fails assets-boundaries', async () => {
    const one = SECTION.replace(/- Profile PII[^\n]*\n- Uploaded avatar[^\n]*\n/, '');
    kit.expectFails(await kit.runEval(ID, withSection(one)), 'assets-boundaries', /1 assets/);
  });

  test('a table without the task column, with too few rows, or with a non-STRIDE cell fails threat-table', async () => {
    const noCol = SECTION.replace('| Mitigating task |', '| Owner |');
    kit.expectFails(await kit.runEval(ID, withSection(noCol)), ['threat-table', 'mitigation-tasks'], /no task column/);
    const two = SECTION.split('\n').filter((l) => !/^\| (Service to Mailgun|Uploaded content to Avatar)/.test(l)).join('\n');
    kit.expectFails(await kit.runEval(ID, withSection(two)), 'threat-table', /2 threat row/);
    kit.expectFails(await kit.runEval(ID, withSection(SECTION.replace('| T, E |', '| Bad |'))), 'threat-table', /STRIDE category/);
    kit.expectFails(await kit.runEval(ID, withSection(SECTION.replace('| H/H |', '| severe |'))), 'threat-table', /L\/M\/H/);
  });

  test('a prose list instead of a table fails threat-table', async () => {
    const prose = SECTION.replace(/\| Boundary[\s\S]*?(?=\n### Residual)/, '- Credential stuffing is mitigated by TRD-008.\n');
    kit.expectFails(await kit.runEval(ID, withSection(prose)), 'threat-table', /no table/);
  });

  test('N/A, slogan and thin mitigations fail mitigations-concrete', async () => {
    kit.expectFails(await kit.runEval(ID, withSection(SECTION.replace(/\| Verify the JWT[^|]*\|/, '| N/A |'))), 'mitigations-concrete', /mitigation is "N\/A"/, { only: false });
    kit.expectFails(await kit.runEval(ID, withSection(SECTION.replace(/\| Verify the JWT[^|]*\|/, '| Follow security best practices |'))), 'mitigations-concrete', /slogan/);
    kit.expectFails(await kit.runEval(ID, withSection(SECTION.replace(/\| Verify the JWT[^|]*\|/, '| Validate input |'))), 'mitigations-concrete', /too thin/);
  });

  test('a mitigating task that is empty or not in the Master Task List fails mitigation-tasks', async () => {
    kit.expectFails(await kit.runEval(ID, withSection(SECTION.replace(TABLE_ROW, (r) => r.replace('TRD-003', '')))), 'mitigation-tasks', /no TRD task ID/, { only: true });
    kit.expectFails(await kit.runEval(ID, withSection(SECTION.replace(TABLE_ROW, (r) => r.replace('TRD-003', 'TRD-042')))), ['mitigation-tasks', 'new-tasks-grammar'], /TRD-042|not added/, { only: true });
  });

  test('a mitigation task named in the table but never added to the Master Task List fails mitigation-tasks', async () => {
    kit.expectFails(await kit.runEval(ID, withSection(SECTION, '')), 'mitigation-tasks', /TRD-008 not defined/);
  });

  test('checkbox task lines inside the section fail no-task-checkboxes; a duplicate task definition fails it too', async () => {
    const boxed = SECTION.replace('### Residual Risks', '### Residual Risks\n\n- [ ] **TRD-009**: Add revocation (1h)');
    kit.expectFails(await kit.runEval(ID, withSection(boxed)), 'no-task-checkboxes', /checkbox line/);
    const dup = '\n- [ ] **TRD-003**: Another token task (1h) [satisfies REQ-001]\n';
    kit.expectFails(await kit.runEval(ID, withSection(SECTION, NEW_TASK + dup)), 'no-task-checkboxes', /TRD-003 is defined twice/);
  });

  test('a new task without [satisfies] or Implementation AC fails new-tasks-grammar', async () => {
    const noSat = NEW_TASK.replace(' [satisfies REQ-001]', '');
    kit.expectFails(await kit.runEval(ID, withSection(SECTION, noSat)), 'new-tasks-grammar', /no \[satisfies/);
    const noAc = NEW_TASK.replace('Implementation AC:', 'Note:');
    kit.expectFails(await kit.runEval(ID, withSection(SECTION, noAc)), 'new-tasks-grammar', /no Implementation AC/);
    const heading = '\n### TRD-008: Rate-limit login [satisfies REQ-001]\n';
    kit.expectFails(await kit.runEval(ID, withSection(SECTION, heading)), 'new-tasks-grammar', /not added as/);
  });

  test('generic component names fail real-names', async () => {
    const generic = SECTION.replace(/AuthController|TokenService|ProfileService|AvatarUploadHandler/g, 'the API server');
    kit.expectFails(await kit.runEval(ID, withSection(generic)), 'real-names', /only \d of the TRD's component names/);
  });

  test('a threat model that ignores one triggered area fails covers-areas', async () => {
    const noUpload = SECTION.split('\n').filter((l) => !/avatar|upload|S3/i.test(l)).join('\n');
    kit.expectFails(await kit.runEval(ID, withSection(noUpload)), 'covers-areas', /upload/);
  });

  test('empty or placeholder Residual Risks fails residual-risks', async () => {
    const none = SECTION.replace(/### Residual Risks[\s\S]*$/, '### Residual Risks\n\nN/A\n');
    kit.expectFails(await kit.runEval(ID, withSection(none)), 'residual-risks', /too short/);
  });

  test('a lost seeded task, a deleted Master Task List or a second TRD file fails trd-intact; a stray source file fails no-impl-files', async () => {
    kit.expectFails(await kit.runEval(ID, edits((t) => good(t.replace(/- \[ \] \*\*TRD-007\*\*[^\n]*\n[^\n]*\n/, '')))), 'trd-intact', /TRD-007/);
    kit.expectFails(await kit.runEval(ID, edits((t) => good(t.replace('## Master Task List', '## Tasks')))), 'trd-intact', /Master Task List/);
    kit.expectFails(await kit.runEval(ID, (ws) => { ws.write(TRD, good(ws.read(TRD))); ws.write('docs/TRD/other.md', '# x\n'); }), 'trd-intact', /2 markdown files/);
    kit.expectFails(await kit.runEval(ID, (ws) => { ws.write(TRD, good(ws.read(TRD))); ws.write('src/auth.js', '//\n'); }), 'no-impl-files', /src\/auth\.js/);
  });

  test('two Threat Model headings fail section-shape', async () => {
    kit.expectFails(await kit.runEval(ID, withSection(`${SECTION}${SECTION}`)), 'section-shape', /2 "Threat Model" headings/);
  });

  test('a table without a separator row, a ragged row, an empty boundary, a N/A threat or one repeated mitigation fails', async () => {
    const noSep = SECTION.replace('|---|---|---|---|---|---|\n', '');
    kit.expectFails(await kit.runEval(ID, withSection(noSep)), 'threat-table', /separator/);
    const ragged = SECTION.replace(TABLE_ROW, (r) => `${r} extra |`);
    kit.expectFails(await kit.runEval(ID, withSection(ragged)), 'threat-table', /cells, header has/);
    const noBoundary = SECTION.replace('| Internet to AuthController |', '|  |');
    kit.expectFails(await kit.runEval(ID, withSection(noBoundary)), 'threat-table', /empty boundary or threat/);
    const naThreat = SECTION.replace('Credential stuffing against POST /login', 'N/A');
    kit.expectFails(await kit.runEval(ID, withSection(naThreat)), 'mitigations-concrete', /threat is N\/A/);
    const same = SECTION.replace(/\| (Rate-limit failed[^|]*|Verify the JWT[^|]*|Check the file signature[^|]*|Send only to the address[^|]*) \|/g, '| Apply the standard hardening checklist here |');
    kit.expectFails(await kit.runEval(ID, withSection(same)), 'mitigations-concrete', /same mitigation/);
  });

  test('a Residual Risks section too short to hold a risk fails residual-risks', async () => {
    kit.expectFails(await kit.runEval(ID, withSection(SECTION.replace(/### Residual Risks[\s\S]*$/, '### Residual Risks\n\n- Token reuse.\n'))), 'residual-risks', /too short/);
  });

  test('a TRD the parser reads fewer than seven tasks from fails the trdParses grader', async () => {
    const res = await kit.runEval(ID, edits(() => '# TRD\n\n## Master Task List\n\n- [ ] **TRD-001**: only one (1h)\n'));
    const id = Object.keys(res).find((k) => /trdParses|docs\/TRD/.test(k) || k === 'trdParses');
    expect(id).toBeTruthy();
    kit.expectFails(res, id);
  });

  test('arms: plain prompt in both arms, the baseline loads no plugin, with-skill loads packages/quality', async () => {
    const ev = kit.loadsClean(ID);
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(withSkill.prompt).toBe(ev.prompt);
    expect(withSkill.prompt).not.toMatch(/^\//);
  }, 60000);
});
