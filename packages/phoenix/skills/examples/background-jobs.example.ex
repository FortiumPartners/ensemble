# Example: Background Job Processing with Oban
# Demonstrates: Oban workers, scheduling, retry strategies, cron jobs, unique jobs

# ============================================================================
# OBAN CONFIGURATION
# ============================================================================

# config/config.exs
# config :my_app, Oban,
#   repo: MyApp.Repo,
#   queues: [
#     default: 10,
#     emails: 20,
#     reports: 5,
#     analytics: 10,
#     media: 5
#   ],
#   plugins: [
#     {Oban.Plugins.Pruner, max_age: 3600},
#     {Oban.Plugins.Stager, interval: 1000},
#     {Oban.Plugins.Lifeline, rescue_after: :timer.minutes(30)},
#     {Oban.Plugins.Cron,
#      crontab: [
#        {"0 2 * * *", MyApp.Workers.DailyReportWorker},
#        {"*/15 * * * *", MyApp.Workers.CacheWarmerWorker},
#        {"0 0 * * 0", MyApp.Workers.WeeklyDigestWorker},
#        {"0 3 1 * *", MyApp.Workers.MonthlyInvoiceWorker}
#      ]}
#   ]

# ============================================================================
# EMAIL WORKER
# ============================================================================

defmodule MyApp.Workers.EmailWorker do
  @moduledoc """
  Worker for sending transactional emails with retry logic.
  """

  use Oban.Worker,
    queue: :emails,
    max_attempts: 3,
    priority: 1,
    unique: [period: 60, fields: [:args], keys: [:user_id, :type]]

  alias MyApp.Mailer
  alias MyApp.Accounts

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"type" => "welcome", "user_id" => user_id}}) do
    user = Accounts.get_user!(user_id)
    Mailer.send_welcome_email(user)
    :ok
  end

  def perform(%Oban.Job{args: %{"type" => "password_reset", "user_id" => user_id, "token" => token}}) do
    user = Accounts.get_user!(user_id)
    Mailer.send_password_reset(user, token)
    :ok
  end

  def perform(%Oban.Job{args: %{"type" => "verification", "user_id" => user_id, "code" => code}}) do
    user = Accounts.get_user!(user_id)
    Mailer.send_verification_email(user, code)
    :ok
  end

  def perform(%Oban.Job{args: %{"type" => "daily_digest", "user_id" => user_id}}) do
    user = Accounts.get_user!(user_id)
    digest_data = MyApp.Analytics.get_daily_digest(user_id)
    Mailer.send_daily_digest(user, digest_data)
    :ok
  end

  def perform(%Oban.Job{args: args}) do
    {:error, "Unknown email type: #{inspect(args)}"}
  end

  # Schedule email jobs
  def schedule_welcome_email(user_id) do
    %{type: "welcome", user_id: user_id}
    |> new()
    |> Oban.insert()
  end

  def schedule_password_reset(user_id, token) do
    %{type: "password_reset", user_id: user_id, token: token}
    |> new()
    |> Oban.insert()
  end

  def schedule_daily_digest(user_id) do
    %{type: "daily_digest", user_id: user_id}
    |> new(schedule_in: :timer.hours(24))
    |> Oban.insert()
  end
end

# ============================================================================
# IMAGE PROCESSING WORKER
# ============================================================================

