# Rails Background Jobs Example
#
# Comprehensive background job processing demonstrating:
# - Active Job interface
# - Sidekiq workers
# - Retry strategies (exponential backoff)
# - Batch processing
# - Scheduled jobs (cron)
# - Job callbacks
# - Unique jobs
# - Error handling
# - Job monitoring
#
# Stack:
# - Rails 7.0+
# - Sidekiq 7.0+
# - Redis
# - sidekiq-scheduler (for cron jobs)

# ==========================================
# BASIC ACTIVE JOB
# ==========================================

# app/jobs/send_welcome_email_job.rb
class SendWelcomeEmailJob < ApplicationJob
  queue_as :emails

  # Retry on transient errors
  retry_on Net::SMTPServerBusy, wait: 1.minute, attempts: 5
  retry_on Net::OpenTimeout, wait: :exponentially_longer, attempts: 10

  # Don't retry on permanent failures
  discard_on ActiveJob::DeserializationError
  discard_on ActiveRecord::RecordNotFound

  def perform(user_id)
    user = User.find(user_id)
    UserMailer.welcome_email(user).deliver_now

    # Track successful delivery
    Rails.logger.info("Welcome email sent to user #{user.id}")
  rescue ActiveRecord::RecordNotFound => e
    # User was deleted before job ran
    Rails.logger.warn("User #{user_id} not found: #{e.message}")
  end
end

# Usage:
# SendWelcomeEmailJob.perform_later(user.id)
# SendWelcomeEmailJob.set(wait: 1.hour).perform_later(user.id)

# ==========================================
# SIDEKIQ WORKER (Direct)
# ==========================================

# app/workers/process_payment_worker.rb
class ProcessPaymentWorker
  include Sidekiq::Worker

  sidekiq_options queue: :critical,
                  retry: 5,
                  backtrace: true,
                  dead: true

  def perform(payment_id)
    payment = Payment.find(payment_id)

    result = PaymentGateway.charge(
      amount: payment.amount,
      customer: payment.customer_id
    )

    if result.success?
      payment.update!(
        status: :completed,
        transaction_id: result.transaction_id,
        processed_at: Time.current
      )
    else
      payment.update!(status: :failed, error_message: result.error)
      raise PaymentError, result.error
    end
  rescue PaymentError => e
    Rails.logger.error("Payment #{payment_id} failed: #{e.message}")
    # Re-raise to trigger Sidekiq retry
    raise
  end
end

# Usage:
# ProcessPaymentWorker.perform_async(payment.id)
# ProcessPaymentWorker.perform_in(5.minutes, payment.id)

# ==========================================
# CUSTOM RETRY STRATEGY
# ==========================================

# app/jobs/sync_external_data_job.rb
class SyncExternalDataJob < ApplicationJob
  queue_as :default

  # Custom retry with exponential backoff + jitter
  retry_on ExternalAPI::RateLimitError do |job, exception|
    wait_time = (job.executions ** 2) + rand(1..30)
    job.retry_job(wait: wait_time.seconds, queue: :low)
  end

  # Don't retry permanent errors
  discard_on ExternalAPI::NotFoundError

  def perform(entity_id)
    entity = Entity.find(entity_id)

    response = ExternalAPI.fetch(entity.external_id)

    case response.status
    when :success
      entity.update!(
        external_data: response.data,
        synced_at: Time.current
      )
    when :rate_limited
      # Will trigger retry with exponential backoff
      raise ExternalAPI::RateLimitError
    when :not_found
      # Won't retry - entity doesn't exist
      entity.update!(sync_failed: true, error: 'Not found')
    end
  end
end

# ==========================================
# BATCH PROCESSING
# ==========================================

# app/jobs/import_csv_job.rb
class ImportCsvJob < ApplicationJob
  queue_as :imports

  retry_on StandardError, wait: :exponentially_longer, attempts: 3

  def perform(import_id)
    import = Import.find(import_id)

    import.update!(
      status: :processing,
      started_at: Time.current
    )

    process_import_in_batches(import)

    import.update!(
      status: :completed,
      completed_at: Time.current,
      total_processed: import.processed_count
    )
  rescue StandardError => e
    import.update!(
      status: :failed,
      error_message: e.message,
      failed_at: Time.current
    )
    Rails.logger.error("Import #{import_id} failed: #{e.message}\n#{e.backtrace.join("\n")}")
    raise
  end

  private

  def process_import_in_batches(import)
    # Process CSV in chunks to avoid memory issues
    CSV.foreach(import.file_path, headers: true).each_slice(100) do |batch|
      batch.each do |row|
        process_row(import, row)
        import.increment!(:processed_count)
      end
    end
  end

  def process_row(import, row)
    # Create or update record from CSV row
    User.find_or_initialize_by(email: row['email']).tap do |user|
      user.name = row['name']
      user.save!
    end
  rescue ActiveRecord::RecordInvalid => e
    Rails.logger.warn("Skipped row: #{row.to_h} - #{e.message}")
    import.increment!(:failed_rows_count)
  end
