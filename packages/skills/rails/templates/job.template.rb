# Rails Background Job Template (Active Job + Sidekiq)
#
# Placeholder System:
# - {{ActionName}} → Action verb + noun (e.g., SendWelcomeEmail, ProcessDataImport)
# - {{ClassName}} → Model class name (e.g., User, BlogPost)
# - {{class_name}} → snake_case model name (e.g., user, blog_post)
# - {{queue_name}} → Queue name (e.g., emails, imports, critical, default)
#
# Usage Example:
# Replace placeholders with actual values:
#   {{ActionName}} = SendWelcomeEmail
#   {{ClassName}} = User
#   {{class_name}} = user
#   {{queue_name}} = emails
#
# Queue Priority (configure in config/sidekiq.yml):
#   - critical: Time-sensitive operations (priority: 0)
#   - default: Standard operations (priority: 1)
#   - emails: Email delivery (priority: 2)
#   - imports: Data imports (priority: 3)
#   - low: Background cleanup (priority: 4)

# ==========================================
# BASIC ACTIVE JOB
# ==========================================
class {{ActionName}}Job < ApplicationJob
  queue_as :{{queue_name}}

  # Retry configuration
  retry_on ActiveRecord::Deadlocked, wait: 5.seconds, attempts: 3
  retry_on Net::OpenTimeout, wait: :exponentially_longer, attempts: 10

  # Discard job on certain errors (don't retry)
  discard_on ActiveJob::DeserializationError
  discard_on ActiveRecord::RecordNotFound

  def perform({{class_name}}_id)
    {{class_name}} = {{ClassName}}.find({{class_name}}_id)
    process_{{class_name}}({{class_name}})
  rescue ActiveRecord::RecordNotFound => e
    Rails.logger.warn("{{ClassName}} #{{{class_name}}_id} not found: #{e.message}")
    # Job discarded automatically
  end

  private

  def process_{{class_name}}({{class_name}})
    # Main job logic here
  end
end

# Usage:
# {{ActionName}}Job.perform_later({{class_name}}.id)                    # Enqueue async
# {{ActionName}}Job.perform_now({{class_name}}.id)                      # Execute sync
# {{ActionName}}Job.set(wait: 1.hour).perform_later({{class_name}}.id)  # Delayed execution

# ==========================================
# SIDEKIQ WORKER (Direct)
# ==========================================
class {{ActionName}}Worker
  include Sidekiq::Worker

  # Sidekiq options
  sidekiq_options queue: :{{queue_name}},
                  retry: 5,
                  backtrace: true,
                  dead: true

  def perform({{class_name}}_id)
    {{class_name}} = {{ClassName}}.find({{class_name}}_id)
    process_{{class_name}}({{class_name}})
  rescue StandardError => e
    Rails.logger.error("{{ActionName}}Worker failed: #{e.message}")
    Rails.logger.error(e.backtrace.join("\n"))
    raise # Re-raise to trigger retry
  end

  private

  def process_{{class_name}}({{class_name}})
    # Main job logic here
  end
end

# Usage:
# {{ActionName}}Worker.perform_async({{class_name}}.id)                    # Enqueue
# {{ActionName}}Worker.perform_in(1.hour, {{class_name}}.id)               # Delayed
# {{ActionName}}Worker.perform_at(Time.now + 1.day, {{class_name}}.id)     # Scheduled

# ==========================================
# EMAIL DELIVERY JOB
# ==========================================
class Send{{ClassName}}EmailJob < ApplicationJob
  queue_as :emails

  retry_on Net::SMTPServerBusy, wait: 1.minute, attempts: 5
  discard_on Net::SMTPFatalError

  def perform({{class_name}}_id, email_type)
    {{class_name}} = {{ClassName}}.find({{class_name}}_id)

    case email_type
    when 'welcome'
      {{ClassName}}Mailer.welcome_email({{class_name}}).deliver_now
    when 'notification'
      {{ClassName}}Mailer.notification_email({{class_name}}).deliver_now
    else
      raise ArgumentError, "Unknown email type: #{email_type}"
    end
  end
end

# ==========================================
# DATA IMPORT JOB (with batch processing)
# ==========================================
class Process{{ClassName}}ImportJob < ApplicationJob
  queue_as :imports

  retry_on StandardError, wait: :exponentially_longer, attempts: 5

  def perform(import_id)
    import = Import.find(import_id)

    import.update!(status: :processing, started_at: Time.current)

    process_import_in_batches(import)

    import.update!(
      status: :completed,
      completed_at: Time.current,
      total_processed: import.total_records
    )
  rescue StandardError => e
    import.update!(
      status: :failed,
      error_message: e.message,
      failed_at: Time.current
    )
    raise
  end

  private

  def process_import_in_batches(import)
    import.items.find_in_batches(batch_size: 100) do |batch|
      batch.each do |item|
        process_item(item)
        import.increment!(:processed_count)
      end
    end
  end

  def process_item(item)
    # Process individual item
    {{ClassName}}.create!(item.attributes)
  end
end