defmodule MyApp.Workers.ImageProcessorWorker do
  @moduledoc """
  Worker for processing uploaded images (resize, optimize, generate thumbnails).
  """

  use Oban.Worker,
    queue: :media,
    max_attempts: 5,
    priority: 2

  alias MyApp.Storage
  alias MyApp.Media

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"image_id" => image_id}, attempt: attempt}) do
    image = Media.get_image!(image_id)

    case process_image(image) do
      {:ok, processed_image} ->
        Media.update_image_status(image, :processed, processed_image)
        :ok

      {:error, :temporary_error} ->
        # Exponential backoff: 2^attempt seconds
        backoff = :math.pow(2, attempt) |> round()
        {:snooze, backoff}

      {:error, :permanent_error} ->
        Media.update_image_status(image, :failed, %{error: "Processing failed"})
        {:cancel, "permanent error"}
    end
  end

  defp process_image(image) do
    with {:ok, original} <- Storage.download(image.original_path),
         {:ok, resized} <- resize_image(original, 1200, 800),
         {:ok, thumbnail} <- resize_image(original, 300, 200),
         {:ok, optimized} <- optimize_image(resized),
         {:ok, resized_path} <- Storage.upload(optimized, "resized"),
         {:ok, thumbnail_path} <- Storage.upload(thumbnail, "thumbnails") do
      {:ok, %{resized_path: resized_path, thumbnail_path: thumbnail_path}}
    else
      {:error, :network_error} -> {:error, :temporary_error}
      {:error, :invalid_format} -> {:error, :permanent_error}
      error -> error
    end
  end

  defp resize_image(_image, _width, _height) do
    # Use ImageMagick, Mogrify, or similar
    {:ok, <<>>}
  end

  defp optimize_image(_image) do
    # Optimize file size
    {:ok, <<>>}
  end

  # Schedule image processing
  def schedule_image_processing(image_id) do
    %{image_id: image_id}
    |> new()
    |> Oban.insert()
  end
end

# ============================================================================
# BATCH PROCESSING WORKER
# ============================================================================

defmodule MyApp.Workers.BatchProcessorWorker do
  @moduledoc """
  Worker for processing large batches of data with chunking.
  """

  use Oban.Worker,
    queue: :default,
    max_attempts: 1

  alias MyApp.Batches

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"batch_id" => batch_id}}) do
    batch = Batches.get_batch!(batch_id)
    items = Batches.get_batch_items(batch_id)

    Batches.update_batch_status(batch, :processing)

    # Process in chunks to avoid memory issues
    results =
      items
      |> Enum.chunk_every(100)
      |> Enum.map(fn chunk ->
        process_chunk(chunk)
      end)

    if Enum.all?(results, &(&1 == :ok)) do
      Batches.update_batch_status(batch, :completed)
      :ok
    else
      Batches.update_batch_status(batch, :failed)
      {:error, "Some items failed to process"}
    end
  end

  defp process_chunk(items) do
    # Process items in parallel with limited concurrency
    items
    |> Task.async_stream(&process_item/1,
      max_concurrency: 10,
      timeout: 30_000,
      on_timeout: :kill_task
    )
    |> Enum.all?(fn
      {:ok, :ok} -> true
      _ -> false
    end)
    |> if(do: :ok, else: :error)
  end

  defp process_item(item) do
    # Process individual item
    :timer.sleep(100)
    :ok
  end

  # Schedule batch processing
  def schedule_batch(batch_id) do
    %{batch_id: batch_id}
    |> new()
    |> Oban.insert()
  end
end

# ============================================================================
# API INTEGRATION WORKER
# ============================================================================

defmodule MyApp.Workers.APIWorker do
  @moduledoc """
  Worker for calling external APIs with retry and rate limiting.
  """

  use Oban.Worker,
    queue: :default,
    max_attempts: 5,
    priority: 2

  alias MyApp.ExternalAPI

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"action" => "sync_user", "user_id" => user_id}, attempt: attempt}) do
    case ExternalAPI.sync_user(user_id) do
      {:ok, _data} ->
        :ok

      {:error, :rate_limited} ->
        # Rate limited - snooze for exponential backoff
        backoff = calculate_backoff(attempt)
        {:snooze, backoff}

      {:error, :timeout} ->
        # Timeout - retry with backoff
        {:snooze, calculate_backoff(attempt)}

      {:error, :not_found} ->
        # Permanent error - don't retry
        {:cancel, "user not found in external system"}

      {:error, reason} ->
        # Other errors - let Oban retry
        {:error, reason}
    end
  end

  def perform(%Oban.Job{args: %{"action" => "webhook", "url" => url, "payload" => payload}, attempt: attempt}) do
    case ExternalAPI.post_webhook(url, payload) do
      {:ok, _response} ->
        :ok

      {:error, :timeout} ->
        {:snooze, calculate_backoff(attempt)}

      {:error, status} when status in [500, 502, 503, 504] ->
        # Server errors - retry
        {:snooze, calculate_backoff(attempt)}

      {:error, status} when status in [400, 401, 403, 404] ->
        # Client errors - don't retry
        {:cancel, "client error: #{status}"}
    end
  end

  defp calculate_backoff(attempt) do
    # Exponential backoff with jitter: 2^attempt + random(0-1000)
    base = :math.pow(2, attempt) |> round()
    jitter = :rand.uniform(1000)
    base + jitter
  end

  # Schedule API jobs
  def schedule_user_sync(user_id) do
    %{action: "sync_user", user_id: user_id}
    |> new()
    |> Oban.insert()
  end

  def schedule_webhook(url, payload) do
    %{action: "webhook", url: url, payload: payload}
    |> new(max_attempts: 3)
    |> Oban.insert()
  end
