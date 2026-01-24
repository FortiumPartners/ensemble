# Rails Framework Patterns - Extracted from rails-backend-expert.yaml

**Source**: `agents/yaml/rails-backend-expert.yaml` (v1.0.1, 2025-10-15)
**Target**: Skills-based framework architecture for `backend-developer` agent
**Extraction Date**: October 2025

---

## Agent Overview

**Agent Name**: rails-backend-expert
**Category**: framework-specialist
**Mission**: Rails backend development specialist responsible for implementing server-side functionality using Ruby on Rails MVC framework, building robust, maintainable, and performant applications following Rails conventions and best practices.

**Tools Required**: Read, Write, Edit, Bash

---

## Core Expertise Areas

### 1. MVC Implementation (Priority: HIGH)

**Scope**: Build controllers, models, and views following Rails conventions

**Key Patterns**:
- **Controllers**: RESTful actions (index, show, create, update, destroy) with strong parameters
- **Models**: Active Record with validations, associations, scopes, and callbacks
- **Views**: ERB templates with partials, helpers, and form builders
- **Routing**: Resourceful routes with nested resources and custom actions

**Rails Conventions**:
- Controller naming: `PluralNounsController` (e.g., `PostsController`)
- Model naming: `SingularNoun` (e.g., `Post`)
- File structure: `app/controllers/`, `app/models/`, `app/views/`
- RESTful routes: `resources :posts` generates 7 standard routes

**Example Patterns**:
```ruby
# Controller with strong parameters
class PostsController < ApplicationController
  before_action :set_post, only: %i[show edit update destroy]

  def index
    @posts = Post.published.order(created_at: :desc)
  end

  def create
    @post = Post.new(post_params)
    if @post.save
      redirect_to @post, notice: 'Post created.'
    else
      render :new, status: :unprocessable_entity
    end
  end

  private

  def post_params
    params.require(:post).permit(:title, :body, :published)
  end
end

# Model with validations and associations
class Post < ApplicationRecord
  belongs_to :author, class_name: 'User'
  has_many :comments, dependent: :destroy

  validates :title, presence: true, length: { minimum: 5 }
  validates :body, presence: true

  scope :published, -> { where(published: true) }
end
```

---

### 2. Service Layer Development (Priority: HIGH)

**Scope**: Extract complex business logic into service objects

**Key Patterns**:
- **Service Objects**: Single-responsibility classes for complex operations
- **Form Objects**: Encapsulate complex form logic with multiple models
- **Interactors**: Chain multiple service objects for complex workflows
- **Naming Convention**: `VerbNoun` (e.g., `CreatePost`, `ProcessPayment`)

**Service Object Structure**:
```ruby
# app/services/create_post_service.rb
class CreatePostService
  def initialize(user, params)
    @user = user
    @params = params
  end

  def call
    post = @user.posts.build(@params)
    if post.save
      NotificationMailer.new_post(post).deliver_later
      Result.success(post)
    else
      Result.failure(post.errors)
    end
  end
end

# Usage in controller
def create
  result = CreatePostService.new(current_user, post_params).call
  if result.success?
    redirect_to result.value, notice: 'Post created.'
  else
    @post = Post.new(post_params)
    @post.errors.merge!(result.errors)
    render :new, status: :unprocessable_entity
  end
end
```

---

### 3. Background Job Management (Priority: HIGH)

**Scope**: Implement and maintain Sidekiq/Active Job workers

**Key Patterns**:
- **Active Job**: Framework-agnostic job interface
- **Sidekiq**: High-performance background job processor
- **Job Naming**: `VerbNounJob` (e.g., `SendEmailJob`, `ProcessImportJob`)
- **Retry Strategies**: Exponential backoff with dead letter queue
- **Queue Priority**: Separate queues for different job types (critical, default, low)

**Background Job Patterns**:
```ruby
# app/jobs/send_welcome_email_job.rb
class SendWelcomeEmailJob < ApplicationJob
  queue_as :emails
  retry_on ActiveRecord::Deadlocked, wait: 5.seconds, attempts: 3

  def perform(user_id)
    user = User.find(user_id)
    UserMailer.welcome_email(user).deliver_now
  end
end

# Enqueue job
SendWelcomeEmailJob.perform_later(user.id)

# Sidekiq configuration (config/sidekiq.yml)
:concurrency: 5
:queues:
  - critical
  - default
  - low
```

