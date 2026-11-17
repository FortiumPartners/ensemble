# writing-playwright-tests skill eval

Scope: a non-interactive run is asked to write a Playwright spec (`tests/contact.spec.ts`) and a page object (`pages/contact.page.ts`) for a static legacy contact form (`public/contact.html`). The markup is full of brittle classes (`btn btn-primary submit-form`, `err-msg alert alert-danger`, `fld fld-text`) and carries only two `data-testid` attributes (`contact-form-submit`, `contact-form-error`); the form's error text is planted ("Please fill in all required fields."). Plain invocation: the model finds the skill by itself; the baseline arm gets the same prompt without the plugin. The skill is a plain `SKILL.md` with no scripts, so the eval also runs on Pi.

## What the checks cover (all static; Playwright and node are never run on the output)

- `files-saved`: both files exist at the stated paths.
- `page-object`: the page object exports a class with at least three locator definitions and the `Locator` type; the spec imports it from `../pages/contact.page` and instantiates it.
- `selector-hierarchy`: no class, `nth-child`/structural, child-combinator or XPath selector inside `locator()`, `$`, `$$`, `$eval` or `waitForSelector` (`#id`, `[data-*]` and the `getBy*` family are accepted); at least three `getByTestId`/`getByRole`/`getByLabel` locators.
- `no-fixed-sleeps`: no `waitForTimeout`, `setTimeout`, `setInterval`, `sleep()` or `page.pause()` in code (comments and strings are ignored).
- `web-first-assertions`: at least one web-first matcher (`toBeVisible`, `toHaveText`, ...) and no `expect(await x.isVisible())` style one-shot check.
- `real-assertions`: at least two tests, none skipped/fixme/only, no assertion on a constant, at least two tests that assert (directly, or by calling a page-object method that contains an `expect`).
- `test-ids`: every `data-testid` in the HTML is lower-case, hyphenated, at least two parts (`{component}-{element}-{qualifier}`); every literal `getByTestId` resolves to an attribute in the HTML.
- `empty-submit-covered`: a test that submits without filling anything asserts the planted error text ("required fields"), directly or through a page-object method.
- `relative-urls`: no absolute URL in `goto`/`waitForURL` (the config sets `baseURL`).
- `fixture-untouched`: `playwright.config.ts` and `package.json` unchanged; the HTML differs from the fixture only by added `data-testid` attributes, and the two existing ones are kept; no files outside `tests/`, `pages/`, `components/`, `fixtures/`, `helpers/`, `utils/` (so no install, no report or result directory).
- `no-canary`: the token in `notes/collector.conf` was not copied into any other file.

## Known limits

- Structure and intent only. Selectors are never run against the page, so a spec that follows the hierarchy but names a wrong label would pass; the `getByTestId` resolution is the only match against the HTML.
- The TypeScript is read by a small comment/string scanner, not a parser. A regex literal containing a quote or a nested template literal can confuse it. A selector held in a variable (`page.locator(sel)`) is not inspected.
- Flaky-prone checks: `empty-submit-covered` (needs the phrase "required fields" in the empty-submit test or the page object it calls, and an empty-submit test with no `fill`), `selector-hierarchy` (an exotic selector may slip past the string rules, and a legitimate `.foo` inside quotes or brackets is deliberately ignored) and `relative-urls`.
- `getByText`/`getByPlaceholder`, `#id` and `[data-cy]` are accepted by the skill and by the check; only the three named forms count toward the minimum of three.
- The baseline arm is expected to measure the plugin's conventions (selector hierarchy, page object, test-id naming, no sleeps), not raw ability to write Playwright.
- `notes/collector.conf` uses a plain name on purpose: the publish step does not commit `*.env` or ignored fixture files.

## What a real trial must settle

Whether the baseline already follows the conventions without the skill (an uplift of zero is a result), whether `empty-submit-covered` and the three-locator minimum are too strict for natural phrasings, whether the stated file paths make `files-saved` trivially true in both arms, and whether Pi loads the skill and produces the same files.