end

# ============================================================================
# CRON WORKERS
# ============================================================================

defmodule MyApp.Workers.DailyReportWorker do
  @moduledoc """
  Worker for generating daily reports (runs at 2 AM daily).
  """

  use Oban.Worker,
    queue: :reports,
    max_attempts: 1

  alias MyApp.Reports
  alias MyApp.Accounts

  @impl Oban.Worker
  def perform(%Oban.Job{}) do
    yesterday = Date.utc_today() |> Date.add(-1)

    # Generate reports for all active users
    Accounts.list_active_users()
    |> Enum.each(fn user ->
      report = Reports.generate_daily_report(user.id, yesterday)
      Reports.save_report(report)

      # Schedule email delivery
      MyApp.Workers.EmailWorker.schedule_daily_digest(user.id)
    end)

    :ok
  end
end

defmodule MyApp.Workers.CacheWarmerWorker do
  @moduledoc """
  Worker for warming up cache (runs every 15 minutes).
  """

  use Oban.Worker,
    queue: :default,
    max_attempts: 1

  alias MyApp.Cache

  @impl Oban.Worker
  def perform(%Oban.Job{}) do
    # Warm up frequently accessed data
    Cache.warm_popular_posts()
    Cache.warm_trending_tags()
    Cache.warm_user_stats()

    :ok
  end
end

defmodule MyApp.Workers.WeeklyDigestWorker do
  @moduledoc """
  Worker for sending weekly digest emails (runs Sunday at midnight).
  """

  use Oban.Worker,
    queue: :emails,
    max_attempts: 1

  alias MyApp.Analytics
  alias MyApp.Accounts
  alias MyApp.Workers.EmailWorker

  @impl Oban.Worker
  def perform(%Oban.Job{}) do
    last_week = Date.utc_today() |> Date.add(-7)
    today = Date.utc_today()

    Accounts.list_users_with_digest_enabled()
    |> Enum.each(fn user ->
      digest_data = Analytics.get_weekly_digest(user.id, last_week, today)

      %{type: "weekly_digest", user_id: user.id, data: digest_data}
      |> EmailWorker.new()
      |> Oban.insert()
    end)

    :ok
  end
end

defmodule MyApp.Workers.MonthlyInvoiceWorker do
  @moduledoc """
  Worker for generating monthly invoices (runs 1st of month at 3 AM).
  """

  use Oban.Worker,
    queue: :default,
    max_attempts: 1

  alias MyApp.Billing
  alias MyApp.Accounts

  @impl Oban.Worker
  def perform(%Oban.Job{}) do
    last_month = Date.utc_today() |> Date.add(-30)

    Accounts.list_premium_users()
    |> Enum.each(fn user ->
      case Billing.generate_invoice(user.id, last_month) do
        {:ok, invoice} ->
          Billing.charge_customer(user, invoice)

        {:error, reason} ->
          Logger.error("Failed to generate invoice for user #{user.id}: #{reason}")
      end
    end)

    :ok
  end
end

# ============================================================================
# CLEANUP WORKER
# ============================================================================

