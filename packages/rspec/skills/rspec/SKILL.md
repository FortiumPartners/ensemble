---
name: rspec
description: Execute and generate RSpec tests for Ruby projects with let bindings, before hooks, shared examples, and mocking support
metadata:
  version: "1.0.0"
---

# RSpec Test Framework

## Purpose

Provide RSpec test execution and generation for Ruby projects, supporting:
- Spec file generation from bug reports (`*_spec.rb` files)
- Spec execution with structured JSON output (uses `bundle exec rspec` when a Gemfile is present)
- Lazy and eager fixtures with `let`, `let!`, and `subject`
- `before` / `after` / `around` hooks and `shared_context`
- Shared examples for behavior reused across classes
- Verifying doubles, stubs, and message expectations (rspec-mocks)

## Usage

### Generate Test File

Create a spec skeleton from a bug report or feature description:

```bash
ruby generate-test.rb \
  --source=lib/calculator.rb \
  --output=spec/calculator_spec.rb \
  --description="Division by zero raises ZeroDivisionError"
```

The generated example is marked `skip` until you replace the Arrange/Act/Assert
placeholders; an unfinished spec is reported as skipped, never as passing.

### Execute Tests

Run RSpec and return structured results:

```bash
ruby run-test.rb --file=spec/calculator_spec.rb
```

## Command Line Options

### generate-test.rb

- `--source=<path>` - Ruby source file to test (required, must exist)
- `--output=<path>` - Output spec file path (required; parent directories are created)
- `--description=<text>` - Bug description or test purpose
- `--class=<Name>` - Constant to describe (default: CamelCase of the source file name, e.g. `user_service.rb` -> `UserService`; pass `--class=Billing::Invoice` for namespaced classes)
- `--force` - Overwrite the output file if it already exists

The `require_relative` path in the generated spec is computed from the output file to the source file.

### run-test.rb

- `--file=<path>` - Spec file (or directory) to execute (required)
- `--config=<path>` - RSpec options file, passed as `rspec --options <path>` (optional)

Exit code is 0 when every example passed and 1 otherwise.

## Output Format

### Test Generation

```json
{
  "success": true,
  "testFile": "spec/calculator_spec.rb",
  "testCount": 1,
  "template": "unit-test",
  "className": "Calculator"
}
```

### Test Execution

```json
{
  "success": false,
  "passed": 2,
  "failed": 1,
  "skipped": 0,
  "total": 3,
  "duration": 0.012,
  "failures": [
    {
      "test": "Calculator#divide raises ZeroDivisionError",
      "error": "expected ZeroDivisionError but nothing was raised",
      "file": "./spec/calculator_spec.rb",
      "line": 15
    }
  ]
}
```

If RSpec cannot load a spec file (syntax error, missing `require`), `success` is `false` and an `error` field describes the load failure.

## RSpec Spec Structure

### Basic Spec

```ruby
# lib/calculator.rb
class Calculator
  def add(a, b)
    a + b
  end

  def divide(a, b)
    raise ZeroDivisionError, 'divided by 0' if b.zero?

    a.to_f / b
  end
end
```

```ruby
# spec/calculator_spec.rb
require_relative '../lib/calculator'

RSpec.describe Calculator do
  subject(:calculator) { described_class.new }

  describe '#add' do
    it 'adds two numbers' do
      expect(calculator.add(1, 2)).to eq(3)
    end
  end

  describe '#divide' do
    context 'when the divisor is zero' do
      it 'raises ZeroDivisionError' do
        expect { calculator.divide(1, 0) }.to raise_error(ZeroDivisionError, 'divided by 0')
      end
    end

    context 'when the divisor is non-zero' do
      it 'returns a float quotient' do
        expect(calculator.divide(1, 4)).to eq(0.25)
      end
    end
  end
end
```

Conventions: `describe` names the unit (`'#instance_method'`, `'.class_method'`), `context` names a condition ("when ..."/"with ..."), `it` states one expected behavior. Spec files mirror the source tree (`lib/foo/bar.rb` -> `spec/foo/bar_spec.rb`) and end in `_spec.rb`.

### let, let!, subject, and Hooks

`let` is lazy and memoized per example; `let!` is eager (defined in a `before` hook); `subject` is the implicit/explicit object under test. Inner `let` definitions override outer ones, which is how `context` blocks vary one input.

