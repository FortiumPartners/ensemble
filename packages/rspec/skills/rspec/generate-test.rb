#!/usr/bin/env ruby
# frozen_string_literal: true

# RSpec Test Generator
#
# Generates an RSpec spec skeleton for a Ruby source file and prints a JSON
# result on stdout. The generated example is marked `skip` until a real
# Arrange/Act/Assert body is written, so it can never pass vacuously.
require 'fileutils'
require 'json'
require 'optparse'
require 'pathname'

def fail_with(message, extra = {})
  puts JSON.generate({ success: false, error: message }.merge(extra))
  exit 1
end

options = { force: false }
OptionParser.new do |opts|
  opts.on('--source=SOURCE') { |v| options[:source] = v }
  opts.on('--output=OUTPUT') { |v| options[:output] = v }
  opts.on('--description=DESC') { |v| options[:description] = v }
  opts.on('--class=NAME') { |v| options[:class_name] = v }
  opts.on('--force') { options[:force] = true }
end.parse!

fail_with('--source is required') unless options[:source]
fail_with('--output is required') unless options[:output]
fail_with('Source file not found', file: options[:source]) unless File.file?(options[:source])
if File.exist?(options[:output]) && !options[:force]
  fail_with('Output file already exists (use --force to overwrite)', file: options[:output])
end

basename = File.basename(options[:source], '.*')
# user_service -> UserService (override with --class for namespaced constants)
class_name = options[:class_name] || basename.split('_').map(&:capitalize).join

output_dir = File.dirname(File.expand_path(options[:output]))
require_path = Pathname.new(File.expand_path(options[:source]))
                       .relative_path_from(Pathname.new(output_dir))
                       .sub_ext('')
                       .to_s

description = options[:description] || 'basic functionality'

template = <<~RUBY
  # frozen_string_literal: true

  require_relative #{require_path.inspect}

  RSpec.describe #{class_name} do
    describe #{description.inspect} do
      it #{description.inspect} do
        skip 'Replace with a real Arrange/Act/Assert before relying on this spec'

        # Arrange

        # Act

        # Assert
      end
    end
  end
RUBY

FileUtils.mkdir_p(output_dir)
File.write(options[:output], template)

puts JSON.generate({
                     success: true,
                     testFile: options[:output],
                     testCount: 1,
                     template: 'unit-test',
                     className: class_name
                   })
