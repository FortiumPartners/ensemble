require_relative "boot"
require "rails/all"

Bundler.require(*Rails.groups)

module Planner
  class Application < Rails::Application
    config.load_defaults 7.1
    config.active_job.queue_adapter = :sidekiq
    config.api_only = true
  end
end