```ruby
# spec/hooks_spec.rb
RSpec.describe 'hooks and lets' do
  let(:calls) { [] }
  let!(:setup_marker) { calls << :let_bang }
  let(:lazy) { calls << :lazy; :value }

  before(:all)  { @suite_state = 'shared across the group' }
  before(:each) { calls << :before }
  after(:each)  { calls << :after }
  around(:each) do |example|
    calls << :around_start
    example.run
    calls << :around_end
  end

  it 'runs eager let and hooks, but not lazy let until referenced' do
    expect(calls).to eq(%i[around_start let_bang before])
    expect(lazy).to eq(:value)
    expect(calls.last).to eq(:lazy)
    expect(@suite_state).to eq('shared across the group')
  end

  context 'with an overridden let' do
    let(:lazy) { :overridden }

    it 'uses the innermost definition' do
      expect(lazy).to eq(:overridden)
    end
  end
end
```

Prefer `before(:each)` (the default) over `before(:all)`: state created in `before(:all)` is not rolled back between examples. Prefer `let` over instance variables, and avoid `let!` unless the side effect must exist before the example runs.

### Shared Examples and Shared Context

```ruby
# spec/shared_spec.rb
RSpec.shared_examples 'a stack' do
  it 'pops what was pushed last' do
    stack.push(1)
    stack.push(2)
    expect(stack.pop).to eq(2)
  end

  it 'is empty when new' do
    expect(stack).to be_empty
  end
end

RSpec.shared_context 'with a seeded list' do
  let(:items) { [3, 1, 2] }
end

RSpec.describe Array do
  let(:stack) { [] }
  it_behaves_like 'a stack'            # runs in a nested group
end

RSpec.describe 'seeded' do
  include_context 'with a seeded list'  # inlines let/hooks into this group

  it 'sees the shared let' do
    expect(items.sort).to eq([1, 2, 3])
  end
end
```

Use `it_behaves_like` (nested group, isolated) for behavior contracts and `include_context` for shared setup. Share files by placing them in `spec/support/` and requiring them from `spec_helper.rb`. Shared examples can take parameters: `RSpec.shared_examples 'x' do |arg| ... end` and `it_behaves_like 'x', arg`.

## Expectations and Matchers

Use the `expect(...).to` syntax (not the legacy `should`).

```ruby
# spec/matchers_spec.rb
RSpec.describe 'common matchers' do
  it 'compares values' do
    expect(1 + 1).to eq(2)                    # ==
    expect('a').to eql('a')                   # eql? (type-strict)
    expect(:a).to equal(:a)                   # same object
    expect(0.1 + 0.2).to be_within(0.001).of(0.3)
    expect(5).to be > 3
  end

  it 'checks truthiness, nil, and types' do
    expect(true).to be(true)
    expect(nil).to be_nil
    expect(1).to be_truthy
    expect(false).to be_falsey
    expect('s').to be_a(String)               # be_kind_of
    expect(1).to be_an_instance_of(Integer)
    expect('s').to respond_to(:upcase)
  end

  it 'checks strings and collections' do
    expect('hello world').to start_with('hello').and end_with('world')
    expect('hello').to match(/ell/)
    expect([1, 2, 3]).to include(2)
    expect([1, 2, 3]).to match_array([3, 2, 1])      # same elements, any order
    expect([1, 2, 3]).to contain_exactly(3, 1, 2)
    expect({ a: 1, b: 2 }).to include(a: 1)
    expect([]).to be_empty
    expect([1, 2]).to all(be_positive)
    expect(%w[a b]).to eq(%w[a b]).and have_attributes(size: 2)
  end

  it 'checks errors, side effects, and output' do
    expect { Integer('x') }.to raise_error(ArgumentError, /invalid value/)
    counter = [0]
    expect { counter[0] += 1 }.to change { counter[0] }.from(0).to(1)
    expect { counter[0] += 2 }.to change { counter[0] }.by(2)
    expect { puts 'hi' }.to output("hi\n").to_stdout
    expect { throw :done }.to throw_symbol(:done)
    expect(7).to satisfy('be odd') { |n| n.odd? }
  end

  it 'reports every failed expectation in a block' do
    aggregate_failures 'user fields' do
      expect('a').to eq('a')
      expect(1).to eq(1)
    end
  end
end
```