defmodule MyApp.Workers.CleanupWorker do
  @moduledoc """
  Worker for cleaning up old data and temporary files.
  """

  use Oban.Worker,
    queue: :default,
    max_attempts: 1

  alias MyApp.Repo
  alias MyApp.Storage

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"type" => "expired_tokens"}}) do
    # Delete expired tokens
    from(t in "user_tokens",
      where: t.expires_at < ^DateTime.utc_now()
    )
    |> Repo.delete_all()

    :ok
  end

  def perform(%Oban.Job{args: %{"type" => "temporary_files"}}) do
    # Delete temporary files older than 24 hours
    cutoff = DateTime.utc_now() |> DateTime.add(-24 * 3600, :second)

    from(f in "temporary_files",
      where: f.inserted_at < ^cutoff
    )
    |> Repo.all()
    |> Enum.each(fn file ->
      Storage.delete(file.path)
      Repo.delete(file)
    end)

    :ok
  end

  def perform(%Oban.Job{args: %{"type" => "old_logs"}}) do
    # Archive logs older than 90 days
    cutoff = DateTime.utc_now() |> DateTime.add(-90 * 24 * 3600, :second)

    from(l in "logs",
      where: l.inserted_at < ^cutoff
    )
    |> Repo.delete_all()

    :ok
  end
end

# ============================================================================
# JOB SCHEDULING HELPERS
# ============================================================================

defmodule MyApp.JobScheduler do
  @moduledoc """
  Helper functions for scheduling Oban jobs.
  """

  alias MyApp.Workers

  # Immediate jobs
  def schedule_welcome_email(user_id) do
    Workers.EmailWorker.schedule_welcome_email(user_id)
  end

  def schedule_image_processing(image_id) do
    Workers.ImageProcessorWorker.schedule_image_processing(image_id)
  end

  # Delayed jobs
  def schedule_reminder(user_id, hours_from_now) do
    %{type: "reminder", user_id: user_id}
    |> Workers.EmailWorker.new(schedule_in: :timer.hours(hours_from_now))
    |> Oban.insert()
  end

  # Unique jobs (prevent duplicates)
  def schedule_daily_sync(user_id) do
    %{action: "sync_user", user_id: user_id}
    |> Workers.APIWorker.new(
      unique: [period: 86400, fields: [:args], keys: [:user_id]]
    )
    |> Oban.insert()
  end

  # Priority jobs
  def schedule_urgent_notification(user_id, message) do
    %{type: "urgent", user_id: user_id, message: message}
    |> Workers.EmailWorker.new(priority: 0)
    |> Oban.insert()
  end

  # Scheduled at specific time
  def schedule_campaign_email(user_id, send_at) do
    %{type: "campaign", user_id: user_id}
    |> Workers.EmailWorker.new(scheduled_at: send_at)
    |> Oban.insert()
  end
end

# ============================================================================
# OBAN TELEMETRY
# ============================================================================

defmodule MyApp.ObanTelemetry do
  @moduledoc """
  Telemetry handlers for Oban job monitoring.
  """

  require Logger

  def handle_event([:oban, :job, :start], _measurements, %{job: job}, _config) do
    Logger.info("Starting job: #{job.worker} (attempt #{job.attempt})")
  end

  def handle_event([:oban, :job, :stop], %{duration: duration}, %{job: job}, _config) do
    duration_ms = System.convert_time_unit(duration, :native, :millisecond)
    Logger.info("Completed job: #{job.worker} in #{duration_ms}ms")
  end

  def handle_event([:oban, :job, :exception], %{duration: duration}, %{job: job, reason: reason}, _config) do
    duration_ms = System.convert_time_unit(duration, :native, :millisecond)
    Logger.error("Job failed: #{job.worker} after #{duration_ms}ms - #{inspect(reason)}")
  end

  def attach do
    :telemetry.attach_many(
      "oban-logger",
      [
        [:oban, :job, :start],
        [:oban, :job, :stop],
        [:oban, :job, :exception]
      ],
      &__MODULE__.handle_event/4,
      nil
    )
  end
end
