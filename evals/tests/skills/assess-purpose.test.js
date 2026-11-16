'use strict';

/** Kit test for the `assess-purpose` eval: a good report passes every check; each bad report fails the check it targets. */

const kit = require('../skill-eval-kit');

jest.setTimeout(60000);

const ID = 'assess-purpose';
const REPORT = 'docs/assessment/purpose.md';

const GOOD = `# Repository Purpose Analysis

## Tech Stack

| Aspect | Finding |
|--------|---------|
| Language(s) | JavaScript (Node.js) |
| Ecosystem | npm |
| Build Tool | none (plain node) |
| Package Manager | npm |

### Key Dependencies
| Package | Purpose | Domain Signal |
|---------|---------|---------------|
| express | HTTP API | web service |
| better-sqlite3 | embedded SQLite database | small single-site deployment |
| node-cron | scheduled jobs | daily reminders |
| twilio | SMS | messages owners |

## Inferred Purpose

**Primary Function:** An appointment, patient-record and billing back end for a veterinary clinic, including vaccination reminders to pet owners.

**Domain:** Veterinary practice management (animal healthcare)

**Target Users:** Clinic staff: front-desk receptionists and veterinarians (pet owners only receive text messages)

**Key Capabilities:**
1. Register animals (patients) with their owners (src/routes/patients.js:5).
2. Book appointments with a veterinarian and reject double bookings (src/routes/appointments.js:8).
3. Record vaccinations and list them per patient (src/routes/patients.js:17).
4. Text owners when a vaccination falls due (src/services/reminders.js:6).
5. Invoice an appointment from a fee table (src/services/billing.js:4).

## Evidence

### File Evidence
| File | Line | Significance |
|------|------|--------------|
| src/db.js | 8 | patients table has a species column |
| src/db.js | 10 | vaccinations table with a due date |
| src/routes/appointments.js | 9 | veterinarian booking clash returns 409 |
| src/services/reminders.js | 6 | morning SMS to the owner of each animal due a vaccination |
| package.json | 7 | express, better-sqlite3, node-cron, twilio |

### Code Patterns
| Pattern | Count | Interpretation |
|---------|-------|----------------|
| API routes | 6 | HTTP service |
| Data tables | 5 | clinic entities |

The README.md describes a bakery (Sweet Crumbs); that is stale and unrelated to the code, so it was ignored.

## Confidence Assessment

| Aspect | Confidence | Notes |
|--------|------------|-------|
| Purpose | HIGH | tables, routes and the reminder job all agree |
| Domain | HIGH | species, vaccinations, veterinarian |
| Users | MEDIUM | no roles or auth; staff are inferred from the front-desk comment |

## Unknowns

1. Whether pet owners ever use the API directly, because there is no authentication or role model.
2. How it is deployed or hosted, because there is no Dockerfile or CI configuration.

## Score: 3.5 / B- (the code explains its domain well, but the only document is wrong and there is no deployment information)

## Recommendations

1. Replace README.md with a description of the clinic service and who uses it.
2. Add an architecture doc with the data model and the reminder job schedule.
`;