Predicate matchers are generated from `?` methods: `be_empty` calls `empty?`, `have_key(:a)` calls `has_key?(:a)`. Custom matchers: `RSpec::Matchers.define :be_even do match { |actual| actual.even? } end`.

## Mocking and Stubbing (rspec-mocks)

```ruby
# lib/order_service.rb
class Gateway
  def charge(amount)
    raise NotImplementedError
  end
end

class OrderService
  def initialize(gateway)
    @gateway = gateway
  end

  def checkout(amount)
    @gateway.charge(amount) ? :paid : :declined
  end
end
```

```ruby
# spec/order_service_spec.rb
require_relative '../lib/order_service'

RSpec.describe OrderService do
  # instance_double verifies that Gateway really has #charge with this arity
  let(:gateway) { instance_double(Gateway) }
  subject(:service) { described_class.new(gateway) }

  it 'stubs a return value with allow' do
    allow(gateway).to receive(:charge).and_return(true)
    expect(service.checkout(100)).to eq(:paid)
  end

  it 'sets a message expectation with expect...to receive' do
    expect(gateway).to receive(:charge).with(100).once.and_return(false)
    expect(service.checkout(100)).to eq(:declined)
  end

  it 'asserts after the fact with have_received (spies)' do
    allow(gateway).to receive(:charge).and_return(true)
    service.checkout(42)
    expect(gateway).to have_received(:charge).with(42)
  end

  it 'simulates failures' do
    allow(gateway).to receive(:charge).and_raise(IOError)
    expect { service.checkout(1) }.to raise_error(IOError)
  end

  it 'varies the response per call' do
    allow(gateway).to receive(:charge).and_return(true, false)
    expect([service.checkout(1), service.checkout(1)]).to eq(%i[paid declined])
  end

  it 'stubs constants' do
    stub_const('Gateway::LIMIT', 500)
    expect(Gateway::LIMIT).to eq(500)
  end

  it 'partially stubs a real object and calls through' do
    list = [3, 1, 2]
    allow(list).to receive(:size).and_return(99)
    expect(list.size).to eq(99)
    expect(list.sort).to eq([1, 2, 3])
  end
end
```

Guidelines:
- Prefer verifying doubles (`instance_double`, `class_double`, `object_double`) over plain `double`: they fail when the stubbed method does not exist or is called with the wrong arguments.
- Stub at the boundary (HTTP clients, clocks, mailers), not the object under test. Do not mock what you do not own without a wrapper.
- `allow` configures a response; `expect(...).to receive` asserts the call happens (and fails the example otherwise). Use `have_received` when the Act step should precede the assertion.
- Enable `mocks.verify_partial_doubles = true` in `spec_helper.rb` so `allow(real_object).to receive(:nope)` also fails on misspelled methods.
- Avoid `allow_any_instance_of` / `expect_any_instance_of`; inject the collaborator instead.

## Metadata, Tags, and Filtering

Any extra keyword on `describe` / `context` / `it` becomes metadata. Metadata drives filtering and hooks.

```ruby
# spec/tags_spec.rb
RSpec.describe 'tagged specs' do
  it 'is fast', :fast do
    expect(1).to eq(1)
  end

  it 'needs a network', :slow, integration: true do
    expect(true).to be(true)
  end

  it 'is skipped with a reason', skip: 'not implemented yet' do
    raise 'never runs'
  end

  it 'focuses on this example when run with --tag focus', :focus do
    expect(2).to eq(2)
  end

  describe 'hooks keyed on metadata' do
    before(:each, :slow) { @slow_setup = true }

    it 'receives the hook only when tagged', :slow do
      expect(@slow_setup).to be(true)
    end
  end
end
```

```bash
bundle exec rspec --tag fast              # only :fast
bundle exec rspec --tag ~slow             # everything except :slow
bundle exec rspec --tag integration:true  # key:value metadata
```

## Running Specs