end

# ==========================================
# PARALLEL BATCH PROCESSING
# ==========================================

# app/jobs/process_large_dataset_job.rb
class ProcessLargeDatasetJob < ApplicationJob
  queue_as :batch_processing

  def perform(dataset_id)
    dataset = Dataset.find(dataset_id)

    # Enqueue separate jobs for each batch
    dataset.records.find_in_batches(batch_size: 100).with_index do |batch, index|
      ProcessBatchJob.set(wait: index * 10.seconds).perform_later(batch.ids)
    end
  end
end

# app/jobs/process_batch_job.rb
class ProcessBatchJob < ApplicationJob
  queue_as :batch_processing

  def perform(record_ids)
    records = Record.where(id: record_ids)

    # Process each record
    records.each do |record|
      process_record(record)
    end

    Rails.logger.info("Processed batch of #{record_ids.size} records")
  end

  private

  def process_record(record)
    # Complex processing logic
    record.process!
  end
end

# ==========================================
# SCHEDULED/CRON JOBS
# ==========================================

# app/jobs/daily_report_job.rb
class DailyReportJob < ApplicationJob
  queue_as :reports

  def perform(date = Date.yesterday)
    report_data = generate_report_data(date)

    DailyReport.create!(
      date: date,
      data: report_data,
      total_users: report_data[:users],
      total_revenue: report_data[:revenue],
      generated_at: Time.current
    )

    # Send report to stakeholders
    ReportMailer.daily_summary(date, report_data).deliver_now
  end

  private

  def generate_report_data(date)
    {
      users: User.where(created_at: date.all_day).count,
      posts: Post.where(created_at: date.all_day).count,
      revenue: Order.where(created_at: date.all_day).sum(:total),
      active_users: User.where(last_active_at: date.all_day).count
    }
  end
end

# app/jobs/cleanup_old_records_job.rb
class CleanupOldRecordsJob < ApplicationJob
  queue_as :maintenance

  def perform
    # Delete old temporary records
    deleted_count = TempRecord.where('created_at < ?', 7.days.ago).delete_all

    # Archive old completed orders
    archived_count = Order.where('completed_at < ?', 90.days.ago)
                          .where(archived: false)
                          .update_all(archived: true)

    Rails.logger.info("Cleanup complete: deleted #{deleted_count}, archived #{archived_count}")
  end
end

# ==========================================
# JOB WITH CALLBACKS
# ==========================================

# app/jobs/notification_job.rb
class NotificationJob < ApplicationJob
  queue_as :notifications

  before_perform do |job|
    Rails.logger.info "Starting notification job: #{job.arguments.inspect}"
    @start_time = Time.current
  end

  after_perform do |job|
    duration = Time.current - @start_time
    Rails.logger.info "Completed notification job in #{duration}s"
    JobMetrics.track('notification_job', duration: duration)
  end

  around_perform do |job, block|
    # Could add instrumentation, monitoring, etc.
    ActiveSupport::Notifications.instrument('job.perform', job: job.class.name) do
      block.call
    end
  end

  def perform(user_id, notification_type, message)
    user = User.find(user_id)

    case notification_type
    when 'email'
      UserMailer.notification(user, message).deliver_now
    when 'sms'
      SmsService.send(user.phone, message)
    when 'push'
      PushNotificationService.send(user.device_tokens, message)
    else
      raise ArgumentError, "Unknown notification type: #{notification_type}"
    end
  end
end

# ==========================================
# IMAGE PROCESSING JOB
# ==========================================

