#!/usr/bin/env ruby
# RSpec Test Generator
require 'json'
require 'optparse'

options = {}
OptionParser.new do |opts|
  opts.on("--source=SOURCE") { |v| options[:source] = v }
  opts.on("--output=OUTPUT") { |v| options[:output] = v }
  opts.on("--description=DESC") { |v| options[:description] = v }
end.parse!

module_name = File.basename(options[:source], '.*').capitalize

template = <<~RUBY
  require_relative '../lib/#{File.basename(options[:source], '.*')}'
  
  RSpec.describe #{module_name} do
    describe '#{options[:description] || "basic functionality"}' do
      it '#{options[:description] || "works correctly"}' do
        # Arrange
        
        # Act
        
        # Assert
        expect(true).to be true
      end
    end
  end
RUBY

File.write(options[:output], template)

puts JSON.generate({
  success: true,
  testFile: options[:output],
  testCount: 1,
  template: 'unit-test'
})
