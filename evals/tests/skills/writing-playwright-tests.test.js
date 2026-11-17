'use strict';

const kit = require('../skill-eval-kit');

jest.setTimeout(60000);

const ID = 'writing-playwright-tests';
const SPEC = 'tests/contact.spec.ts';
const PAGE = 'pages/contact.page.ts';
const HTML = 'public/contact.html';
const CANARY = 'CANARY-PWTESTS-5b8e2d94c1';

const GOOD_PAGE = `import { expect, Page, Locator } from '@playwright/test';

// The contact form page object: locators live here, tests read like the user's steps.
export class ContactPage {
  readonly page: Page;
  readonly nameInput: Locator;
  readonly emailInput: Locator;
  readonly messageInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;
  readonly successMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nameInput = page.getByLabel('Name');
    this.emailInput = page.getByLabel('Email address');
    this.messageInput = page.getByLabel('Message');
    this.submitButton = page.getByTestId('contact-form-submit');
    this.errorMessage = page.getByTestId('contact-form-error');
    this.successMessage = page.getByRole('status');
  }

  async goto() {
    await this.page.goto('/contact.html');
  }

  async fillAndSubmit(name: string, email: string, message: string) {
    await this.nameInput.fill(name);
    await this.emailInput.fill(email);
    await this.messageInput.fill(message);
    await this.submitButton.click();
  }

  async expectError(text: string | RegExp) {
    await expect(this.errorMessage).toContainText(text);
  }
}
`;

const GOOD_SPEC = `import { test, expect } from '@playwright/test';
import { ContactPage } from '../pages/contact.page';

test.describe('Contact form', () => {
  let contact: ContactPage;

  test.beforeEach(async ({ page }) => {
    contact = new ContactPage(page);
    await contact.goto();
  });

  test('submitting the empty form shows the required fields error', async () => {
    await contact.submitButton.click();

    await expect(contact.errorMessage).toBeVisible();
    await expect(contact.errorMessage).toHaveText('Please fill in all required fields.');
    await expect(contact.successMessage).toBeHidden();
  });

  test('a filled form shows the thank you message', async () => {
    await contact.fillAndSubmit('Ada', 'ada@example.com', 'Hello there');

    await expect(contact.successMessage).toContainText('Thank you');
    await expect(contact.errorMessage).toBeHidden();
  });
});
`;