---

### 4. Database Management (Priority: MEDIUM)

**Scope**: Design schemas, write idempotent migrations, optimize queries

**Key Patterns**:
- **Migrations**: Versioned schema changes with rollback support
- **Idempotency**: Safe to run multiple times without side effects
- **Indexing**: Add indexes for foreign keys and frequently queried columns
- **Query Optimization**: N+1 prevention with `includes`, `joins`, `preload`

**Migration Patterns**:
```ruby
# db/migrate/20251022000000_create_posts.rb
class CreatePosts < ActiveRecord::Migration[7.0]
  def change
    create_table :posts do |t|
      t.string :title, null: false
      t.text :body, null: false
      t.boolean :published, default: false, null: false
      t.references :author, null: false, foreign_key: { to_table: :users }

      t.timestamps
    end

    add_index :posts, :published
    add_index :posts, [:author_id, :created_at]
  end
end

# N+1 prevention
# Bad: N+1 query
posts = Post.all
posts.each { |post| puts post.author.name }  # Triggers N queries

# Good: Eager loading
posts = Post.includes(:author).all
posts.each { |post| puts post.author.name }  # Single query
```

---

### 5. Configuration Management (Priority: MEDIUM)

**Scope**: Manage ENV variables, credentials, and application settings

**Key Patterns**:
- **ENV Variables**: Use `.env` files with `dotenv-rails` gem
- **Encrypted Credentials**: Rails encrypted credentials for sensitive data
- **Configuration Classes**: Custom configuration objects for complex settings
- **Environment-Specific Config**: Separate config for development, test, production

**Configuration Patterns**:
```ruby
# config/initializers/stripe.rb
Stripe.api_key = Rails.application.credentials.stripe[:secret_key]

# Access in code
Rails.application.credentials.stripe[:publishable_key]

# .env.development (not committed)
DATABASE_URL=postgres://localhost/myapp_dev
REDIS_URL=redis://localhost:6379/0

# config/application.rb
config.x.payment_gateway.url = ENV.fetch('PAYMENT_GATEWAY_URL')
config.x.payment_gateway.timeout = ENV.fetch('PAYMENT_GATEWAY_TIMEOUT', 30).to_i
```

---

### 6. API Development (Priority: MEDIUM)

**Scope**: Build RESTful and GraphQL APIs with proper versioning

**Key Patterns**:
- **API Versioning**: Namespace controllers by version (`Api::V1::PostsController`)
- **Serialization**: Use `jbuilder` or `active_model_serializers` for JSON responses
- **Authentication**: Token-based auth with JWT or API keys
- **Rate Limiting**: Use `rack-attack` for throttling
- **CORS**: Configure cross-origin resource sharing for browser clients

**API Patterns**:
```ruby
# app/controllers/api/v1/posts_controller.rb
module Api
  module V1
    class PostsController < ApiController
      before_action :authenticate_api_user!

      def index
        @posts = Post.published.page(params[:page])
        render json: @posts, each_serializer: PostSerializer
      end

      def create
        @post = current_user.posts.build(post_params)
        if @post.save
          render json: @post, serializer: PostSerializer, status: :created
        else
          render json: { errors: @post.errors }, status: :unprocessable_entity
        end
      end
    end
  end
end

# app/serializers/post_serializer.rb
class PostSerializer < ActiveModel::Serializer
  attributes :id, :title, :body, :published_at
  belongs_to :author
end

# config/routes.rb
namespace :api do
  namespace :v1 do
    resources :posts, only: %i[index show create update destroy]
  end
end
```

---

### 7. Performance Optimization (Priority: LOW)

**Scope**: Identify and resolve N+1 queries, implement caching strategies

**Key Patterns**:
- **N+1 Detection**: Use `bullet` gem in development
- **Fragment Caching**: Cache view fragments with `cache` helper
- **Russian Doll Caching**: Nested cache keys with cache invalidation
- **Counter Cache**: Maintain counts with `counter_cache` option
- **Database Indexing**: Add indexes for frequently queried columns