# app/jobs/process_image_job.rb
class ProcessImageJob < ApplicationJob
  queue_as :images

  retry_on StandardError, wait: :exponentially_longer, attempts: 3

  def perform(upload_id)
    upload = Upload.find(upload_id)

    # Generate thumbnails
    generate_thumbnail(upload, size: :small, dimensions: '150x150')
    generate_thumbnail(upload, size: :medium, dimensions: '300x300')
    generate_thumbnail(upload, size: :large, dimensions: '600x600')

    # Optimize original
    optimize_image(upload)

    upload.update!(
      processing_status: :completed,
      processed_at: Time.current
    )
  rescue => e
    upload.update!(
      processing_status: :failed,
      error_message: e.message
    )
    raise
  end

  private

  def generate_thumbnail(upload, size:, dimensions:)
    # Use ImageMagick or similar
    image = MiniMagick::Image.open(upload.file_path)
    image.resize dimensions
    thumbnail_path = "#{upload.base_path}_#{size}.jpg"
    image.write thumbnail_path

    upload.thumbnails[size] = thumbnail_path
    upload.save!
  end

  def optimize_image(upload)
    # Optimize file size without quality loss
    image = MiniMagick::Image.open(upload.file_path)
    image.strip       # Remove metadata
    image.quality "85" # Set quality
    image.write upload.file_path
  end
end

# ==========================================
# UNIQUE JOB (Prevent Duplicates)
# ==========================================

# app/jobs/sync_user_data_job.rb
class SyncUserDataJob < ApplicationJob
  queue_as :sync

  # Using sidekiq-unique-jobs gem
  # Only one job per user_id can run at a time
  sidekiq_options lock: :until_executed,
                  on_conflict: :log,
                  lock_args_method: :lock_args

  def self.lock_args(args)
    # Only lock on user_id, ignore other arguments
    [args.first]
  end

  def perform(user_id, force: false)
    user = User.find(user_id)

    # Skip if recently synced (unless forced)
    return if !force && user.synced_at && user.synced_at > 1.hour.ago

    # Perform expensive sync operation
    external_data = ExternalAPI.fetch_user_data(user.external_id)

    user.update!(
      external_data: external_data,
      synced_at: Time.current
    )
  end
end

# ==========================================
# CONFIGURATION
# ==========================================

# config/sidekiq.yml
# :concurrency: 5
# :queues:
#   - critical
#   - default
#   - emails
#   - imports
#   - reports
#   - maintenance
#   - low
#
# :max_retries: 5
# :timeout: 30

# config/initializers/sidekiq.rb
require 'sidekiq'
require 'sidekiq-scheduler'

Sidekiq.configure_server do |config|
  config.redis = { url: ENV.fetch('REDIS_URL', 'redis://localhost:6379/0') }

  # Load scheduled jobs
  config.on(:startup) do
    Sidekiq.schedule = YAML.load_file(Rails.root.join('config', 'schedule.yml'))
    SidekiqScheduler::Scheduler.instance.reload_schedule!
  end
end

Sidekiq.configure_client do |config|
  config.redis = { url: ENV.fetch('REDIS_URL', 'redis://localhost:6379/0') }
end

# config/schedule.yml
# daily_report:
#   cron: "0 2 * * *"              # Every day at 2 AM
#   class: "DailyReportJob"
#   queue: reports
#
# hourly_cleanup:
#   cron: "0 * * * *"              # Every hour
#   class: "CleanupOldRecordsJob"
#   queue: maintenance
#
# weekly_digest:
#   cron: "0 9 * * 1"              # Every Monday at 9 AM
#   class: "WeeklyDigestJob"
#   queue: emails
#
# every_15_minutes:
#   cron: "*/15 * * * *"           # Every 15 minutes
#   class: "SyncExternalDataJob"
#   queue: sync

# config/routes.rb
require 'sidekiq/web'

Rails.application.routes.draw do
  # Mount Sidekiq dashboard (protect in production!)
  authenticate :user, ->(user) { user.admin? } do
    mount Sidekiq::Web => '/sidekiq'
  end
end

# ==========================================
# MONITORING & LOGGING
# ==========================================

# app/jobs/concerns/job_logging.rb
module JobLogging
  extend ActiveSupport::Concern

  included do
    before_perform do |job|
      JobExecution.create!(
        job_class: job.class.name,
        arguments: job.arguments,
        queue: job.queue_name,
        status: :running,
        started_at: Time.current
      )
    end

    after_perform do |job|
      execution = JobExecution.find_by(
        job_class: job.class.name,
        status: :running
      )

      execution&.update!(
        status: :completed,
        completed_at: Time.current,
        duration: Time.current - execution.started_at
      )
    end
  end
end

# Usage in job:
# include JobLogging

# ==========================================
# CUSTOM ERROR HANDLING
# ==========================================

# app/jobs/concerns/error_notifier.rb
module ErrorNotifier
  extend ActiveSupport::Concern

  included do
    rescue_from StandardError do |exception|
      notify_error(exception)
      raise exception # Re-raise to trigger retry
    end
  end

  private

  def notify_error(exception)
    # Send to error tracking service (Sentry, Honeybadger, etc.)
    ErrorTracker.notify(
      exception,
      job: self.class.name,
      arguments: arguments,
      queue: queue_name
    )

    # Also log locally
    Rails.logger.error("Job failed: #{self.class.name}")
    Rails.logger.error("Error: #{exception.message}")
    Rails.logger.error(exception.backtrace.join("\n"))
  end