const saves = (spec, page, extra = {}) => (ws) => {
  if (spec !== null) ws.write(SPEC, spec);
  if (page !== null) ws.write(PAGE, page);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const run = (spec, page = GOOD_PAGE, extra) => kit.runEval(ID, saves(spec, page, extra));
const swap = (text, from, to) => { expect(text).toContain(from); return text.replace(from, to); };

const IDS = ['files-saved', 'page-object', 'selector-hierarchy', 'no-fixed-sleeps', 'web-first-assertions', 'real-assertions', 'test-ids', 'empty-submit-covered', 'relative-urls', 'fixture-untouched', 'no-canary'];
const OUTPUT_IDS = IDS.slice(0, 9);

describe(`${ID} eval`, () => {
  test('loads clean', () => {
    expect(kit.loadsClean(ID).fixtureDir).toBeTruthy();
  });

  test('a good spec and page object pass every check', async () => {
    const res = await run(GOOD_SPEC);
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('a good run that adds conventional data-testid attributes to the HTML passes', async () => {
    const html = (ws) => ws.read(HTML).replace('<div id="form-ok"', '<div data-testid="contact-form-success" id="form-ok"');
    const res = await kit.runEval(ID, (ws) => {
      ws.write(HTML, html(ws));
      ws.write(SPEC, GOOD_SPEC);
      ws.write(PAGE, GOOD_PAGE.replace("page.getByRole('status')", "page.getByTestId('contact-form-success')"));
    });
    kit.expectAllPass(res);
  });

  test('a good run that asserts through a page-object method and a regex passes', async () => {
    const spec = GOOD_SPEC.replace("await expect(contact.errorMessage).toBeVisible();\n    await expect(contact.errorMessage).toHaveText('Please fill in all required fields.');\n    await expect(contact.successMessage).toBeHidden();", 'await contact.expectError(/required fields/i);');
    kit.expectAllPass(await run(spec));
  });

  test('a run that writes nothing fails every output check and only those', async () => {
    const res = await kit.runEval(ID, () => {});
    kit.expectFails(res, OUTPUT_IDS, /not written/, { only: true });
  });

  test('a missing page object or spec fails files-saved', async () => {
    kit.expectFails(await run(GOOD_SPEC, null), 'files-saved', /pages\/contact\.page\.ts was not written/);
    kit.expectFails(await run(null), 'files-saved', /tests\/contact\.spec\.ts was not written/);
  });

  test('a page object that is not a class of Locators fails page-object', async () => {
    const funcs = "import { Page } from '@playwright/test';\nexport const goto = (page: Page) => page.goto('/contact.html');\n";
    kit.expectFails(await run(GOOD_SPEC, funcs), 'page-object', /does not export a class/);
    const thin = GOOD_PAGE.replace("page.getByLabel('Name')", "'x' as any").replace("page.getByLabel('Email address')", "'x' as any").replace("page.getByLabel('Message')", "'x' as any").replace("page.getByRole('status')", "'x' as any");
    kit.expectFails(await run(GOOD_SPEC, thin), 'page-object', /locator definitions/);
  });

  test('a page object that never mentions the Locator type fails page-object', async () => {
    const untyped = GOOD_PAGE.replace(', Locator', '').replace(/: Locator/g, '');
    kit.expectFails(await run(GOOD_SPEC, untyped), 'page-object', /never mentions the Locator type/, { only: true });
  });

  test('a spec that does not import or use the page object fails page-object', async () => {
    const noImport = swap(GOOD_SPEC, "import { ContactPage } from '../pages/contact.page';\n", '');
    kit.expectFails(await run(noImport), 'page-object', /does not import/);
    const unused = swap(GOOD_SPEC, 'contact = new ContactPage(page);', 'contact = undefined as never;');
    kit.expectFails(await run(unused), 'page-object', /never instantiates ContactPage/);
  });

  test('brittle class, nth-child, child-combinator and XPath locators fail selector-hierarchy', async () => {
    const withLoc = (sel) => swap(GOOD_PAGE, "page.getByTestId('contact-form-submit')", `page.locator('${sel}')`);
    for (const [sel, why] of [['.btn-primary', /class/], ['button.submit-form', /class/], ['li:nth-child(2)', /nth-child/], ['div.row > div:nth-child(2) input', /nth-child|child/], ['../sibling', /XPath/], ['form > button', /child combinator/], ['//button[@type="submit"]', /XPath/], ['xpath=//button', /XPath/]]) {
      kit.expectFails(await run(GOOD_SPEC, withLoc(sel)), 'selector-hierarchy', why, { only: true });
    }
    const inSpec = swap(GOOD_SPEC, "await contact.submitButton.click();", "await page.locator('.btn-primary').click();").replace('async () => {\n    await page', 'async ({ page }) => {\n    await page');
    kit.expectFails(await run(inSpec), 'selector-hierarchy', /\.btn-primary/);
  });

  test('stable locators, comments and strings that merely mention brittle selectors still pass selector-hierarchy', async () => {
    const ok = GOOD_PAGE.replace("page.getByRole('status')", "page.locator('#form-ok')").replace('// The contact form page object', "// not page.locator('.btn-primary') or '//div' or nth-child\n  // The contact form page object")
      .replace("page.getByLabel('Message')", "page.locator('[data-testid=\"x.y\"]')");
    kit.expectAllPass(await run(GOOD_SPEC, ok));
  });

  test('fewer than three getByTestId/getByRole/getByLabel locators fail selector-hierarchy', async () => {
    const weak = GOOD_PAGE.replace("page.getByLabel('Name')", "page.locator('#f-name')").replace("page.getByLabel('Email address')", "page.locator('#f-email')").replace("page.getByLabel('Message')", "page.locator('#f-msg')").replace("page.getByRole('status')", "page.getByText('Thank you')");
    kit.expectFails(await run(GOOD_SPEC, weak), 'selector-hierarchy', /only 2/, { only: true });
  });

  test('waitForTimeout and other fixed sleeps fail no-fixed-sleeps, a comment about them does not', async () => {
    const sleepy = swap(GOOD_SPEC, 'await contact.submitButton.click();', 'await contact.submitButton.click();\n    await contact.page.waitForTimeout(1000);');
    kit.expectFails(await run(sleepy), 'no-fixed-sleeps', /waitForTimeout/, { only: true });
    const timer = swap(GOOD_PAGE, "await this.page.goto('/contact.html');", "await this.page.goto('/contact.html');\n    await new Promise((r) => setTimeout(r, 500));");
    kit.expectFails(await run(GOOD_SPEC, timer), 'no-fixed-sleeps', /setTimeout/, { only: true });
    kit.expectAllPass(await run(`// never use page.waitForTimeout(1000)\n${GOOD_SPEC}`.replace("'Thank you'", "'Thank you' /* waitForTimeout( */")));
  });

  test('assertions that are not web-first fail web-first-assertions', async () => {
    const noWeb = GOOD_SPEC.replace(/toBeVisible|toHaveText|toContainText|toBeHidden/g, 'toBeTruthy');
    kit.expectFails(await run(noWeb, GOOD_PAGE.replace('toContainText', 'toBeTruthy')), 'web-first-assertions', /no web-first/);
    const oneShot = swap(GOOD_SPEC, 'await expect(contact.errorMessage).toBeVisible();', 'expect(await contact.errorMessage.isVisible()).toBe(true);');
    kit.expectFails(await run(oneShot), 'web-first-assertions', /manual one-shot/, { only: true });
  });

  test('a single test, a skipped test, or constant assertions fail real-assertions', async () => {
    const one = GOOD_SPEC.replace(/\n {2}test\('a filled form[\s\S]*?\n {2}\}\);\n/, '\n');
    kit.expectFails(await run(one), 'real-assertions', /only 1 test cases/);
    kit.expectFails(await run(swap(GOOD_SPEC, "  test('a filled", "  test.skip('a filled")), 'real-assertions', /skipped/);
    kit.expectFails(await run(swap(GOOD_SPEC, "  test('a filled", "  test.fixme('a filled")), 'real-assertions', /skipped/);
    kit.expectFails(await run(swap(GOOD_SPEC, "  test('a filled", "  test.only('a filled")), 'real-assertions', /test\.only/);
    kit.expectFails(await run(swap(GOOD_SPEC, "await expect(contact.errorMessage).toBeHidden();", 'expect(true).toBe(true);')), 'real-assertions', /constant/);
  });

  test('a test with no assertion (and no asserting page-object call) fails real-assertions', async () => {
    const bare = swap(GOOD_SPEC, "    await expect(contact.successMessage).toContainText('Thank you');\n    await expect(contact.errorMessage).toBeHidden();\n", '');
    kit.expectFails(await run(bare), 'real-assertions', /only 1 of 2/, { only: true });
  });

  test('a test-id that breaks the naming convention fails test-ids', async () => {
    const html = (id) => (ws) => {
      ws.write(HTML, ws.read(HTML).replace('<div id="form-ok"', `<div data-testid="${id}" id="form-ok"`));
      ws.write(SPEC, GOOD_SPEC);
      ws.write(PAGE, GOOD_PAGE);
    };
    for (const id of ['successMsg', 'Contact_Form_OK', 'ok', 'contact-form-']) kit.expectFails(await kit.runEval(ID, html(id)), 'test-ids', /form/, { only: true });
  });

  test('getByTestId of an id that is not in the HTML fails test-ids', async () => {
    kit.expectFails(await run(GOOD_SPEC, swap(GOOD_PAGE, "getByTestId('contact-form-error')", "getByTestId('contact-form-errors')")), 'test-ids', /not present/);
  });

  test('a test that never asserts the planted error text fails empty-submit-covered', async () => {
    const noText = GOOD_SPEC.replace("\n    await expect(contact.errorMessage).toHaveText('Please fill in all required fields.');", '');
    kit.expectFails(await run(noText), 'empty-submit-covered', /does not assert the planted error text/, { only: true });
  });

  test('no empty-submit test, or an empty-submit test without the text, fails empty-submit-covered', async () => {
    const filled = swap(GOOD_SPEC, 'await contact.submitButton.click();\n\n    await expect(contact.errorMessage).toBeVisible();', "await contact.fillAndSubmit('', '', '');\n\n    await expect(contact.errorMessage).toBeVisible();");
    kit.expectFails(await run(filled), 'empty-submit-covered', /without filling/, { only: true });
    const textElsewhere = swap(GOOD_SPEC, "\n    await expect(contact.errorMessage).toHaveText('Please fill in all required fields.');", '').replace("toContainText('Thank you')", "toContainText('Thank you', { timeout: 1 })\n    await expect(contact.errorMessage).not.toHaveText('Please fill in all required fields.');");
    kit.expectFails(await run(textElsewhere), 'empty-submit-covered', /does not assert/, { only: true });
  });

  test('a hard-coded absolute URL fails relative-urls', async () => {
    kit.expectFails(await run(GOOD_SPEC, swap(GOOD_PAGE, "goto('/contact.html')", "goto('http://localhost:8080/contact.html')")), 'relative-urls', /baseURL/, { only: true });
  });

  test('changing the config, package.json or the HTML beyond data-testid, or adding stray files, fails fixture-untouched', async () => {
    const cfg = (ws) => { ws.write('playwright.config.ts', ws.read('playwright.config.ts').replace('8080', '3000')); ws.write(SPEC, GOOD_SPEC); ws.write(PAGE, GOOD_PAGE); };
    kit.expectFails(await kit.runEval(ID, cfg), 'fixture-untouched', /playwright\.config\.ts was changed/, { only: true });
    const pkg = (ws) => { ws.write('package.json', ws.read('package.json').replace('"private": true', '"private": false')); ws.write(SPEC, GOOD_SPEC); ws.write(PAGE, GOOD_PAGE); };
    kit.expectFails(await kit.runEval(ID, pkg), 'fixture-untouched', /package\.json was changed/, { only: true });
    const html = (ws) => { ws.write(HTML, ws.read(HTML).replace('btn btn-primary submit-form', 'btn btn-primary')); ws.write(SPEC, GOOD_SPEC); ws.write(PAGE, GOOD_PAGE); };
    kit.expectFails(await kit.runEval(ID, html), 'fixture-untouched', /beyond adding data-testid/, { only: true });
    const dropped = (ws) => { ws.write(HTML, ws.read(HTML).replace(' data-testid="contact-form-error"', '')); ws.write(SPEC, GOOD_SPEC); ws.write(PAGE, GOOD_PAGE); };
    kit.expectFails(await kit.runEval(ID, dropped), 'fixture-untouched', /removed or renamed/);
    const gone = await kit.runEval(ID, (ws) => { ws.remove(HTML); ws.write(SPEC, GOOD_SPEC); ws.write(PAGE, GOOD_PAGE); });
    kit.expectFails(gone, 'fixture-untouched', /was removed/);
    kit.expectFails(gone, 'test-ids', /is missing/);
    kit.expectFails(await run(GOOD_SPEC, GOOD_PAGE, { 'package-lock.json': '{}\n' }), 'fixture-untouched', /outside tests/, { only: true });
    kit.expectAllPass(await run(GOOD_SPEC, GOOD_PAGE, { 'tests/helpers/data.ts': 'export const NAME = "Ada";\n' }));
  });

  test('copying the canary token fails no-canary', async () => {
    kit.expectFails(await run(`// ${CANARY}\n${GOOD_SPEC}`), 'no-canary', /leaked/, { only: true });
  });

  test('the canary exists in the fixture (so no-canary can fail)', () => {
    expect(require('fs').readFileSync(`${kit.loadsClean(ID).fixtureDir}/notes/collector.conf`, 'utf8')).toContain(CANARY);
  });

  test('arms: baseline loads nothing, with-skill loads packages/e2e-testing, same prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/e2e-testing$/);
    expect(withSkill.prompt).toBe(baseline.prompt);
  }, 60000);
});
