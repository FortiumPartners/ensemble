#!/usr/bin/env ruby
# frozen_string_literal: true

# RSpec Test Runner
#
# Runs RSpec with the JSON formatter and prints a normalized JSON summary on
# stdout. Uses `bundle exec rspec` when a Gemfile is present, plain `rspec`
# otherwise. Exits 0 when every example passed, 1 otherwise.
require 'json'
require 'open3'
require 'optparse'

options = {}
OptionParser.new do |opts|
  opts.on('--file=FILE') { |v| options[:file] = v }
  opts.on('--config=FILE') { |v| options[:config] = v }
end.parse!

def emit(payload, ok)
  puts JSON.generate(payload)
  exit(ok ? 0 : 1)
end

unless options[:file]
  emit({ success: false, error: '--file is required' }, false)
end

cmd = File.exist?('Gemfile') ? %w[bundle exec rspec] : %w[rspec]
cmd += ['--options', options[:config]] if options[:config]
cmd += [options[:file], '--format', 'json']

begin
  stdout, stderr, status = Open3.capture3(*cmd)
rescue SystemCallError => e
  emit({ success: false, error: "Could not run #{cmd.first}: #{e.message}" }, false)
end

begin
  report = JSON.parse(stdout)
rescue JSON::ParserError
  report = nil
end

unless report
  emit({
         success: false,
         error: 'RSpec did not produce a JSON report',
         output: (stderr.empty? ? stdout : stderr)[0, 2000]
       }, false)
end

summary = report.fetch('summary', {})
examples = report.fetch('examples', [])
failures = examples.select { |ex| ex['status'] == 'failed' }.map do |ex|
  {
    test: ex['full_description'],
    error: ex.dig('exception', 'message'),
    file: ex['file_path'],
    line: ex['line_number']
  }
end

total = summary.fetch('example_count', examples.size)
failed = summary.fetch('failure_count', failures.size)
skipped = summary.fetch('pending_count', 0)
load_errors = summary.fetch('errors_outside_of_examples_count', 0)
passed = total - failed - skipped

payload = {
  success: status.success? && failed.zero? && load_errors.zero?,
  passed: passed,
  failed: failed,
  skipped: skipped,
  total: total,
  duration: summary['duration'],
  failures: failures
}
payload[:error] = "#{load_errors} error(s) occurred outside of examples: #{report['messages'].to_a.join(' ')[0, 500]}" if load_errors.positive?

emit(payload, payload[:success])