# ==========================================
# RETRY WITH CUSTOM BACKOFF
# ==========================================
class {{ActionName}}WithCustomRetryJob < ApplicationJob
  queue_as :{{queue_name}}

  # Custom retry logic
  retry_on CustomRetryableError do |job, exception|
    # Exponential backoff with jitter
    wait_time = (job.executions**2) + rand(1..30)
    job.retry_job(wait: wait_time.seconds)
  end

  def perform({{class_name}}_id)
    {{class_name}} = {{ClassName}}.find({{class_name}}_id)

    result = ExternalAPI.process({{class_name}})

    case result.status
    when :success
      {{class_name}}.update!(processed: true)
    when :rate_limited
      # Will trigger retry with exponential backoff
      raise CustomRetryableError, 'Rate limited'
    when :permanent_failure
      # Don't retry
      {{class_name}}.update!(processing_failed: true, error: result.error)
    end
  end
end

# ==========================================
# SCHEDULED/CRON JOB
# ==========================================
class Daily{{ClassName}}ReportJob < ApplicationJob
  queue_as :reports

  def perform(date = Date.yesterday)
    report_data = generate_report_data(date)

    {{ClassName}}Report.create!(
      date: date,
      data: report_data,
      total_count: report_data[:total],
      generated_at: Time.current
    )

    # Send report to stakeholders
    ReportMailer.daily_report(date, report_data).deliver_now
  end

  private

  def generate_report_data(date)
    {
      total: {{ClassName}}.where(created_at: date.all_day).count,
      active: {{ClassName}}.active.where(created_at: date.all_day).count,
      revenue: calculate_revenue(date)
    }
  end

  def calculate_revenue(date)
    # Revenue calculation logic
  end
end

# Configure in config/initializers/sidekiq.rb:
# require 'sidekiq-scheduler'
#
# Sidekiq.configure_server do |config|
#   config.on(:startup) do
#     Sidekiq.schedule = {
#       'daily_report' => {
#         'cron' => '0 2 * * *',  # Every day at 2 AM
#         'class' => 'Daily{{ClassName}}ReportJob'
#       }
#     }
#     SidekiqScheduler::Scheduler.instance.reload_schedule!
#   end
# end

# ==========================================
# UNIQUE JOB (prevent duplicates)
# ==========================================
class Unique{{ActionName}}Job < ApplicationJob
  queue_as :{{queue_name}}

  # Using sidekiq-unique-jobs gem
  # Ensures only one job with same arguments runs at a time
  sidekiq_options lock: :until_executed,
                  on_conflict: :log

  def perform({{class_name}}_id)
    {{class_name}} = {{ClassName}}.find({{class_name}}_id)
    process_{{class_name}}({{class_name}})
  end

  private

  def process_{{class_name}}({{class_name}})
    # Expensive operation that shouldn't run concurrently
  end
end

# ==========================================
# BATCH JOB (ActiveJob::Batch - Sidekiq Pro)
# ==========================================
class {{ClassName}}BatchJob < ApplicationJob
  queue_as :batch_processing

  def perform({{class_name}}_ids)
    batch = Sidekiq::Batch.new
    batch.description = "Processing #{{{class_name}}_ids.size} {{table_name}}"

    batch.on(:success, {{ClassName}}BatchCallback, 'batch_id' => batch.bid)

    batch.jobs do
      {{class_name}}_ids.each do |id|
        Process{{ClassName}}Job.perform_later(id)
      end
    end
  end
end

class {{ClassName}}BatchCallback
  def on_success(status, options)
    batch_id = options['batch_id']
    Rails.logger.info "Batch #{batch_id} completed successfully"
    # Trigger completion actions
  end
end

# ==========================================
# JOB CALLBACKS
# ==========================================
class {{ActionName}}JobWithCallbacks < ApplicationJob
  queue_as :{{queue_name}}

  before_perform do |job|
    Rails.logger.info "Starting job: #{job.class.name} with args: #{job.arguments}"
  end

  after_perform do |job|
    Rails.logger.info "Completed job: #{job.class.name}"
  end

  around_perform do |job, block|
    start_time = Time.current
    block.call
    duration = Time.current - start_time
    Rails.logger.info "Job #{job.class.name} took #{duration}s"

    # Track metrics
    # Metrics.track('job_duration', duration, job: job.class.name)
  end

  def perform({{class_name}}_id)
    {{class_name}} = {{ClassName}}.find({{class_name}}_id)
    process_{{class_name}}({{class_name}})
  end
end

# ==========================================
# BEST PRACTICES
# ==========================================
#
# 1. Always pass IDs, not Active Record objects
#    Good: MyJob.perform_later(user.id)
#    Bad:  MyJob.perform_later(user)
#
# 2. Use appropriate retry strategies
#    - retry_on for retriable errors
#    - discard_on for permanent failures
#
# 3. Set appropriate queue priorities
#    - Use 'critical' for time-sensitive jobs
#    - Use 'low' for background cleanup
#
# 4. Log errors comprehensively
#    - Include context and backtrace
#    - Use structured logging for metrics
#
# 5. Handle missing records gracefully
#    - Rescue ActiveRecord::RecordNotFound
#    - Log warnings for debugging
#
# 6. Use transactions for data consistency
#    - Wrap database operations in ActiveRecord::Base.transaction
#
# 7. Monitor job performance
#    - Use callbacks to track duration
#    - Set up alerts for failed jobs
#
# 8. Test jobs thoroughly
#    - Unit test job logic
#    - Integration test with test queue adapter
#
# 9. Use batch processing for large datasets
#    - Process in chunks to avoid memory issues
#    - Use find_in_batches or in_batches
#
# 10. Configure dead job queue
#     - Review failed jobs regularly
#     - Set up retry limits to prevent infinite loops