**Performance Patterns**:
```ruby
# Counter cache to avoid COUNT queries
class Post < ApplicationRecord
  belongs_to :author, counter_cache: true
end

class User < ApplicationRecord
  has_many :posts
end
# Migration: add_column :users, :posts_count, :integer, default: 0

# Fragment caching in views
<% cache post do %>
  <%= render post %>
<% end %>

# Low-level caching
Rails.cache.fetch("user_#{user.id}_posts", expires_in: 1.hour) do
  user.posts.to_a
end
```

---

### 8. Security Implementation (Priority: LOW)

**Scope**: Enforce strong parameters, prevent SQL injection, manage authentication/authorization

**Key Patterns**:
- **Strong Parameters**: Whitelist permitted attributes
- **SQL Injection Prevention**: Use parameterized queries (Active Record handles this)
- **Authentication**: Use `devise` or `bcrypt` for password management
- **Authorization**: Use `pundit` or `cancancan` for role-based access control
- **CSRF Protection**: Enabled by default in Rails
- **Mass Assignment Protection**: Strong parameters prevent mass assignment vulnerabilities

**Security Patterns**:
```ruby
# Strong parameters (prevents mass assignment)
def post_params
  params.require(:post).permit(:title, :body, :published)
end

# Authorization with Pundit
class PostPolicy < ApplicationPolicy
  def update?
    user.admin? || record.author == user
  end
end

# Controller
def update
  authorize @post  # Raises Pundit::NotAuthorizedError if not allowed
  if @post.update(post_params)
    redirect_to @post
  else
    render :edit
  end
end

# Safe queries (Active Record prevents SQL injection)
Post.where("title LIKE ?", "%#{params[:query]}%")  # Safe
Post.where("title LIKE '%#{params[:query]}%'")     # UNSAFE - never do this
```

---

## Quality Standards

### Testing Requirements

- **RSpec**: Primary testing framework for Rails applications
- **Model Tests**: Validate associations, validations, scopes (≥80% coverage)
- **Controller Tests**: Request specs for API endpoints (≥70% coverage)
- **Integration Tests**: Feature specs with Capybara for user workflows
- **Test Data**: Use `factory_bot` for test data generation

**Example Test Patterns**:
```ruby
# spec/models/post_spec.rb
RSpec.describe Post, type: :model do
  describe 'associations' do
    it { should belong_to(:author).class_name('User') }
    it { should have_many(:comments).dependent(:destroy) }
  end

  describe 'validations' do
    it { should validate_presence_of(:title) }
    it { should validate_length_of(:title).is_at_least(5) }
  end

  describe 'scopes' do
    it 'returns only published posts' do
      published = create(:post, published: true)
      draft = create(:post, published: false)
      expect(Post.published).to include(published)
      expect(Post.published).not_to include(draft)
    end
  end
end

# spec/requests/api/v1/posts_spec.rb
RSpec.describe 'Api::V1::Posts', type: :request do
  describe 'GET /api/v1/posts' do
    it 'returns all published posts' do
      create_list(:post, 3, published: true)
      get '/api/v1/posts'
      expect(response).to have_http_status(:success)
      expect(JSON.parse(response.body).size).to eq(3)
    end
  end
end
```

---

## Delegation Protocols

### Receives Tasks From

1. **tech-lead-orchestrator**: Rails-specific implementation tasks from TRD breakdown
2. **ensemble-orchestrator**: Rails backend tasks requiring framework-specific expertise
3. **backend-developer**: Tasks specifically requiring Rails framework patterns
4. **frontend-developer**: API endpoint requirements for frontend integration

### Delegates Tasks To

1. **test-runner**: Test execution after implementing Rails code
2. **code-reviewer**: Comprehensive review before PR creation
3. **deployment-orchestrator**: Deployment tasks after code review

---

## Integration Points

### Tool Requirements

- **Read**: Read existing Rails code, migrations, configuration
- **Write**: Create new Rails files (controllers, models, services, jobs)
- **Edit**: Modify existing Rails files
- **Bash**: Run Rails commands (`rails generate`, `rails db:migrate`, `bundle install`)

### Rails-Specific Commands