end

# ==========================================
# TESTS (RSpec)
# ==========================================

# spec/jobs/send_welcome_email_job_spec.rb
require 'rails_helper'

RSpec.describe SendWelcomeEmailJob, type: :job do
  let(:user) { create(:user) }

  describe '#perform' do
    it 'sends welcome email' do
      expect {
        described_class.perform_now(user.id)
      }.to change { ActionMailer::Base.deliveries.count }.by(1)
    end

    it 'handles missing user gracefully' do
      expect {
        described_class.perform_now(999999)
      }.not_to raise_error
    end
  end

  describe 'retry behavior' do
    it 'retries on transient errors' do
      allow(UserMailer).to receive(:welcome_email).and_raise(Net::SMTPServerBusy)

      expect {
        described_class.perform_now(user.id)
      }.to raise_error(Net::SMTPServerBusy)

      # Verify job was enqueued for retry
      expect(described_class).to have_been_enqueued
    end

    it 'does not retry on permanent errors' do
      allow(UserMailer).to receive(:welcome_email).and_raise(ActiveJob::DeserializationError)

      expect {
        described_class.perform_now(user.id)
      }.to raise_error(ActiveJob::DeserializationError)

      # Verify job was not retried
      expect(described_class).not_to have_been_enqueued
    end
  end

  describe 'job enqueuing' do
    it 'enqueues job with correct queue' do
      expect {
        described_class.perform_later(user.id)
      }.to have_enqueued_job(described_class)
        .on_queue('emails')
        .with(user.id)
    end

    it 'enqueues delayed job' do
      expect {
        described_class.set(wait: 1.hour).perform_later(user.id)
      }.to have_enqueued_job(described_class)
        .at(1.hour.from_now)
    end
  end
end

# spec/workers/process_payment_worker_spec.rb
require 'rails_helper'

RSpec.describe ProcessPaymentWorker do
  let(:payment) { create(:payment) }

  describe '#perform' do
    context 'when payment succeeds' do
      before do
        allow(PaymentGateway).to receive(:charge).and_return(
          double(success?: true, transaction_id: 'txn_123')
        )
      end

      it 'updates payment status' do
        described_class.new.perform(payment.id)
        payment.reload

        expect(payment.status).to eq('completed')
        expect(payment.transaction_id).to eq('txn_123')
        expect(payment.processed_at).to be_present
      end
    end

    context 'when payment fails' do
      before do
        allow(PaymentGateway).to receive(:charge).and_return(
          double(success?: false, error: 'Insufficient funds')
        )
      end

      it 'updates payment status and raises error' do
        expect {
          described_class.new.perform(payment.id)
        }.to raise_error(PaymentError)

        payment.reload
        expect(payment.status).to eq('failed')
        expect(payment.error_message).to eq('Insufficient funds')
      end
    end
  end
end

# ==========================================
# BEST PRACTICES SUMMARY
# ==========================================

# 1. Always pass IDs, not objects
#    Good: MyJob.perform_later(user.id)
#    Bad:  MyJob.perform_later(user)
#
# 2. Use appropriate retry strategies
#    - retry_on for transient errors
#    - discard_on for permanent failures
#    - Custom retry logic for complex scenarios
#
# 3. Handle missing records gracefully
#    - Rescue ActiveRecord::RecordNotFound
#    - Log warnings for debugging
#
# 4. Process large datasets in batches
#    - Use find_in_batches or in_batches
#    - Avoid loading entire collections into memory
#
# 5. Set appropriate queue priorities
#    - critical: Time-sensitive (payments, auth)
#    - default: Normal operations
#    - low: Background cleanup
#
# 6. Monitor job performance
#    - Use callbacks to track duration
#    - Send metrics to monitoring service
#    - Set up alerts for failures
#
# 7. Test thoroughly
#    - Unit test job logic
#    - Test retry behavior
#    - Test error handling
#
# 8. Use transactions for data consistency
#    - Wrap database operations in transactions
#    - Ensure atomicity of multi-step processes
#
# 9. Configure dead job queue
#    - Review failed jobs regularly
#    - Set reasonable retry limits
#
# 10. Document job purpose and behavior
#     - Clear comments explaining business logic
#     - Document retry strategies
#     - Note any external dependencies
