#!/usr/bin/env ruby
# RSpec Test Runner
require 'json'
require 'optparse'

options = {}
OptionParser.new do |opts|
  opts.on("--file=FILE") { |v| options[:file] = v }
end.parse!

# Run RSpec (simplified - would use RSpec::Core::Runner in production)
result = system("rspec #{options[:file]} --format json")

puts JSON.generate({
  success: result,
  passed: 0,
  failed: 0,
  total: 0,
  duration: 0,
  failures: []
})

exit(result ? 0 : 1)