```bash
bundle exec rspec                                   # whole suite (spec/**/*_spec.rb)
bundle exec rspec spec/calculator_spec.rb           # one file
bundle exec rspec spec/calculator_spec.rb:15        # example/group at line 15
bundle exec rspec spec/models spec/services         # several paths
bundle exec rspec -e "divide"                       # examples whose full description matches
bundle exec rspec --format documentation            # nested, readable output (-fd)
bundle exec rspec --format json                     # machine-readable (what run-test.rb parses)
bundle exec rspec --format progress --format html --out report.html
bundle exec rspec --fail-fast                       # stop on first failure
bundle exec rspec --order random --seed 1234        # reproduce a random-order failure
bundle exec rspec --only-failures                   # re-run last failures (needs example_status_persistence_file_path)
bundle exec rspec --next-failure                    # re-run only the first remaining failure
bundle exec rspec --profile 5                       # five slowest examples
bundle exec rspec --dry-run                         # list examples without running them
```

`--only-failures` and `--next-failure` read a status file; enable it once in `spec_helper.rb` (below), otherwise RSpec aborts with an explanatory message.

### Project Setup

`rspec --init` creates `.rspec` and `spec/spec_helper.rb`. A conventional configuration:

```ruby
# spec/spec_helper.rb
RSpec.configure do |config|
  config.expect_with :rspec do |expectations|
    expectations.include_chain_clauses_in_custom_matcher_descriptions = true
  end

  config.mock_with :rspec do |mocks|
    mocks.verify_partial_doubles = true
  end

  config.shared_context_metadata_behavior = :apply_to_host_groups
  config.example_status_persistence_file_path = 'spec/examples.txt'  # enables --only-failures
  config.disable_monkey_patching!                                    # RSpec.describe, never bare describe
  config.order = :random
  Kernel.srand config.seed
end
```

```text
# .rspec
--require spec_helper
--format documentation
```

Add `spec/examples.txt` to `.gitignore`. Gemfile:

```ruby
group :test do
  gem 'rspec', '~> 3.13'
end
```

### Rails (rspec-rails)

If the project is a Rails app, use `rspec-rails` (`gem 'rspec-rails'` in the `:development, :test` group, then `bin/rails generate rspec:install`) and `require 'rails_helper'` instead of `spec_helper`. Spec types are inferred from the directory when `config.infer_spec_type_from_file_location!` is on (`spec/models`, `spec/requests`, `spec/controllers`, `spec/system`, `spec/jobs`, `spec/mailers`, `spec/helpers`, `spec/views`), or set explicitly with `type: :model`, `type: :request`, etc. Prefer request specs over controller specs for HTTP behavior. `factory_bot_rails` and `faker` are the conventional fixture and fake-data gems; the `rails` package skill covers Rails itself.

## Integration with deep-debugger

The deep-debugger agent uses this skill for Ruby projects:

1. Invoke detect-stack (test axis) to identify RSpec (`Gemfile` containing `rspec`, a `.rspec` file, or a `spec/` directory)
2. Invoke `generate-test.rb` to create the spec skeleton from the bug report
3. Fill in Arrange/Act/Assert so the spec fails for the reported reason, and remove the `skip` line
4. Invoke `run-test.rb` to confirm the spec fails
5. Delegate the fix, then re-run `run-test.rb` to verify the spec passes

## Dependencies

Requires Ruby and the `rspec` gem in the project (rspec-core, rspec-expectations, rspec-mocks):

```bash
ruby --version                   # Ruby 2.x or 3.x
bundle add rspec --group test    # or: gem install rspec
bundle exec rspec --version
```

`run-test.rb` and `generate-test.rb` use only the Ruby standard library (`json`, `optparse`, `open3`, `pathname`, `fileutils`).

## Error Handling

### Test Generation Errors

```json
{
  "success": false,
  "error": "Source file not found",
  "file": "lib/missing.rb"
}
```

Other generation errors: `--source is required`, `--output is required`, and `Output file already exists (use --force to overwrite)`.

### Test Execution Errors

```json
{
  "success": false,
  "error": "RSpec did not produce a JSON report",
  "output": "<first 2000 characters of RSpec stderr or stdout>"
}
```

Spec load failures (syntax errors, `LoadError`) produce `"success": false` with `total: 0` and an `error` message that includes RSpec's description of the failure.

## See Also

- [REFERENCE.md](REFERENCE.md) - Detailed RSpec API reference and best practices
- [RSpec documentation](https://rspec.info/documentation/)
- [Better Specs](https://www.betterspecs.org/)
