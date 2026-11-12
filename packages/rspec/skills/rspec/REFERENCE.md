# RSpec Test Framework - API Reference

This document provides detailed API reference and best practices for the RSpec test skill. It covers RSpec 3.x (rspec-core, rspec-expectations, rspec-mocks).

## Table of Contents

1. [Configuration](#configuration)
2. [Example Groups and Examples](#example-groups-and-examples)
3. [Hooks and Execution Order](#hooks-and-execution-order)
4. [Fixtures: let, let!, subject](#fixtures-let-let-subject)
5. [Matchers](#matchers)
6. [Custom Matchers](#custom-matchers)
7. [Test Doubles](#test-doubles)
8. [Shared Examples and Shared Context](#shared-examples-and-shared-context)
9. [Metadata and Filtering](#metadata-and-filtering)
10. [Command Line](#command-line)
11. [Formatters](#formatters)
12. [Best Practices](#best-practices)
13. [Common Pitfalls](#common-pitfalls)
14. [Resources](#resources)

## Configuration

`rspec --init` writes `.rspec` (default command line flags) and `spec/spec_helper.rb`. Flags in `.rspec` apply to every run; `--require spec_helper` is what loads the configuration.

```text
# .rspec
--require spec_helper
--format progress
--color
```

```ruby
# spec/spec_helper.rb
RSpec.configure do |config|
  config.expect_with(:rspec) { |c| c.syntax = :expect }
  config.mock_with(:rspec) { |m| m.verify_partial_doubles = true }

  config.example_status_persistence_file_path = 'spec/examples.txt'
  config.disable_monkey_patching!
  config.filter_run_when_matching :focus       # run only :focus examples when any exist
  config.order = :random
  Kernel.srand config.seed

  config.before(:each) { @configured = true }  # global hook
  config.include(Module.new { def helper_value; 42; end })  # global helper methods
end
```

Key settings:

| Setting | Effect |
|---------|--------|
| `expect_with :rspec` `c.syntax = :expect` | Disable the legacy `should` syntax |
| `mock_with :rspec` `verify_partial_doubles = true` | `allow(real).to receive(:typo)` fails when the method is not defined |
| `example_status_persistence_file_path` | Enables `--only-failures` and `--next-failure` |
| `disable_monkey_patching!` | Removes top-level `describe`; use `RSpec.describe` |
| `filter_run_when_matching :focus` | `fit`/`:focus` runs only focused examples, everything otherwise |
| `order = :random` | Randomize example order; reproduce with `--seed N` |
| `profile_examples = 5` | Print the slowest examples |
| `infer_spec_type_from_file_location!` | rspec-rails only: derive `type:` from directory |

Load files from `spec/support/` with `Dir[File.join(__dir__, 'support', '**', '*.rb')].sort.each { |f| require f }` in `spec_helper.rb` (or `rails_helper.rb`).

## Example Groups and Examples

```ruby
# spec/groups_spec.rb
RSpec.describe String do
  describe '#upcase' do
    it 'upcases' do
      expect('a'.upcase).to eq('A')
    end

    context 'with an empty string' do
      it('stays empty') { expect(''.upcase).to eq('') }
    end
  end

  describe '.new' do
    specify { expect(String.new).to eq('') }   # specify == it
  end

  xit('is skipped')                              # xit, xdescribe: skipped
  pending('is pending until fixed') { raise 'known bug' }
  it('has no body and is reported pending')      # no block == pending
end
```

| Construct | Purpose |
|-----------|---------|
| `RSpec.describe X` | Top-level group for a class/module/string |
| `describe` / `context` | Nested groups (aliases; use `context` for conditions) |
| `it` / `specify` / `example` | One example |
| `fit` / `fdescribe` / `focus: true` | Focus (with `filter_run_when_matching :focus`) |
| `xit` / `xdescribe` / `skip` | Skip, reported as pending |
| `pending` | Run, expected to fail; fails the suite when it unexpectedly passes |
| `described_class` | The constant passed to the outermost `describe` |

## Hooks and Execution Order

`before(:suite)` and `after(:suite)` are only valid inside `RSpec.configure`. Within a group (the `LOG` constant here only records the order):

```ruby
# spec/order_spec.rb
RSpec.describe 'hook order' do
  LOG = []

  before(:all)  { LOG << :outer_before_all }
  before(:each) { LOG << :outer_before_each }
  around(:each) { |ex| LOG << :around_in; ex.run; LOG << :around_out }
  after(:each)  { LOG << :outer_after_each }
  after(:all)   { LOG << :outer_after_all }

  context 'inner' do
    before(:each) { LOG << :inner_before_each }
    after(:each)  { LOG << :inner_after_each }

    it 'runs hooks outermost-first before, innermost-first after' do
      expect(LOG).to eq(%i[outer_before_all around_in outer_before_each inner_before_each])
    end
  end
end
```

Order for one example: `before(:suite)` -> `before(:all)` -> `around` (start) -> `before(:each)` (outer to inner) -> example -> `after(:each)` (inner to outer) -> `around` (end) -> `after(:all)` -> `after(:suite)`. `before`/`after` default to `:each`; `:context` is an alias of `:all`. Instance variables set in `before(:all)` are copied into each example but are not reset between examples, so mutable objects leak state; prefer `let` or `before(:each)`.

## Fixtures: let, let!, subject

```ruby
# spec/fixtures_spec.rb
RSpec.describe 'fixtures' do
  let(:count) { @count = (@count || 0) + 1 }   # memoized: block runs once per example
  let!(:eager) { :built_before_example }       # runs in a before hook
  subject(:items) { [1, 2, 3] }                # named subject

  it 'memoizes let within an example' do
    expect([count, count]).to eq([1, 1])
  end

  it 'builds let! eagerly' do
    expect(eager).to eq(:built_before_example)
  end

  it 'uses the explicit subject' do
    expect(items.sum).to eq(6)
    expect(subject).to equal(items)            # same object
  end

  describe 'one-liner syntax' do
    subject { [] }
    it { is_expected.to be_empty }             # is_expected == expect(subject)
  end

  describe 'let referencing another let' do
    let(:base) { 10 }
    let(:total) { base + 5 }
    it { expect(total).to eq(15) }

    context 'with a different base' do
      let(:base) { 100 }
      it { expect(total).to eq(105) }          # late binding picks the override
    end
  end
end
```

- `let` values are discarded after each example; never share them across examples.
- Use `subject` for the object under test, `let` for collaborators and inputs. Avoid implicit `subject` in complex groups: name it.
- `let(:x) { ... }` inside a `before(:all)` is not available; `let` requires an example context.

## Matchers

| Category | Matchers |
|----------|----------|
| Equality | `eq` (`==`), `eql` (`eql?`), `equal` / `be` (identity) |
| Comparison | `be > n`, `be >= n`, `be < n`, `be <= n`, `be_between(a, b).inclusive`, `be_within(delta).of(n)` |
| Truthiness | `be_truthy`, `be_falsey`, `be_nil`, `be(true)`, `be(false)` |
| Types | `be_a(Class)` / `be_kind_of`, `be_an_instance_of`, `respond_to(:m)` |
| Strings | `start_with`, `end_with`, `match(/re/)`, `include('sub')` |
| Collections | `include`, `contain_exactly`, `match_array`, `all(matcher)`, `be_empty`, `have_attributes`, `start_with` / `end_with` on arrays |
| Hashes | `include(key: value)`, `have_key(:k)`, `match(a: Integer, b: String)` |
| Errors | `raise_error`, `raise_error(Class)`, `raise_error(Class, 'msg' or /re/)`, `raise_exception` |
| Side effects | `change { }`, `.by(n)`, `.from(a).to(b)`, `.by_at_least(n)`, `.by_at_most(n)` |
| Output | `output('x').to_stdout`, `output(/re/).to_stderr` |
| Control flow | `throw_symbol(:s)`, `yield_control`, `yield_with_args(1, 2)`, `yield_successive_args(1, 2)` |
| Predicates | `be_xxx` calls `xxx?`; `have_xxx` calls `has_xxx?` |
| Custom | `satisfy { |x| ... }`, `RSpec::Matchers.define` |
| Compound | `matcher1.and matcher2`, `matcher1.or matcher2` |

```ruby
# spec/more_matchers_spec.rb
RSpec.describe 'matcher details' do
  Point = Struct.new(:x, :y)

  it 'matches structurally' do
    expect(Point.new(1, 2)).to have_attributes(x: 1, y: 2)
    expect({ name: 'a', age: 3 }).to match(name: a_kind_of(String), age: a_value > 2)
    expect([1, 'a', :b]).to match([an_instance_of(Integer), 'a', :b])
  end

  it 'yields' do
    expect { |probe| [1, 2].each(&probe) }.to yield_successive_args(1, 2)
  end

  it 'checks change magnitudes' do
    list = []
    expect { list << 1 << 2 }.to change(list, :size).by(2)
    expect { list.clear }.to change { list.empty? }.from(false).to(true)
  end

  it 'composes matchers' do
    expect(7).to be_odd.and be > 5
    expect('x').to eq('y').or eq('x')
  end

  it 'negates with not_to' do
    expect([1, 2]).not_to include(3)
    expect { 1 + 1 }.not_to raise_error
  end

  it 'adds a failure message' do
    expect(1 + 1).to eq(2), 'arithmetic is broken'
  end
end
```

Prefer `eq` for values, `be` / `equal` only for identity (`be(true)`, `be(nil)` are fine). `be_truthy`/`be_falsey` accept any truthy/falsey value; `be(true)` demands the literal.

## Custom Matchers

```ruby
# spec/custom_matcher_spec.rb
RSpec::Matchers.define :be_multiple_of do |expected|
  match { |actual| (actual % expected).zero? }
  failure_message { |actual| "expected #{actual} to be a multiple of #{expected}" }
  description { "be a multiple of #{expected}" }
end

RSpec.describe 'custom matcher' do
  it('passes')  { expect(9).to be_multiple_of(3) }
  it('negates') { expect(10).not_to be_multiple_of(3) }
end
```

Put shared matchers in `spec/support/matchers/` and require them from `spec_helper.rb`. For simple cases `satisfy { }` is enough; for complex reuse define a matcher so failures read well.

## Test Doubles

| API | Use |
|-----|-----|
| `double('name', method: value)` | Pure double; any unstubbed message raises |
| `instance_double(Klass, method: value)` | Verifies instance methods exist and arity matches |
| `class_double(Klass)` | Verifies class methods; `as_stubbed_const` replaces the constant |
| `object_double(obj)` | Verifies against a concrete object |
| `spy('name')` | Double that records and accepts every message |
| `allow(obj).to receive(:m)` | Stub (no failure if not called) |
| `expect(obj).to receive(:m)` | Message expectation (fails if not called) |
| `allow(obj).to receive_messages(a: 1, b: 2)` | Stub several methods |
| `allow(obj).to receive_message_chain(:a, :b)` | Stub `obj.a.b` (smell: Law of Demeter) |
| `stub_const('Const', value)` | Temporarily define/replace a constant |
| `hide_const('Const')` | Make a constant undefined |

Response and constraint modifiers:

| Modifier | Effect |
|----------|--------|
| `.with(args)` | Constrain arguments (`anything`, `instance_of(Integer)`, `hash_including(a: 1)`, `kind_of(String)`) |
| `.and_return(v1, v2)` | Return values in sequence (last repeats) |
| `.and_raise(Error, 'msg')` | Raise |
| `.and_call_original` | Delegate to the real method (partial doubles) |
| `.and_yield(arg)` | Yield to the block passed by the caller |
| `.and_throw(:sym)` | Throw |
| `.once` / `.twice` / `.exactly(n).times` / `.at_least(n).times` / `.never` | Call count |
| `.ordered` | Calls must occur in the declared order |
| `have_received(:m)` | After-the-fact assertion on a spy or `allow`ed double |

```ruby
# spec/doubles_spec.rb
class Mailer
  def deliver(to:, body:); end
  def self.default_from; 'a@example.com'; end
end

class Signup
  def initialize(mailer); @mailer = mailer; end
  def call(email); @mailer.deliver(to: email, body: 'hi'); :ok; end
end

RSpec.describe Signup do
  let(:mailer) { instance_double(Mailer) }

  it 'checks arguments with with()' do
    expect(mailer).to receive(:deliver).with(to: 'a@b.c', body: kind_of(String))
    expect(described_class.new(mailer).call('a@b.c')).to eq(:ok)
  end

  it 'fails fast when the double does not match the real API' do
    expect { allow(mailer).to receive(:nope) }.to raise_error(RSpec::Mocks::MockExpectationError)
  end

  it 'works with class_double and spies' do
    klass = class_double(Mailer, default_from: 'x@y.z')
    expect(klass.default_from).to eq('x@y.z')

    mail_spy = spy('mailer')
    described_class.new(mail_spy).call('q@r.s')
    expect(mail_spy).to have_received(:deliver).with(to: 'q@r.s', body: 'hi').once
  end

  it 'yields and calls original on partial doubles' do
    obj = Object.new
    def obj.each_item; yield 1; end
    allow(obj).to receive(:each_item).and_yield(99)
    got = []
    obj.each_item { |x| got << x }
    expect(got).to eq([99])

    arr = [1, 2]
    allow(arr).to receive(:first).and_call_original
    expect(arr.first).to eq(1)
  end

  it 'enforces ordering and counts' do
    d = double('d')
    expect(d).to receive(:a).ordered
    expect(d).to receive(:b).twice.ordered
    d.a
    d.b
    d.b
  end
end
```

## Shared Examples and Shared Context

```ruby
# spec/shared_reference_spec.rb
RSpec.shared_examples 'a sized collection' do |expected_size|
  it "has #{expected_size} elements" do
    expect(collection.size).to eq(expected_size)
  end
end

RSpec.shared_context 'with logging' do
  let(:log) { [] }
  before { log << :setup }
end

RSpec.describe 'shared pieces' do
  context 'array' do
    let(:collection) { [1, 2] }
    it_behaves_like 'a sized collection', 2
  end

  context 'hash' do
    let(:collection) { { a: 1 } }
    it_should_behave_like 'a sized collection', 1
  end

  context 'with the shared context' do
    include_context 'with logging'
    it { expect(log).to eq([:setup]) }
  end
end
```

| Method | Behavior |
|--------|----------|
| `it_behaves_like 'name', args` | Runs the examples in a **nested** group (own scope) |
| `it_should_behave_like` | Same as `it_behaves_like` with different wording |
| `include_examples 'name'` | Inlines the examples into the **current** group |
| `include_context 'name'` | Inlines `let`/hooks/helpers into the current group |
| `config.include_context 'name', :tag` | Auto-include for groups carrying the metadata |

## Metadata and Filtering

```ruby
# spec/metadata_spec.rb
RSpec.describe 'metadata', :outer, level: 1 do
  it 'exposes metadata via the example argument', :flag, retries: 2 do |example|
    expect(example.metadata[:flag]).to be(true)
    expect(example.metadata[:retries]).to eq(2)
    expect(example.metadata[:level]).to eq(1)
    expect(example.description).to eq('exposes metadata via the example argument')
  end
end
```

- Symbols become `key: true`. Inner groups and examples inherit outer metadata.
- Hooks, `include`, and `shared_context` can all be keyed on metadata: `config.before(:each, :db) { ... }`.
- `rspec --tag name`, `--tag ~name` (exclude), `--tag name:value`; `config.filter_run_excluding :slow`; `config.filter_run_when_matching :focus`.

## Command Line

| Option | Meaning |
|--------|---------|
| `rspec [paths]` | Files, directories, or `file:LINE`; default `spec/` |
| `-e, --example STRING` | Only examples whose description contains STRING |
| `-t, --tag TAG[:VALUE]` | Include (or exclude with `~`) by metadata |
| `-f, --format NAME` | `progress`, `documentation`, `json`, `html`, `failures`, or a class name |
| `-o, --out FILE` | Write the preceding `--format` to a file |
| `--fail-fast[=N]` | Stop after the first (or Nth) failure |
| `--only-failures` | Run only examples that failed last time (needs persistence file) |
| `--next-failure` | Run the first of the remaining failures |
| `--order defined\|random[:SEED]`, `--seed N` | Execution order and reproducibility |
| `-p, --profile [N]` | Report the N slowest examples |
| `--dry-run` | List examples without running them |
| `-r, --require FILE` | Require a file before loading specs |
| `-O, --options FILE` | Use an alternative options file |
| `-I PATH` | Add to the load path |
| `-c, --[no-]color` | Color output |
| `--bisect` | Minimize the set of examples needed to reproduce an order-dependent failure |
| `--init` | Create `.rspec` and `spec/spec_helper.rb` |

Always run through Bundler (`bundle exec rspec`) in projects with a Gemfile so the locked gem versions are used.

## Formatters

- `progress` (default): dots, then a failure summary.
- `documentation`: nested group/example names; best for reviewing intent.
- `json`: machine-readable report. Shape used by `run-test.rb`:

```json
{
  "version": "3.13.6",
  "examples": [
    {
      "id": "./spec/calculator_spec.rb[1:2:1]",
      "description": "raises ZeroDivisionError",
      "full_description": "Calculator#divide raises ZeroDivisionError",
      "status": "failed",
      "file_path": "./spec/calculator_spec.rb",
      "line_number": 15,
      "exception": { "class": "RSpec::Expectations::ExpectationNotMetError", "message": "..." }
    }
  ],
  "summary": {
    "duration": 0.012,
    "example_count": 3,
    "failure_count": 1,
    "pending_count": 0,
    "errors_outside_of_examples_count": 0
  }
}
```

  `status` is `passed`, `failed`, or `pending` (skipped examples are `pending`). `errors_outside_of_examples_count` is non-zero for load errors, in which case `examples` is empty.
- `html`: self-contained report (`--format html --out report.html`).
- `failures`: writes the failed examples' details to a file (`--format failures --out failures.txt`).
- Multiple formatters can be combined: `--format progress --format json --out results.json`.
- Third-party: `rspec_junit_formatter` (CI test reports), `fuubar` (progress bar).

## Best Practices

### 1. Arrange-Act-Assert, one behavior per example

```ruby
it 'raises on a zero divisor' do
  calculator = Calculator.new                       # Arrange
  action = -> { calculator.divide(1, 0) }           # Act (deferred)
  expect(&action).to raise_error(ZeroDivisionError) # Assert
end
```

Use `aggregate_failures` when one behavior needs several expectations and you want all failures reported.

### 2. Descriptions read as sentences

`describe '#divide'` + `context 'when the divisor is zero'` + `it 'raises ZeroDivisionError'` prints "Calculator#divide when the divisor is zero raises ZeroDivisionError". Avoid `it 'should ...'`.

### 3. Prefer `let` and `subject` over instance variables and `before` assignments

Lazy `let` keeps setup next to the contexts that override it and builds nothing that an example does not use.

### 4. Keep specs isolated and deterministic

Randomize order (`config.order = :random`). Do not depend on example order, shared globals, the clock, the network, or the file system layout; stub boundaries (`allow(Time).to receive(:now)` or a clock object) and use `Dir.mktmpdir` for files.

### 5. Test behavior through the public interface

Do not stub the object under test and do not assert on private methods (`send(:x)`). Verify outcomes (return values, state changes, messages to collaborators) rather than implementation steps.

### 6. Use verifying doubles and verify partial doubles

`instance_double`/`class_double` plus `verify_partial_doubles = true` make mocks fail when the real API changes.

### 7. Avoid over-nesting and over-DRY

Keep `describe`/`context` nesting to roughly three levels. A little repetition in examples is better than a spec that must be read bottom-up through five `let`s.

### 8. Fixtures and factories

`factory_bot` (with `faker` for fake attributes) is the conventional way to build records in Rails projects; prefer `build`/`build_stubbed` over `create` when persistence is not needed. In plain Ruby, small hand-built objects or `Struct`s are usually enough.

## Common Pitfalls

### 1. `before(:all)` state leaking

Objects created in `before(:all)` persist across examples (and database rows are not rolled back unless you clean up in `after(:all)`). Use `before(:each)`.

### 2. Forgetting the block in `expect { }` for errors and changes

```ruby
expect(calculator.divide(1, 0)).to raise_error(ZeroDivisionError)   # wrong: raises before expect runs
expect { calculator.divide(1, 0) }.to raise_error(ZeroDivisionError) # right
```

### 3. Mocking with `expect().to receive` when `allow` was intended

`expect(x).to receive(:m)` fails the example if `m` is never called. Use `allow` for incidental collaborators.

### 4. `allow_any_instance_of` hiding design problems

It stubs every instance, past and future, and ignores arity verification. Inject the collaborator and use `instance_double`.

### 5. Confusing `eq`, `eql`, and `equal`

`eq(1.0)` passes for `1`; `eql(1.0)` does not. `equal` checks object identity (strings with the same text are different objects).

### 6. Testing time and randomness directly

`Time.now`, `rand`, and `SecureRandom` change every run. Inject a clock/RNG or stub it with `allow`.

### 7. Order-dependent failures

A spec that passes alone and fails in the suite (or only with some seeds) shares state. Re-run with the printed `--seed`, then `rspec --bisect` to find the polluting example.

### 8. Running outside Bundler

`rspec` without `bundle exec` can load a different gem version than `Gemfile.lock`; symptoms are `LoadError` or behavior differences between local and CI.

## Resources

- [RSpec documentation](https://rspec.info/documentation/)
- [rspec-core](https://rspec.info/features/3-13/rspec-core/), [rspec-expectations](https://rspec.info/features/3-13/rspec-expectations/), [rspec-mocks](https://rspec.info/features/3-13/rspec-mocks/)
- [Built-in matchers](https://rspec.info/features/3-13/rspec-expectations/built-in-matchers/)
- [rspec-rails](https://github.com/rspec/rspec-rails)
- [Better Specs](https://www.betterspecs.org/)
