# Rails Framework - Comprehensive Reference

**Framework**: Ruby on Rails 7.0+
**For Agent**: backend-developer
**Purpose**: Deep-dive reference for complex Rails development scenarios

---

## Table of Contents

1. [Rails Architecture Overview](#1-rails-architecture-overview)
2. [Advanced MVC Patterns](#2-advanced-mvc-patterns)
3. [Service Objects & Design Patterns](#3-service-objects--design-patterns)
4. [Background Jobs & Async Processing](#4-background-jobs--async-processing)
5. [Database & Active Record Advanced](#5-database--active-record-advanced)
6. [API Development & Versioning](#6-api-development--versioning)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [Performance Optimization](#8-performance-optimization)
9. [Testing Strategies](#9-testing-strategies)
10. [Configuration & Deployment](#10-configuration--deployment)
11. [Security Best Practices](#11-security-best-practices)
12. [Production Patterns](#12-production-patterns)

---

## 1. Rails Architecture Overview

### MVC Framework Structure

Rails follows the Model-View-Controller pattern with additional layers:

```
app/
├── controllers/           # Handle HTTP requests, orchestrate business logic
│   ├── concerns/         # Shared controller modules
│   └── api/              # API-specific controllers
├── models/               # Business logic, database interactions
│   └── concerns/         # Shared model modules (STI, soft delete, etc.)
├── views/                # Templates for HTML responses
│   ├── layouts/          # Application-wide layouts
│   └── shared/           # Reusable partials
├── services/             # Complex business logic extraction
├── jobs/                 # Background job workers
├── mailers/              # Email sending logic
├── channels/             # WebSocket channels (Action Cable)
├── helpers/              # View helper methods
└── policies/             # Authorization logic (Pundit)

config/
├── routes.rb             # URL routing
├── database.yml          # Database configuration
├── application.rb        # Application-wide settings
└── environments/         # Environment-specific configs

db/
├── migrate/              # Database migrations
├── schema.rb             # Current database schema
└── seeds.rb              # Seed data

spec/  or  test/          # Test files
```

### Request Lifecycle

1. **Route Matching**: Request URL → routes.rb → Controller#action
2. **Before Actions**: Authentication, authorization, data loading
3. **Controller Action**: Orchestrates business logic, calls services/models
4. **Model Layer**: Database queries, validations, business rules
5. **Response**: Render view or JSON, set HTTP status
6. **After Actions**: Logging, cleanup, analytics

---

## 2. Advanced MVC Patterns

### Controllers - Advanced Techniques

#### Concerns for Shared Behavior

```ruby
# app/controllers/concerns/authenticable.rb
module Authenticable
  extend ActiveSupport::Concern

  included do
    before_action :authenticate_user!
    helper_method :current_user
  end

  private

  def authenticate_user!
    redirect_to login_path unless current_user
  end

  def current_user
    @current_user ||= User.find_by(id: session[:user_id])
  end
end

# Usage in controller
class PostsController < ApplicationController
  include Authenticable

  def index
    @posts = current_user.posts
  end
end
```

#### Respond To Multiple Formats

```ruby
class PostsController < ApplicationController
  def show
    @post = Post.find(params[:id])

    respond_to do |format|
      format.html  # Renders show.html.erb
      format.json { render json: @post }
      format.xml  { render xml: @post }
      format.pdf  { render pdf: generate_pdf(@post) }
    end
  end
end
```

#### Controller Filters & Callbacks

```ruby
class PostsController < ApplicationController
  before_action :authenticate_user!
  before_action :set_post, only: %i[show edit update destroy]
  before_action :authorize_post!, only: %i[edit update destroy]
  after_action :track_view, only: :show
  around_action :log_performance, only: :index

  private

  def set_post
    @post = Post.find(params[:id])
  end

  def authorize_post!
    redirect_to root_path unless @post.author == current_user
  end

  def track_view
    PostViewTracker.track(@post, request)
  end

  def log_performance
    start = Time.current
    yield
    Rails.logger.info "Action took #{Time.current - start}s"
  end
end
```

### Models - Advanced Active Record

#### Single Table Inheritance (STI)

```ruby
# Migration
class CreateVehicles < ActiveRecord::Migration[7.0]
  def change
    create_table :vehicles do |t|
      t.string :type, null: false  # STI discriminator column
      t.string :make
      t.string :model
      t.integer :doors  # For cars
      t.integer :cargo_capacity  # For trucks
      t.timestamps
    end
    add_index :vehicles, :type
  end
end

# Models
class Vehicle < ApplicationRecord
  validates :make, :model, presence: true
end

class Car < Vehicle
  validates :doors, presence: true, numericality: { greater_than: 0 }
end

class Truck < Vehicle
  validates :cargo_capacity, presence: true
end

# Usage
car = Car.create(make: 'Toyota', model: 'Camry', doors: 4)
truck = Truck.create(make: 'Ford', model: 'F-150', cargo_capacity: 1000)

Vehicle.all  # Returns both cars and trucks
Car.all      # Returns only cars
```

#### Polymorphic Associations

```ruby
# Migration
class CreateComments < ActiveRecord::Migration[7.0]
  def change
    create_table :comments do |t|
      t.text :body, null: false
      t.references :commentable, polymorphic: true, null: false
      t.references :user, foreign_key: true
      t.timestamps
    end
  end
end

# Models
class Comment < ApplicationRecord
  belongs_to :commentable, polymorphic: true
  belongs_to :user
end

class Post < ApplicationRecord
  has_many :comments, as: :commentable, dependent: :destroy
end

class Photo < ApplicationRecord
  has_many :comments, as: :commentable, dependent: :destroy
end

# Usage
post = Post.first
post.comments.create(body: 'Great post!', user: current_user)

photo = Photo.first
photo.comments.create(body: 'Nice photo!', user: current_user)

# Query all comments regardless of type
Comment.all

# Query comments for specific type
Comment.where(commentable_type: 'Post')
```

#### Concerns for Shared Model Behavior

```ruby
# app/models/concerns/soft_deletable.rb
module SoftDeletable
  extend ActiveSupport::Concern

  included do
    scope :active, -> { where(deleted_at: nil) }
    scope :deleted, -> { where.not(deleted_at: nil) }
  end

  def soft_delete
    update(deleted_at: Time.current)
  end

  def restore
    update(deleted_at: nil)
  end

  def deleted?
    deleted_at.present?
  end
end

# Usage in model
class Post < ApplicationRecord
  include SoftDeletable
end

# Usage
post.soft_delete
Post.active  # Returns non-deleted posts
post.restore
```

#### Custom Validations

```ruby
class Post < ApplicationRecord
  validate :title_not_reserved
  validate :published_date_in_future, if: :published?

  private

  def title_not_reserved
    reserved_titles = ['Admin', 'System', 'Root']
    if reserved_titles.include?(title)
      errors.add(:title, 'is reserved and cannot be used')
    end
  end

  def published_date_in_future
    if published_at.present? && published_at < Time.current
      errors.add(:published_at, 'must be in the future')
    end
  end
end
```

---

## 3. Service Objects & Design Patterns

### Advanced Service Patterns

#### Transaction-Safe Service

```ruby
class CreateOrderService
  def initialize(user, cart_items, payment_params)
    @user = user
    @cart_items = cart_items
    @payment_params = payment_params
  end

  def call
    ActiveRecord::Base.transaction do
      order = create_order
      process_payment(order)
      send_confirmation(order)
      clear_cart
      Result.success(order)
    end
  rescue PaymentError => e
    Result.failure(errors: ["Payment failed: #{e.message}"])
  rescue StandardError => e
    Rails.logger.error("Order creation failed: #{e.message}")
    Result.failure(errors: ["Order creation failed"])
  end

  private

  def create_order
    order = @user.orders.create!(total: calculate_total)
    @cart_items.each do |item|
      order.order_items.create!(
        product: item.product,
        quantity: item.quantity,
        price: item.product.price
      )
    end
    order
  end

  def process_payment(order)
    payment = PaymentGateway.charge(@payment_params, order.total)
    order.update!(payment_id: payment.id, status: :paid)
  end

  def send_confirmation(order)
    OrderMailer.confirmation(order).deliver_later
  end

  def clear_cart
    @user.cart.clear
  end

  def calculate_total
    @cart_items.sum { |item| item.quantity * item.product.price }
  end
end
```

#### Form Objects

```ruby
# app/forms/registration_form.rb
class RegistrationForm
  include ActiveModel::Model

  attr_accessor :email, :password, :password_confirmation
  attr_accessor :first_name, :last_name, :company_name

  validates :email, presence: true, format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :password, presence: true, length: { minimum: 8 }
  validates :password_confirmation, presence: true
  validates :first_name, :last_name, presence: true
  validate :passwords_match

  def save
    return false unless valid?

    ActiveRecord::Base.transaction do
      user = create_user
      create_profile(user)
      create_company(user) if company_name.present?
      send_welcome_email(user)
      user
    end
  end

  private

  def passwords_match
    if password != password_confirmation
      errors.add(:password_confirmation, "doesn't match password")
    end
  end

  def create_user
    User.create!(email: email, password: password)
  end

  def create_profile(user)
    user.create_profile!(first_name: first_name, last_name: last_name)
  end

  def create_company(user)
    user.create_company!(name: company_name)
  end

  def send_welcome_email(user)
    UserMailer.welcome_email(user).deliver_later
  end
end

# Controller
def create
  @form = RegistrationForm.new(registration_params)

  if @form.save
    redirect_to root_path, notice: 'Registration successful!'
  else
    render :new
  end
end
```

#### Query Objects

```ruby
# app/queries/post_search_query.rb
class PostSearchQuery
  def initialize(relation = Post.all)
    @relation = relation
  end

  def call(params)
    @relation = filter_by_search(params[:search])
    @relation = filter_by_category(params[:category])
    @relation = filter_by_author(params[:author])
    @relation = filter_by_date_range(params[:from], params[:to])
    @relation = order_posts(params[:order])
    @relation
  end

  private

  def filter_by_search(query)
    return @relation if query.blank?
    @relation.where('title ILIKE ? OR body ILIKE ?', "%#{query}%", "%#{query}%")
  end

  def filter_by_category(category_id)
    return @relation if category_id.blank?
    @relation.where(category_id: category_id)
  end

  def filter_by_author(author_id)
    return @relation if author_id.blank?
    @relation.where(author_id: author_id)
  end

  def filter_by_date_range(from, to)
    @relation = @relation.where('created_at >= ?', from) if from.present?
    @relation = @relation.where('created_at <= ?', to) if to.present?
    @relation
  end

  def order_posts(order)
    case order
    when 'popular' then @relation.order(views_count: :desc)
    when 'oldest' then @relation.order(created_at: :asc)
    else @relation.order(created_at: :desc)
    end
  end
end

# Controller
def index
  @posts = PostSearchQuery.new.call(search_params).page(params[:page])
end
```

---

## 4. Background Jobs & Async Processing

### Sidekiq Advanced Patterns

#### Retry Strategies with Exponential Backoff

```ruby
class ImportDataJob < ApplicationJob
  queue_as :imports

  # Custom retry logic
  retry_on CustomRetryableError, wait: :exponentially_longer, attempts: 5
  retry_on ActiveRecord::Deadlocked, wait: 5.seconds, attempts: 3

  # Don't retry certain errors
  discard_on ActiveJob::DeserializationError
  discard_on CustomFatalError

  def perform(file_path)
    import_data(file_path)
  rescue CustomRetryableError => e
    # Log and re-raise to trigger retry
    Rails.logger.warn("Retryable error: #{e.message}")
    raise
  rescue CustomFatalError => e
    # Log and don't retry
    Rails.logger.error("Fatal error: #{e.message}")
    notify_admin(e)
  end

  private

  def import_data(file_path)
    # Import logic
  end

  def notify_admin(error)
    AdminMailer.error_notification(error).deliver_now
  end
end
```

#### Batch Processing

```ruby
class ProcessLargeDatasetJob < ApplicationJob
  queue_as :batch_processing

  def perform(dataset_id)
    dataset = Dataset.find(dataset_id)

    # Process in batches to avoid memory issues
    dataset.items.find_in_batches(batch_size: 100) do |batch|
      batch.each do |item|
        ProcessItemJob.perform_later(item.id)
      end
    end

    # Or process items in chunks
    dataset.items.in_batches(of: 100).each_with_index do |batch, index|
      ProcessBatchJob.set(wait: index * 30.seconds).perform_later(batch.ids)
    end
  end
end
```

#### Scheduled Jobs with Sidekiq-Cron

```ruby
# config/initializers/sidekiq.rb
require 'sidekiq/cron'

# Load schedule from YAML
schedule_file = "config/schedule.yml"

if File.exist?(schedule_file)
  Sidekiq::Cron::Job.load_from_hash YAML.load_file(schedule_file)
end

# config/schedule.yml
daily_report:
  cron: "0 2 * * *"  # Every day at 2 AM
  class: "DailyReportJob"
  queue: reports

hourly_cleanup:
  cron: "0 * * * *"  # Every hour
  class: "CleanupJob"
  queue: maintenance

weekly_digest:
  cron: "0 9 * * 1"  # Every Monday at 9 AM
  class: "WeeklyDigestJob"
  queue: emails
```

#### Job Callbacks

```ruby
class NotificationJob < ApplicationJob
  queue_as :notifications

  before_perform do |job|
    Rails.logger.info "Starting job: #{job.class.name} with args: #{job.arguments}"
  end

  after_perform do |job|
    Rails.logger.info "Completed job: #{job.class.name}"
  end

  around_perform do |job, block|
    start = Time.current
    block.call
    duration = Time.current - start
    Rails.logger.info "Job #{job.class.name} took #{duration}s"
  end

  def perform(user_id, message)
    user = User.find(user_id)
    send_notification(user, message)
  end
end
```

---

## 5. Database & Active Record Advanced

### Advanced Query Patterns

#### Subqueries and CTEs

```ruby
# Subquery for filtering
popular_posts_subquery = Post.select(:id).where('views_count > ?', 1000)
Comment.where(post_id: popular_posts_subquery)

# Subquery for joining
comment_count_subquery = Comment.select('post_id, COUNT(*) as count')
                                .group(:post_id)

Post.joins("LEFT JOIN (#{comment_count_subquery.to_sql}) AS comment_counts ON posts.id = comment_counts.post_id")
    .select('posts.*, COALESCE(comment_counts.count, 0) AS comments_count')

# Common Table Expressions (PostgreSQL)
sql = <<-SQL
  WITH recent_posts AS (
    SELECT * FROM posts WHERE created_at > ?
  )
  SELECT posts.*, COUNT(comments.id) AS comments_count
  FROM recent_posts AS posts
  LEFT JOIN comments ON comments.post_id = posts.id
  GROUP BY posts.id
SQL

Post.find_by_sql([sql, 7.days.ago])
```

#### Window Functions (PostgreSQL)

```ruby
# Rank posts by views within each category
sql = <<-SQL
  SELECT *,
         RANK() OVER (PARTITION BY category_id ORDER BY views_count DESC) AS rank_in_category
  FROM posts
SQL

Post.find_by_sql(sql)

# Running totals
sql = <<-SQL
  SELECT *,
         SUM(views_count) OVER (ORDER BY created_at) AS cumulative_views
  FROM posts
  ORDER BY created_at
SQL

Post.find_by_sql(sql)
```

#### Bulk Operations

```ruby
# Bulk insert (faster than individual creates)
posts_data = [
  { title: 'Post 1', body: 'Body 1', author_id: 1 },
  { title: 'Post 2', body: 'Body 2', author_id: 1 },
  { title: 'Post 3', body: 'Body 3', author_id: 2 }
]

Post.insert_all(posts_data)  # Skips validations and callbacks
# or
Post.upsert_all(posts_data, unique_by: :title)  # Update if exists

# Bulk update
Post.where(published: false).update_all(status: 'draft')

# Bulk delete
Post.where('created_at < ?', 1.year.ago).delete_all
```

### Database Migrations Advanced

#### Complex Migrations

```ruby
class AddFullTextSearchToPosts < ActiveRecord::Migration[7.0]
  def up
    # Add tsvector column for full-text search (PostgreSQL)
    add_column :posts, :search_vector, :tsvector

    # Add GIN index for fast full-text search
    execute <<-SQL
      CREATE INDEX posts_search_vector_idx
      ON posts
      USING gin(search_vector)
    SQL

    # Trigger to automatically update search_vector
    execute <<-SQL
      CREATE TRIGGER posts_search_vector_update
      BEFORE INSERT OR UPDATE ON posts
      FOR EACH ROW EXECUTE FUNCTION
      tsvector_update_trigger(
        search_vector, 'pg_catalog.english', title, body
      )
    SQL

    # Populate existing records
    execute <<-SQL
      UPDATE posts
      SET search_vector = to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(body, ''))
    SQL
  end

  def down
    execute "DROP TRIGGER IF EXISTS posts_search_vector_update ON posts"
    remove_index :posts, name: :posts_search_vector_idx
    remove_column :posts, :search_vector
  end
end
```

#### Data Migrations

```ruby
class MigrateUserRolesToRolesTable < ActiveRecord::Migration[7.0]
  def up
    # Create new roles table
    create_table :roles do |t|
      t.string :name, null: false
      t.timestamps
    end

    create_table :user_roles do |t|
      t.references :user, foreign_key: true, null: false
      t.references :role, foreign_key: true, null: false
      t.timestamps
    end

    add_index :user_roles, [:user_id, :role_id], unique: true

    # Migrate data
    say_with_time "Migrating user roles to roles table" do
      admin_role = Role.create!(name: 'admin')
      editor_role = Role.create!(name: 'editor')
      viewer_role = Role.create!(name: 'viewer')

      User.where(role: 'admin').find_each do |user|
        user.user_roles.create!(role: admin_role)
      end

      User.where(role: 'editor').find_each do |user|
        user.user_roles.create!(role: editor_role)
      end

      User.where(role: 'viewer').find_each do |user|
        user.user_roles.create!(role: viewer_role)
      end
    end

    # Remove old column
    remove_column :users, :role
  end

  def down
    add_column :users, :role, :string

    say_with_time "Reverting roles to user.role column" do
      User.joins(:user_roles).includes(user_roles: :role).find_each do |user|
        user.update!(role: user.user_roles.first.role.name)
      end
    end

    drop_table :user_roles
    drop_table :roles
  end
end
```

---

## 6. API Development & Versioning

### API Versioning Strategies

#### URL-Based Versioning

```ruby
# config/routes.rb
Rails.application.routes.draw do
  namespace :api do
    namespace :v1 do
      resources :posts
      resources :users
    end

    namespace :v2 do
      resources :posts  # Different implementation
      resources :users
    end
  end
end

# app/controllers/api/v1/posts_controller.rb
module Api
  module V1
    class PostsController < Api::BaseController
      def index
        @posts = Post.published.page(params[:page])
        render json: @posts, each_serializer: PostSerializer
      end
    end
  end
end

# app/controllers/api/v2/posts_controller.rb
module Api
  module V2
    class PostsController < Api::BaseController
      def index
        # New implementation with different response structure
        @posts = Post.published.includes(:author, :tags).page(params[:page])
        render json: @posts, each_serializer: V2::PostSerializer
      end
    end
  end
end
```

#### Header-Based Versioning

```ruby
# config/routes.rb
Rails.application.routes.draw do
  namespace :api do
    resources :posts, constraints: ApiVersionConstraint.new(version: 1, default: true)
    resources :posts, constraints: ApiVersionConstraint.new(version: 2)
  end
end

# lib/api_version_constraint.rb
class ApiVersionConstraint
  def initialize(options)
    @version = options[:version]
    @default = options[:default]
  end

  def matches?(request)
    @default || request.headers['Accept']&.include?("application/vnd.myapp.v#{@version}+json")
  end
end

# Usage: Send header
# Accept: application/vnd.myapp.v2+json
```

### API Authentication

#### JWT Authentication

```ruby
# app/controllers/api/authentication_controller.rb
module Api
  class AuthenticationController < ApiController
    skip_before_action :authenticate_api_user!, only: :login

    def login
      user = User.find_by(email: params[:email])

      if user&.authenticate(params[:password])
        token = JsonWebToken.encode(user_id: user.id)
        render json: { token: token, user: UserSerializer.new(user) }
      else
        render json: { error: 'Invalid credentials' }, status: :unauthorized
      end
    end

    def logout
      # JWT is stateless, so just return success
      # In production, you might want to blacklist the token
      head :no_content
    end
  end
end

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
  rescue JWT::DecodeError, JWT::ExpiredSignature
    nil
  end
end

# app/controllers/api/base_controller.rb
module Api
  class BaseController < ActionController::API
    before_action :authenticate_api_user!

    private

    def authenticate_api_user!
      token = request.headers['Authorization']&.split(' ')&.last
      decoded_token = JsonWebToken.decode(token)

      if decoded_token
        @current_api_user = User.find_by(id: decoded_token[:user_id])
      end

      render json: { error: 'Unauthorized' }, status: :unauthorized unless @current_api_user
    end

    def current_api_user
      @current_api_user
    end
  end
end
```

### Rate Limiting

```ruby
# Gemfile
gem 'rack-attack'

# config/initializers/rack_attack.rb
class Rack::Attack
  # Throttle POST requests to /api/login by IP address
  throttle('api/login', limit: 5, period: 20.seconds) do |req|
    req.ip if req.path == '/api/login' && req.post?
  end

  # Throttle API requests by authenticated user
  throttle('api/user', limit: 300, period: 5.minutes) do |req|
    if req.path.start_with?('/api') && req.env['current_api_user']
      req.env['current_api_user'].id
    end
  end

  # Throttle API requests by IP
  throttle('api/ip', limit: 100, period: 1.minute) do |req|
    req.ip if req.path.start_with?('/api')
  end

  # Custom response for throttled requests
  self.throttled_responder = lambda do |env|
    retry_after = env['rack.attack.match_data'][:period]
    [
      429,
      { 'Content-Type' => 'application/json', 'Retry-After' => retry_after.to_s },
      [{ error: 'Rate limit exceeded', retry_after: retry_after }.to_json]
    ]
  end
end

# config/application.rb
config.middleware.use Rack::Attack
```

---

## 7. Authentication & Authorization

### Devise Advanced Patterns

#### Custom Devise Controllers

```ruby
# config/routes.rb
devise_for :users, controllers: {
  registrations: 'users/registrations',
  sessions: 'users/sessions'
}

# app/controllers/users/registrations_controller.rb
class Users::RegistrationsController < Devise::RegistrationsController
  before_action :configure_sign_up_params, only: [:create]
  before_action :configure_account_update_params, only: [:update]

  def create
    build_resource(sign_up_params)

    if resource.save
      # Custom post-registration logic
      UserMailer.welcome_email(resource).deliver_later
      Analytics.track_signup(resource)

      if resource.active_for_authentication?
        sign_up(resource_name, resource)
        respond_with resource, location: after_sign_up_path_for(resource)
      else
        expire_data_after_sign_in!
        respond_with resource, location: after_inactive_sign_up_path_for(resource)
      end
    else
      clean_up_passwords resource
      set_minimum_password_length
      respond_with resource
    end
  end

  protected

  def configure_sign_up_params
    devise_parameter_sanitizer.permit(:sign_up, keys: [:first_name, :last_name, :phone])
  end

  def configure_account_update_params
    devise_parameter_sanitizer.permit(:account_update, keys: [:first_name, :last_name, :phone])
  end
end
```

### Pundit Advanced Authorization

#### Complex Policies

```ruby
# app/policies/post_policy.rb
class PostPolicy < ApplicationPolicy
  class Scope < Scope
    def resolve
      if user.admin?
        scope.all
      elsif user.editor?
        scope.where(published: true).or(scope.where(author: user))
      else
        scope.where(published: true)
      end
    end
  end

  def index?
    true
  end

  def show?
    record.published? || owner? || user.admin?
  end

  def create?
    user.present?
  end

  def update?
    owner? || user.admin? || user.editor?
  end

  def destroy?
    owner? || user.admin?
  end

  def publish?
    (owner? && user.can_publish?) || user.admin?
  end

  private

  def owner?
    record.author == user
  end
end

# Controller
class PostsController < ApplicationController
  def index
    @posts = policy_scope(Post).page(params[:page])
  end

  def show
    @post = Post.find(params[:id])
    authorize @post
  end

  def publish
    @post = Post.find(params[:id])
    authorize @post

    if @post.update(published: true, published_at: Time.current)
      redirect_to @post, notice: 'Post published'
    else
      redirect_to @post, alert: 'Failed to publish'
    end
  end
end
```

---

## 8. Performance Optimization

### Advanced Caching Strategies

#### Low-Level Caching

```ruby
class Post < ApplicationRecord
  def expensive_computation
    Rails.cache.fetch(cache_key_with_version + '/expensive_computation', expires_in: 1.hour) do
      # Expensive computation here
      calculate_reading_time
    end
  end

  def self.trending_posts
    Rails.cache.fetch('trending_posts', expires_in: 15.minutes) do
      Post.published
          .where('created_at > ?', 7.days.ago)
          .order(views_count: :desc)
          .limit(10)
          .to_a
    end
  end

  private

  def calculate_reading_time
    # Complex calculation
  end
end
```

#### Russian Doll Caching

```ruby
# app/views/posts/index.html.erb
<% cache ['posts', Post.maximum(:updated_at)] do %>
  <% @posts.each do |post| %>
    <% cache post do %>
      <%= render post %>
    <% end %>
  <% end %>
<% end %>

# app/views/posts/_post.html.erb
<div class="post">
  <h2><%= post.title %></h2>
  <% cache [post, 'comments'] do %>
    <%= render post.comments %>
  <% end %>
</div>
```

### Database Optimization

#### Connection Pooling

```yaml
# config/database.yml
production:
  adapter: postgresql
  pool: <%= ENV.fetch("RAILS_MAX_THREADS") { 5 } %>
  timeout: 5000
  reaping_frequency: 10  # seconds
```

#### Query Optimization with Bullet

```ruby
# Gemfile (development group)
gem 'bullet'

# config/environments/development.rb
config.after_initialize do
  Bullet.enable = true
  Bullet.alert = true
  Bullet.bullet_logger = true
  Bullet.console = true
  Bullet.rails_logger = true
  Bullet.add_footer = true
end
```

---

## 9. Testing Strategies

### Advanced RSpec Patterns

#### Shared Examples

```ruby
# spec/support/shared_examples/authenticable.rb
RSpec.shared_examples 'authenticable' do
  describe 'authentication' do
    context 'when not authenticated' do
      it 'redirects to login page' do
        get action_path
        expect(response).to redirect_to(login_path)
      end
    end

    context 'when authenticated' do
      before { sign_in user }

      it 'allows access' do
        get action_path
        expect(response).to have_http_status(:success)
      end
    end
  end
end

# Usage
RSpec.describe PostsController, type: :controller do
  let(:user) { create(:user) }
  let(:action_path) { posts_path }

  it_behaves_like 'authenticable'
end
```

#### Custom Matchers

```ruby
# spec/support/matchers/have_error_on.rb
RSpec::Matchers.define :have_error_on do |attribute|
  match do |model|
    model.valid?
    model.errors.key?(attribute)
  end

  failure_message do |model|
    "expected #{model.class} to have error on #{attribute}, but it didn't"
  end
end

# Usage
expect(post).to have_error_on(:title)
```

---

## 10. Configuration & Deployment

### Multi-Environment Configuration

```ruby
# config/application.rb
module MyApp
  class Application < Rails::Application
    # Custom configuration
    config.x.payment_gateway.url = ENV['PAYMENT_GATEWAY_URL']
    config.x.payment_gateway.timeout = ENV.fetch('PAYMENT_GATEWAY_TIMEOUT', 30).to_i

    # Load custom YAML configuration
    config.x.features = config_for(:features)
  end
end

# config/features.yml
development:
  new_ui: true
  analytics: false

production:
  new_ui: true
  analytics: true

# Access in code
Rails.application.config.x.features['new_ui']
```

### Asset Pipeline & Deployment

```ruby
# Production precompile
RAILS_ENV=production rails assets:precompile

# config/environments/production.rb
config.public_file_server.enabled = ENV['RAILS_SERVE_STATIC_FILES'].present?
config.assets.compile = false
config.assets.digest = true

# Serve assets via CDN
config.asset_host = ENV['ASSET_HOST']
```

---

## 11. Security Best Practices

### Content Security Policy

```ruby
# config/initializers/content_security_policy.rb
Rails.application.config.content_security_policy do |policy|
  policy.default_src :self, :https
  policy.font_src    :self, :https, :data
  policy.img_src     :self, :https, :data
  policy.object_src  :none
  policy.script_src  :self, :https
  policy.style_src   :self, :https
end
```

### Secure Headers

```ruby
# Gemfile
gem 'secure_headers'

# config/initializers/secure_headers.rb
SecureHeaders::Configuration.default do |config|
  config.x_frame_options = "DENY"
  config.x_content_type_options = "nosniff"
  config.x_xss_protection = "1; mode=block"
  config.referrer_policy = "strict-origin-when-cross-origin"
end
```

---

## 12. Production Patterns

### Health Checks

```ruby
# config/routes.rb
get '/health', to: 'health#index'

# app/controllers/health_controller.rb
class HealthController < ApplicationController
  skip_before_action :authenticate_user!

  def index
    checks = {
      database: database_check,
      redis: redis_check,
      sidekiq: sidekiq_check
    }

    status = checks.values.all? ? :ok : :service_unavailable
    render json: checks, status: status
  end

  private

  def database_check
    ActiveRecord::Base.connection.execute('SELECT 1')
    { status: 'ok' }
  rescue StandardError => e
    { status: 'error', message: e.message }
  end

  def redis_check
    Redis.current.ping
    { status: 'ok' }
  rescue StandardError => e
    { status: 'error', message: e.message }
  end

  def sidekiq_check
    Sidekiq::ProcessSet.new.size > 0 ? { status: 'ok' } : { status: 'warning', message: 'no workers' }
  rescue StandardError => e
    { status: 'error', message: e.message }
  end
end
```

### Monitoring & Logging

```ruby
# config/initializers/lograge.rb
Rails.application.configure do
  config.lograge.enabled = true
  config.lograge.custom_options = lambda do |event|
    {
      user_id: event.payload[:user_id],
      params: event.payload[:params].except('controller', 'action')
    }
  end
end

# Structured logging
Rails.logger.info({
  event: 'payment_processed',
  user_id: user.id,
  amount: payment.amount,
  currency: payment.currency
}.to_json)
```

---

**Reference Complete** - Use with SKILL.md for comprehensive Rails expertise
