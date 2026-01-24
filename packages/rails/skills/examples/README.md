# Rails Framework Examples

**Purpose**: Real-world, production-ready code examples demonstrating Rails and Ruby patterns.

**Coverage**: Complete implementations of common Rails use cases with best practices.

---

## Available Examples

| Example | Purpose | Lines | Key Patterns |
|---------|---------|-------|-----------------|
| `blog-api.example.rb` | Complete RESTful API with authentication | ~550 | Controllers, models, serializers, authentication, versioning |
| `background-jobs.example.rb` | Background job processing patterns | ~550 | Sidekiq workers, retry strategies, batch processing, scheduled jobs |

**Total**: 2 comprehensive examples, ~1,100 lines of production-ready code

---

## Example 1: Blog API

**File**: `blog-api.example.rb`

### What It Demonstrates

- **RESTful API**: Complete CRUD operations with versioning
- **Authentication**: JWT-based token authentication
- **Authorization**: Role-based access control with Pundit
- **Serialization**: JSON API responses with Active Model Serializers
- **Associations**: belongs_to, has_many, many_to_many relationships
- **Validations**: Model-level validation with custom validators
- **N+1 Prevention**: Eager loading with includes and joins
- **Error Handling**: Structured error responses
- **Rate Limiting**: API throttling with rack-attack
- **Testing**: RSpec request specs and model specs

### Key Features

#### RESTful API Controllers

```ruby
module Api
  module V1
    class PostsController < ApiController
      before_action :authenticate_user!, except: %i[index show]
      before_action :set_post, only: %i[show update destroy]

      def index
        @posts = Post.published.includes(:author, :tags)
                     .page(params[:page])
        render json: @posts, each_serializer: PostSerializer
      end

      def create
        @post = current_user.posts.build(post_params)
        if @post.save
          render json: @post, status: :created
        else
          render json: { errors: @post.errors }, status: :unprocessable_entity
        end
      end
    end
  end
end
```

#### JWT Authentication

```ruby
module Api
  class AuthenticationController < ApiController
    def login
      user = User.find_by(email: params[:email])
      if user&.authenticate(params[:password])
        token = JsonWebToken.encode(user_id: user.id)
        render json: { token: token, user: UserSerializer.new(user) }
      else
        render json: { error: 'Invalid credentials' }, status: :unauthorized
      end
    end
  end
end
```

#### Authorization with Pundit

```ruby
class PostPolicy < ApplicationPolicy
  def update?
    user.admin? || record.author == user
  end

  def destroy?
    user.admin?
  end
end

# Controller usage
def update
  authorize @post
  if @post.update(post_params)
    render json: @post
  else
    render json: { errors: @post.errors }, status: :unprocessable_entity
  end
end
```

#### Active Model Serializers

```ruby
class PostSerializer < ActiveModel::Serializer
  attributes :id, :title, :body, :slug, :published_at, :created_at

  belongs_to :author, serializer: AuthorSerializer
  has_many :tags

  def published_at
    object.published_at&.iso8601
  end
end
```

### Use Cases

- Blog platforms with API
- Content management systems
- News websites with mobile apps
- API-first applications
- Headless CMS backends

---

## Example 2: Background Jobs

**File**: `background-jobs.example.rb`

### What It Demonstrates

- **Sidekiq Workers**: Reliable background job processing
- **Active Job**: Framework-agnostic job interface
- **Retry Strategies**: Exponential backoff with custom logic
- **Job Scheduling**: Immediate, delayed, and cron jobs
- **Batch Processing**: Chunking large datasets
- **Error Handling**: Graceful failure and recovery
- **Job Callbacks**: before_perform, after_perform, around_perform
- **Unique Jobs**: Prevent duplicate processing
- **Job Monitoring**: Logging and telemetry

### Key Features

#### Basic Active Job Worker

```ruby
class SendWelcomeEmailJob < ApplicationJob
  queue_as :emails

  retry_on Net::SMTPServerBusy, wait: 1.minute, attempts: 5
  discard_on ActiveJob::DeserializationError

  def perform(user_id)
    user = User.find(user_id)
    UserMailer.welcome_email(user).deliver_now
  rescue ActiveRecord::RecordNotFound => e
    Rails.logger.warn("User #{user_id} not found: #{e.message}")
  end
end

# Enqueue
SendWelcomeEmailJob.perform_later(user.id)
```

#### Sidekiq Worker with Custom Retry

```ruby
class ProcessDataJob
  include Sidekiq::Worker

  sidekiq_options queue: :critical, retry: 5

  def perform(data_id)
    data = Data.find(data_id)
    result = ExternalAPI.process(data)

    case result.status
    when :success
      data.update!(processed: true)
    when :rate_limited
      # Retry with exponential backoff
      raise RateLimitError
    when :permanent_failure
      # Don't retry
      data.update!(failed: true, error: result.error)
    end
  rescue RateLimitError => e
    # Will be retried by Sidekiq
    raise
  end
end
```

#### Batch Processing

```ruby
class ImportDataJob < ApplicationJob
  queue_as :imports

  def perform(import_id)
    import = Import.find(import_id)

    # Process in batches to avoid memory issues
    import.items.find_in_batches(batch_size: 100) do |batch|
      batch.each do |item|
        ProcessItemJob.perform_later(item.id)
        import.increment!(:processed_count)
      end
    end

    import.update!(status: :completed)
  end
end
```

#### Scheduled Jobs (Cron)