```bash
# Generate resources
rails generate model Post title:string body:text published:boolean author:references
rails generate controller Api::V1::Posts index show create update destroy
rails generate migration AddIndexToPostsPublished published:boolean

# Database operations
rails db:create
rails db:migrate
rails db:rollback
rails db:seed

# Testing
bundle exec rspec
bundle exec rspec spec/models/post_spec.rb

# Server and console
rails server
rails console

# Asset and dependency management
bundle install
rails assets:precompile
```

---

## Rails Conventions Summary

### Naming Conventions

- **Controllers**: `PluralNounsController` (e.g., `PostsController`, `Api::V1::UsersController`)
- **Models**: `SingularNoun` (e.g., `Post`, `User`, `Comment`)
- **Services**: `VerbNoun` (e.g., `CreatePost`, `ProcessPayment`)
- **Jobs**: `VerbNounJob` (e.g., `SendEmailJob`, `ImportDataJob`)
- **Mailers**: `NounMailer` (e.g., `UserMailer`, `NotificationMailer`)

### File Structure

```
app/
├── controllers/
│   ├── application_controller.rb
│   ├── posts_controller.rb
│   └── api/
│       └── v1/
│           └── posts_controller.rb
├── models/
│   ├── application_record.rb
│   └── post.rb
├── services/
│   └── create_post_service.rb
├── jobs/
│   └── send_email_job.rb
├── mailers/
│   └── user_mailer.rb
└── views/
    └── posts/
        ├── index.html.erb
        └── show.html.erb

db/
└── migrate/
    └── 20251022000000_create_posts.rb

spec/
├── models/
│   └── post_spec.rb
├── requests/
│   └── posts_spec.rb
└── factories/
    └── posts.rb
```

---

## Skill Conversion Strategy

### Progressive Disclosure Pattern

1. **SKILL.md** (~15KB): Quick reference guide
   - Common patterns for each expertise area
   - Code snippets for frequent operations
   - Rails conventions and best practices
   - Quick lookup for controllers, models, services, jobs

2. **REFERENCE.md** (~40KB): Comprehensive guide
   - Detailed Rails architecture overview
   - Advanced patterns (STI, polymorphic associations, concerns)
   - Performance optimization techniques
   - Security best practices
   - Deployment and production considerations
   - Complete testing strategies

### Template System

7 code generation templates planned:

1. `controller.template.rb` - RESTful controller with strong parameters
2. `model.template.rb` - Active Record model with validations
3. `service.template.rb` - Service object pattern
4. `migration.template.rb` - Database migration
5. `job.template.rb` - Background job worker
6. `serializer.template.rb` - API serializer
7. `spec.template.rb` - RSpec test template

**Placeholder System**:
- `{{ClassName}}` → Class name (e.g., `Post`)
- `{{class_name}}` → Snake case (e.g., `post`)
- `{{table_name}}` → Table name (e.g., `posts`)
- `{{route_path}}` → Route path (e.g., `posts`)
- `{{field_name}}` → Field name (e.g., `title`)

### Example System

2 comprehensive examples planned:

1. **Blog API Example** (~550 lines): Complete RESTful API
   - Controllers with versioning
   - Models with associations
   - Serializers for JSON responses
   - Authentication with JWT
   - RSpec tests

2. **Background Jobs Example** (~550 lines): Job processing patterns
   - Sidekiq workers with retry strategies
   - Email delivery jobs
   - Data import/export jobs
   - Scheduled jobs (cron)
   - Job monitoring and error handling

---

## Feature Parity Target

**Goal**: ≥95% feature coverage compared to `rails-backend-expert.yaml` agent

**Coverage Areas**:
1. ✅ MVC Implementation (8 core responsibilities mapped)
2. ✅ Service Layer Development
3. ✅ Background Job Management
4. ✅ Database Management
5. ✅ Configuration Management
6. ✅ API Development
7. ✅ Performance Optimization
8. ✅ Security Implementation
9. ✅ Testing Standards (RSpec patterns)
10. ✅ Delegation Protocols (4 handoff-from, 3 handoff-to)
11. ✅ Tool Requirements (Read, Write, Edit, Bash)
12. ✅ Rails Conventions and Best Practices

**Total**: 12/12 areas extracted = **100% pattern coverage**

---

**Status**: ✅ **COMPLETE** - All patterns extracted from rails-backend-expert.yaml

**Next Steps**: Create SKILL.md and REFERENCE.md with progressive disclosure pattern