/** A stub agent that saves \`text\` as the report (and optionally other files). */
const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(REPORT, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const swap = (from, to) => { if (!GOOD.includes(from)) throw new Error(`test bug: ${from} not in GOOD`); return GOOD.replace(from, to); };

describe(`${ID}`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    expect(kit.loadsClean(ID).fixtureDir).toBeTruthy();
  });

  test('a good report passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(['report-saved', 'sections-complete', 'tech-stack', 'purpose-fields', 'domain-inferred', 'stale-readme-not-trusted', 'users-inferred',
      'capabilities-cover', 'evidence-real', 'evidence-domain-lines', 'confidence-assessment', 'unknowns-listed', 'score-format', 'recommendations-docs', 'no-stray-writes']);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every report check and passes only no-stray-writes', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, Object.keys(res).filter((k) => k !== 'no-stray-writes'), /not written/, { only: true });
  });

  test('a stub report, or one with the wrong title, fails report-saved', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('# Repository Purpose Analysis', '# Notes'))), 'report-saved', /title/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves('# Repository Purpose Analysis\n\nA clinic app.\n')), 'report-saved', /only \d+ characters/);
  });

  test('sections out of order, or a missing section, fail sections-complete', async () => {
    const recs = GOOD.slice(GOOD.indexOf('## Recommendations'));
    const moved = GOOD.slice(0, GOOD.indexOf('## Recommendations')).replace('## Tech Stack', `${recs}\n## Tech Stack`);
    kit.expectFails(await kit.runEval(ID, saves(moved)), 'sections-complete', /out of the prescribed order/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('## Unknowns', '## Notes'))), ['sections-complete', 'unknowns-listed'], /missing|no "Unknowns/, { only: true });
  });

  test('a Tech Stack that misses Express, SQLite or most dependencies fails tech-stack', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('| express | HTTP API | web service |\n', ''))), 'tech-stack', /Express/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| better-sqlite3 | embedded SQLite database | small single-site deployment |', '| a database | storage | none |'))), 'tech-stack', /SQLite/, { only: true });
    const few = swap('| node-cron | scheduled jobs | daily reminders |\n| twilio | SMS | messages owners |\n', '');
    kit.expectFails(await kit.runEval(ID, saves(few)), 'tech-stack', /2 of the 4/, { only: true });
  });

  test('a Tech Stack that names no Node.js / JavaScript (node-cron alone does not count) fails tech-stack', async () => {
    const res = await kit.runEval(ID, saves(swap('| Language(s) | JavaScript (Node.js) |', '| Language(s) | scripting |').replace('none (plain node)', 'none')));
    kit.expectFails(res, 'tech-stack', /Node\.js \/ JavaScript/, { only: true });
  });

  test('a capability list of nine items fails purpose-fields', async () => {
    const nine = swap('5. Invoice an appointment from a fee table (src/services/billing.js:4).\n', '5. Invoice an appointment from a fee table (src/services/billing.js:4).\n6. Bill a.\n7. Bill b.\n8. Bill c.\n9. Bill d.\n');
    kit.expectFails(await kit.runEval(ID, saves(nine)), 'purpose-fields', /9 items/, { only: true });
  });

  test('a Primary Function that does not describe clinic operations fails domain-inferred', async () => {
    const res = await kit.runEval(ID, saves(swap('An appointment, patient-record and billing back end for a veterinary clinic, including vaccination reminders to pet owners.', 'A web API.')));
    kit.expectFails(res, 'domain-inferred', /Primary Function/, { only: true });
    const generic = await kit.runEval(ID, saves(swap('An appointment, patient-record and billing back end for a veterinary clinic, including vaccination reminders to pet owners.', 'An appointment and billing back end.')));
    kit.expectFails(generic, 'domain-inferred', /Primary Function/, { only: true });
  });

  test('fewer than five distinct citations, or fewer than three Evidence rows, fail evidence-real', async () => {
    const noTable = GOOD.replace(/^(\| [\w./]+\.(?:js|json) \|) \d+ \|/gm, '$1 - |');
    const three = noTable.replace(' (src/services/billing.js:4)', '').replace(' (src/services/reminders.js:6)', '');
    kit.expectFails(await kit.runEval(ID, saves(three)), 'evidence-real', /only 3 distinct/);
    const fewRows = GOOD.replace(/\| src\/db\.js \| 8 \|[^\n]*\n/, '').replace(/\| src\/db\.js \| 10 \|[^\n]*\n/, '').replace(/\| package\.json \| 7 \|[^\n]*\n/, '');
    kit.expectFails(await kit.runEval(ID, saves(fewRows)), 'evidence-real', /2 table row/);
  });

  test('a stub Unknowns item fails unknowns-listed', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('2. How it is deployed or hosted, because there is no Dockerfile or CI configuration.', '2. Hosting.'))), 'unknowns-listed', /stub/, { only: true });
  });

  test('an Inferred Purpose without the Target Users field, or with too few capabilities, fails purpose-fields', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap(/\*\*Target Users:\*\*[^\n]*\n\n/.exec(GOOD)[0], ''))), ['purpose-fields', 'users-inferred'], undefined, { only: true });
    const two = GOOD.replace(/3\. Record vaccinations[^\n]*\n4\. Text owners[^\n]*\n5\. Invoice[^\n]*\n/, '');
    kit.expectFails(await kit.runEval(ID, saves(two)), ['purpose-fields', 'capabilities-cover'], undefined, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(two)), 'purpose-fields', /2 item/);
  });

  test('a wrong domain fails domain-inferred', async () => {
    const res = await kit.runEval(ID, saves(swap('**Domain:** Veterinary practice management (animal healthcare)', '**Domain:** E-commerce / retail')));
    kit.expectFails(res, 'domain-inferred', /Domain/, { only: true });
  });

  test('a primary function that follows the stale bakery README fails domain-inferred and stale-readme-not-trusted', async () => {
    const res = await kit.runEval(ID, saves(swap('An appointment, patient-record and billing back end for a veterinary clinic, including vaccination reminders to pet owners.', 'Order management for the Sweet Crumbs bakery: bread, pastries and cakes.')));
    kit.expectFails(res, ['domain-inferred', 'stale-readme-not-trusted'], undefined, { only: true });
    kit.expectFails(res, 'stale-readme-not-trusted', /stale README/);
  });

  test('a Domain line that names the bakery as well as the clinic still fails stale-readme-not-trusted unless it calls the README stale', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('(animal healthcare)', '(animal healthcare) and a bakery'))), 'stale-readme-not-trusted', /Domain follows/, { only: true });
  });

  test('target users that are not clinic staff fail users-inferred', async () => {
    const res = await kit.runEval(ID, saves(swap(/\*\*Target Users:\*\*[^\n]*\n/.exec(GOOD)[0], '**Target Users:** Developers and end customers\n')));
    kit.expectFails(res, 'users-inferred', /names no clinic staff/, { only: true });
  });

  test('a capability list that covers only two of the four areas fails capabilities-cover', async () => {
    const res = await kit.runEval(ID, saves(swap(/3\. Record vaccinations[^\n]*\n4\. Text owners[^\n]*\n5\. Invoice[^\n]*\n/.exec(GOOD)[0], '3. Serve a REST API (src/index.js:5).\n')));
    kit.expectFails(res, 'capabilities-cover', /Key Capabilities covers 2 of/, { only: true });
  });

  test('citations of an invented file, or of a line past the end, fail evidence-real', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('src/services/billing.js:4', 'src/services/payments.js:4'))), 'evidence-real', /not in the repository/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('src/services/billing.js:4', 'src/services/billing.js:400'))), 'evidence-real', /has \d+ lines/, { only: true });
  });

  test('a report with no file:line citations fails evidence-real and evidence-domain-lines', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/(\.(?:js|json)):\d+/g, '$1').replace(/^(\| [\w./]+\.(?:js|json) \|) \d+ \|/gm, '$1 - |')));
    kit.expectFails(res, ['evidence-real', 'evidence-domain-lines'], undefined, { only: true });
    kit.expectFails(res, 'evidence-real', /only 0 distinct/);
  });

  test('citations of a single file fail evidence-real', async () => {
    const one = GOOD.replace(/\((?:src\/[A-Za-z/]+\.js):(\d+)\)/g, '(src/db.js:$1)').replace(/\| (?:src\/[A-Za-z/]+\.js|package\.json) \| (\d+) \|/g, '| src/db.js | $1 |').replace('src/db.js:17', 'src/db.js:7').replace('src/db.js:5)', 'src/db.js:3)');
    kit.expectFails(await kit.runEval(ID, saves(one)), 'evidence-real', /cover only 1 distinct file/, { only: true });
  });

  test('citations that are all real but generic (no domain-bearing line) fail evidence-domain-lines only', async () => {
    const generic = GOOD.replace(/\((?:src\/[A-Za-z/]+\.js):(\d+)\)/g, (m, n) => `(src/index.js:${Number(n) % 13 + 1})`).replace(/\| src\/db\.js \| 8 \|/, '| src/index.js | 8 |').replace(/\| src\/db\.js \| 10 \|/, '| src/index.js | 10 |')
      .replace('| src/routes/appointments.js | 9 |', '| src/services/billing.js | 8 |').replace('| src/services/reminders.js | 6 |', '| src/services/billing.js | 9 |');
    kit.expectFails(await kit.runEval(ID, saves(generic)), 'evidence-domain-lines', /no citation lands/, { only: true });
  });

  test('a Confidence Assessment missing a row, or with an unrated row, fails confidence-assessment', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('| Users | MEDIUM | no roles or auth; staff are inferred from the front-desk comment |\n', ''))), 'confidence-assessment', /no Users row/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| Domain | HIGH |', '| Domain | clear |'))), 'confidence-assessment', /Domain row is not rated/, { only: true });
  });

  test('fewer than two Unknowns fails unknowns-listed', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('2. How it is deployed or hosted, because there is no Dockerfile or CI configuration.\n', ''))), 'unknowns-listed', /has 1 numbered/, { only: true });
  });

  test('a bare letter, a mismatched letter and an out-of-range score fail score-format', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('## Score: 3.5 / B- (', '## Score: B- ('))), 'score-format', /not "<1\.0-5\.0> \/ <Letter>"/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('3.5 / B-', '3.5 / B+'))), 'score-format', /scale gives B-/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('3.5 / B-', '6.0 / A'))), 'score-format', /outside 1\.0-5\.0/, { only: true });
  });

  test('recommendations that name no document, or fewer than two, fail recommendations-docs', async () => {
    const vague = swap('1. Replace README.md with a description of the clinic service and who uses it.\n2. Add an architecture doc with the data model and the reminder job schedule.', '1. Write better code.\n2. Refactor the modules.');
    kit.expectFails(await kit.runEval(ID, saves(vague)), 'recommendations-docs', /only 0 recommendation/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('2. Add an architecture doc with the data model and the reminder job schedule.\n', ''))), 'recommendations-docs', /has 1 numbered/, { only: true });
  });

  test('a stray source file, a modified fixture file (the stale README "fixed") and a removed one fail no-stray-writes', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'src/fix.js': 'x\n' })), 'no-stray-writes', /src\/fix\.js/, { only: true });
    const edited = await kit.runEval(ID, (ws) => { ws.write(REPORT, GOOD); ws.write('README.md', '# Pawdesk\n'); });
    kit.expectFails(edited, 'no-stray-writes', /modified/, { only: true });
    kit.expectFails(await kit.runEval(ID, (ws) => { ws.write(REPORT, GOOD); ws.remove('tests/billing-check.js'); }), 'no-stray-writes', /removed/, { only: true });
  });

  test('arms: plain invocation, baseline loads nothing, with-skill loads packages/assessment, same prompt', async () => {
    const ev = kit.loadsClean(ID);
    expect(ev.invocation).toBe('plain');
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/assessment$/);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).not.toMatch(/^\//);
  });
});