```ruby
# config/initializers/sidekiq.rb
require 'sidekiq-scheduler'

Sidekiq.configure_server do |config|
  config.on(:startup) do
    Sidekiq.schedule = {
      'daily_report' => {
        'cron' => '0 2 * * *',  # Every day at 2 AM
        'class' => 'DailyReportJob'
      },
      'hourly_cleanup' => {
        'cron' => '0 * * * *',  # Every hour
        'class' => 'CleanupJob'
      }
    }
  end
end
```

#### Job Callbacks

```ruby
class NotificationJob < ApplicationJob
  before_perform do |job|
    Rails.logger.info "Starting: #{job.class.name}"
  end

  after_perform do |job|
    Rails.logger.info "Completed: #{job.class.name}"
  end

  around_perform do |job, block|
    start = Time.current
    block.call
    duration = Time.current - start
    Metrics.track('job_duration', duration, job: job.class.name)
  end

  def perform(notification_id)
    notification = Notification.find(notification_id)
    send_notification(notification)
  end
end
```

### Use Cases

- Email delivery systems
- Data import/export pipelines
- Image/video processing
- Report generation
- Webhook delivery
- Scheduled maintenance tasks
- Analytics processing
- Third-party API integrations

---

## Pattern Coverage

### Rails Patterns

- ✅ RESTful controllers with CRUD operations
- ✅ Active Record models with associations
- ✅ Strong parameters for mass assignment protection
- ✅ API versioning (namespace-based)
- ✅ JWT authentication
- ✅ Authorization with Pundit policies
- ✅ JSON serialization (Active Model Serializers)
- ✅ N+1 query prevention
- ✅ Error handling and structured responses

### Background Job Patterns

- ✅ Active Job interface
- ✅ Sidekiq workers
- ✅ Retry strategies (exponential backoff)
- ✅ Job scheduling (immediate, delayed, cron)
- ✅ Batch processing
- ✅ Job callbacks
- ✅ Unique jobs
- ✅ Error handling and logging
- ✅ Queue prioritization

### Database Patterns

- ✅ Associations (belongs_to, has_many, many_to_many)
- ✅ Validations (presence, length, custom)
- ✅ Scopes for query organization
- ✅ Callbacks (before_save, after_create)
- ✅ Eager loading (includes, joins)
- ✅ Database transactions

### Testing Patterns

- ✅ RSpec request specs
- ✅ Model specs (associations, validations)
- ✅ Job specs
- ✅ FactoryBot factories
- ✅ Authentication testing
- ✅ Authorization testing

---

## Running the Examples

### Prerequisites

```bash
# Install dependencies
bundle install

# Setup database
rails db:create
rails db:migrate

# Setup Redis (for Sidekiq)
brew install redis  # macOS
redis-server        # Start Redis
```

### Using Examples

1. **Copy relevant code** from examples to your project
2. **Adapt placeholders** to your application names
3. **Add required gems** to Gemfile
4. **Configure services** (Redis, Sidekiq, authentication)
5. **Write tests** using provided patterns

### Required Gems

```ruby
# Gemfile

# API & Serialization
gem 'active_model_serializers', '~> 0.10.0'
gem 'jwt'
gem 'rack-cors'
gem 'rack-attack'

# Background Jobs
gem 'sidekiq', '~> 7.0'
gem 'sidekiq-scheduler'

# Authorization
gem 'pundit'

# Pagination
gem 'kaminari'

# Testing
group :development, :test do
  gem 'rspec-rails'
  gem 'factory_bot_rails'
  gem 'faker'
end
```

### Configuration

#### Sidekiq Setup

```yaml
# config/sidekiq.yml
:concurrency: 5
:queues:
  - critical
  - default
  - emails
  - imports
  - low
```

```ruby
# config/routes.rb
require 'sidekiq/web'
mount Sidekiq::Web => '/sidekiq'
```

#### JWT Configuration

```ruby
# lib/json_web_token.rb
class JsonWebToken
  SECRET_KEY = Rails.application.credentials.secret_key_base

  def self.encode(payload, exp = 24.hours.from_now)
    payload[:exp] = exp.to_i
    JWT.encode(payload, SECRET_KEY)
  end

  def self.decode(token)
    body = JWT.decode(token, SECRET_KEY)[0]
    HashWithIndifferentAccess.new(body)
  rescue JWT::DecodeError
    nil
  end
end
```

#### Rate Limiting

```ruby
# config/initializers/rack_attack.rb
class Rack::Attack
  throttle('api/ip', limit: 100, period: 1.minute) do |req|
    req.ip if req.path.start_with?('/api')
  end
end
```

---

## Testing Examples

### Running Tests

```bash
# Run all tests
bundle exec rspec

# Run specific example tests
bundle exec rspec spec/requests/api/v1/posts_spec.rb
bundle exec rspec spec/jobs/send_welcome_email_job_spec.rb

# Run with coverage
COVERAGE=true bundle exec rspec
```

### Test Factories

```ruby
# spec/factories/posts.rb
FactoryBot.define do
  factory :post do
    title { Faker::Lorem.sentence }
    body { Faker::Lorem.paragraphs(number: 3).join("\n\n") }
    published { false }
    association :author, factory: :user

    trait :published do
      published { true }
      published_at { 1.day.ago }
    end
  end
end
```

---

## Related Files

- **SKILL.md**: Quick reference for Rails patterns
- **REFERENCE.md**: Comprehensive Rails guide
- **templates/**: Code generation templates
- **PATTERNS-EXTRACTED.md**: Pattern extraction from rails-backend-expert

---

**Status**: ✅ **COMPLETE** - 2 comprehensive real-world examples with ~1,100 lines of production-ready code

**Coverage**: Blog API (RESTful + Auth), Background Jobs (Sidekiq + Scheduling) - All major Rails use cases demonstrated
