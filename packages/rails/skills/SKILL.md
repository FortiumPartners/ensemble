# Rails Framework Skill - Quick Reference

**Framework**: Ruby on Rails 7+
**For Agent**: backend-developer
**Purpose**: Fast lookup of common Rails patterns and conventions

---

## 1. Rails MVC Patterns

### Controllers (RESTful Actions)

```ruby
class PostsController < ApplicationController
  before_action :set_post, only: %i[show edit update destroy]
  before_action :authenticate_user!, except: %i[index show]

  def index
    @posts = Post.published.order(created_at: :desc).page(params[:page])
  end

  def show
    # @post set by before_action
  end

  def new
    @post = Post.new
  end

  def create
    @post = current_user.posts.build(post_params)
    if @post.save
      redirect_to @post, notice: 'Post created successfully.'
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit
    # @post set by before_action
  end

  def update
    if @post.update(post_params)
      redirect_to @post, notice: 'Post updated successfully.'
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    @post.destroy
    redirect_to posts_url, notice: 'Post deleted successfully.'
  end

  private

  def set_post
    @post = Post.find(params[:id])
  end

  def post_params
    params.require(:post).permit(:title, :body, :published, :category_id, tag_ids: [])
  end
end
```

### Models (Active Record)

```ruby
class Post < ApplicationRecord
  # Associations
  belongs_to :author, class_name: 'User'
  belongs_to :category
  has_many :comments, dependent: :destroy
  has_many :taggings, dependent: :destroy
  has_many :tags, through: :taggings

  # Validations
  validates :title, presence: true, length: { minimum: 5, maximum: 200 }
  validates :body, presence: true
  validates :author, presence: true

  # Scopes
  scope :published, -> { where(published: true) }
  scope :recent, -> { order(created_at: :desc) }
  scope :by_author, ->(user) { where(author: user) }

  # Callbacks
  before_save :generate_slug
  after_create :notify_subscribers

  # Class methods
  def self.search(query)
    where('title ILIKE ? OR body ILIKE ?', "%#{query}%", "%#{query}%")
  end

  # Instance methods
  def published?
    published && published_at.present?
  end

  private

  def generate_slug
    self.slug = title.parameterize if title_changed?
  end

  def notify_subscribers
    NotifySubscribersJob.perform_later(id)
  end
end
```

### Routes

```ruby
Rails.application.routes.draw do
  # RESTful resources
  resources :posts do
    resources :comments, only: %i[create destroy]
    member do
      post :publish
      post :unpublish
    end
    collection do
      get :search
    end
  end

  # Namespaced API routes
  namespace :api do
    namespace :v1 do
      resources :posts, only: %i[index show create update destroy]
    end
  end

  # Custom routes
  get '/about', to: 'pages#about'
  root 'posts#index'
end
```

---

## 2. Service Objects

### Basic Service Pattern

```ruby
# app/services/create_post_service.rb
class CreatePostService
  def initialize(user, params)
    @user = user
    @params = params
  end

  def call
    post = @user.posts.build(@params)

    ActiveRecord::Base.transaction do
      if post.save
        notify_subscribers(post)
        update_user_stats(@user)
        Result.success(post)
      else
        Result.failure(post.errors)
      end
    end
  rescue StandardError => e
    Result.failure(errors: [e.message])
  end

  private

  def notify_subscribers(post)
    NotifySubscribersJob.perform_later(post.id)
  end

  def update_user_stats(user)
    user.increment!(:posts_count)
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

### Result Object

```ruby
# app/services/result.rb
class Result
  attr_reader :value, :errors

  def initialize(success:, value: nil, errors: nil)
    @success = success
    @value = value
    @errors = errors || []
  end

  def success?
    @success
  end

  def failure?
    !@success
  end

  def self.success(value = nil)
    new(success: true, value: value)
  end

  def self.failure(errors)
    new(success: false, errors: errors)
  end
end
```

---

## 3. Background Jobs

### Active Job with Sidekiq

```ruby
# app/jobs/send_welcome_email_job.rb
class SendWelcomeEmailJob < ApplicationJob
  queue_as :emails

  retry_on ActiveRecord::Deadlocked, wait: 5.seconds, attempts: 3
  discard_on ActiveJob::DeserializationError

  def perform(user_id)
    user = User.find(user_id)
    UserMailer.welcome_email(user).deliver_now
  rescue ActiveRecord::RecordNotFound => e
    # User deleted before job ran
    Rails.logger.warn("User #{user_id} not found: #{e.message}")
  end
end

# Enqueue jobs
SendWelcomeEmailJob.perform_later(user.id)                    # Async
SendWelcomeEmailJob.perform_now(user.id)                      # Sync
SendWelcomeEmailJob.set(wait: 1.hour).perform_later(user.id)  # Delayed
```

### Sidekiq Worker (Direct)

```ruby
# app/workers/data_import_worker.rb
class DataImportWorker
  include Sidekiq::Worker

  sidekiq_options queue: :imports, retry: 5, backtrace: true

  def perform(file_path)
    import_data(file_path)
  rescue StandardError => e
    Rails.logger.error("Import failed: #{e.message}")
    raise  # Re-raise to trigger retry
  end

  private

  def import_data(file_path)
    # Import logic here
  end
end
```

### Sidekiq Configuration

```yaml
# config/sidekiq.yml
:concurrency: 5
:queues:
  - critical
  - default
  - emails
  - imports
  - low

# Retry settings
:max_retries: 5
:timeout: 30
```

---

## 4. Database & Migrations

### Creating Migrations

```ruby
# Generate migration
rails generate migration CreatePosts title:string body:text published:boolean author:references

# db/migrate/20251022000000_create_posts.rb
class CreatePosts < ActiveRecord::Migration[7.0]
  def change
    create_table :posts do |t|
      t.string :title, null: false
      t.text :body, null: false
      t.boolean :published, default: false, null: false
      t.references :author, null: false, foreign_key: { to_table: :users }
      t.string :slug, index: { unique: true }

      t.timestamps
    end

    add_index :posts, :published
    add_index :posts, [:author_id, :created_at]
  end
end

# Add column migration
class AddCategoryToPosts < ActiveRecord::Migration[7.0]
  def change
    add_reference :posts, :category, foreign_key: true, index: true
  end
end

# Index migration
class AddIndexToPostsTitle < ActiveRecord::Migration[7.0]
  def change
    add_index :posts, :title
    # For full-text search
    execute "CREATE INDEX posts_title_gin_trgm_idx ON posts USING gin(title gin_trgm_ops)"
  end
end
```

### Query Optimization (N+1 Prevention)

```ruby
# Bad: N+1 query (1 query for posts + N queries for authors)
posts = Post.all
posts.each do |post|
  puts post.author.name  # Triggers separate query for each post
end

# Good: Eager loading with includes
posts = Post.includes(:author).all
posts.each do |post|
  puts post.author.name  # No additional queries
end

# Preload multiple associations
Post.includes(:author, :comments, :tags).all

# Joins (when you need to filter by association)
Post.joins(:author).where(users: { active: true })

# Left outer joins (include posts without authors)
Post.left_joins(:comments).group(:id).select('posts.*, COUNT(comments.id) as comments_count')
```

### Advanced Queries

```ruby
# Scopes with arguments
class Post < ApplicationRecord
  scope :published_after, ->(date) { where('published_at > ?', date) }
  scope :by_category, ->(category) { where(category: category) }
  scope :search, ->(query) { where('title ILIKE ?', "%#{query}%") }
end

# Chaining scopes
Post.published.by_category('tech').search('rails')

# Subqueries
popular_posts = Post.select(:id).where('views_count > ?', 1000)
Comment.where(post_id: popular_posts)

# Aggregation
Post.group(:category_id).count
Post.group(:category_id).average(:views_count)
Post.group(:category_id).sum(:likes_count)
```

---

## 5. API Development

### API Controller

```ruby
# app/controllers/api/v1/base_controller.rb
module Api
  module V1
    class BaseController < ActionController::API
      before_action :authenticate_api_user!

      rescue_from ActiveRecord::RecordNotFound, with: :not_found
      rescue_from ActionController::ParameterMissing, with: :bad_request

      private

      def authenticate_api_user!
        token = request.headers['Authorization']&.split(' ')&.last
        @current_api_user = User.find_by(api_token: token)

        render json: { error: 'Unauthorized' }, status: :unauthorized unless @current_api_user
      end

      def not_found
        render json: { error: 'Not found' }, status: :not_found
      end

      def bad_request
        render json: { error: 'Bad request' }, status: :bad_request
      end
    end
  end
end

# app/controllers/api/v1/posts_controller.rb
module Api
  module V1
    class PostsController < BaseController
      skip_before_action :authenticate_api_user!, only: %i[index show]

      def index
        @posts = Post.published.page(params[:page]).per(params[:per_page] || 20)
        render json: @posts, each_serializer: PostSerializer
      end

      def show
        @post = Post.find(params[:id])
        render json: @post, serializer: PostSerializer
      end

      def create
        @post = @current_api_user.posts.build(post_params)

        if @post.save
          render json: @post, serializer: PostSerializer, status: :created
        else
          render json: { errors: @post.errors }, status: :unprocessable_entity
        end
      end

      private

      def post_params
        params.require(:post).permit(:title, :body, :published, :category_id)
      end
    end
  end
end
```

### Serializers

```ruby
# app/serializers/post_serializer.rb
class PostSerializer < ActiveModel::Serializer
  attributes :id, :title, :body, :slug, :published_at, :created_at

  belongs_to :author, serializer: AuthorSerializer
  has_many :comments, serializer: CommentSerializer

  def published_at
    object.published_at&.iso8601
  end
end

# app/serializers/author_serializer.rb
class AuthorSerializer < ActiveModel::Serializer
  attributes :id, :name, :email, :avatar_url
end
```

### Routes for API

```ruby
# config/routes.rb
Rails.application.routes.draw do
  namespace :api do
    namespace :v1 do
      resources :posts, only: %i[index show create update destroy] do
        resources :comments, only: %i[index create destroy]
      end

      resources :users, only: %i[show update]
      post '/auth/login', to: 'authentication#login'
      delete '/auth/logout', to: 'authentication#logout'
    end
  end
end
```

---

## 6. Testing with RSpec

### Model Specs

```ruby
# spec/models/post_spec.rb
require 'rails_helper'

RSpec.describe Post, type: :model do
  describe 'associations' do
    it { should belong_to(:author).class_name('User') }
    it { should belong_to(:category) }
    it { should have_many(:comments).dependent(:destroy) }
    it { should have_many(:tags).through(:taggings) }
  end

  describe 'validations' do
    it { should validate_presence_of(:title) }
    it { should validate_presence_of(:body) }
    it { should validate_length_of(:title).is_at_least(5).is_at_most(200) }
  end

  describe 'scopes' do
    let!(:published_post) { create(:post, published: true) }
    let!(:draft_post) { create(:post, published: false) }

    it 'returns only published posts' do
      expect(Post.published).to include(published_post)
      expect(Post.published).not_to include(draft_post)
    end
  end

  describe '#published?' do
    it 'returns true when post is published' do
      post = build(:post, published: true, published_at: 1.day.ago)
      expect(post).to be_published
    end

    it 'returns false when post is not published' do
      post = build(:post, published: false)
      expect(post).not_to be_published
    end
  end
end
```

### Request Specs (Controllers)

```ruby
# spec/requests/api/v1/posts_spec.rb
require 'rails_helper'

RSpec.describe 'Api::V1::Posts', type: :request do
  let(:user) { create(:user) }
  let(:headers) { { 'Authorization' => "Bearer #{user.api_token}" } }

  describe 'GET /api/v1/posts' do
    it 'returns all published posts' do
      create_list(:post, 3, published: true)
      create(:post, published: false)

      get '/api/v1/posts'

      expect(response).to have_http_status(:success)
      json = JSON.parse(response.body)
      expect(json.size).to eq(3)
    end

    it 'paginates results' do
      create_list(:post, 25, published: true)

      get '/api/v1/posts', params: { page: 1, per_page: 10 }

      expect(response).to have_http_status(:success)
      json = JSON.parse(response.body)
      expect(json.size).to eq(10)
    end
  end

  describe 'POST /api/v1/posts' do
    let(:valid_params) do
      { post: { title: 'New Post', body: 'Post body', published: true } }
    end

    context 'with valid parameters' do
      it 'creates a new post' do
        expect {
          post '/api/v1/posts', params: valid_params, headers: headers
        }.to change(Post, :count).by(1)

        expect(response).to have_http_status(:created)
      end
    end

    context 'with invalid parameters' do
      it 'returns error messages' do
        invalid_params = { post: { title: '' } }
        post '/api/v1/posts', params: invalid_params, headers: headers

        expect(response).to have_http_status(:unprocessable_entity)
        json = JSON.parse(response.body)
        expect(json['errors']).to be_present
      end
    end
  end
end
```

### Factory Bot

```ruby
# spec/factories/posts.rb
FactoryBot.define do
  factory :post do
    sequence(:title) { |n| "Post Title #{n}" }
    body { Faker::Lorem.paragraphs(number: 3).join("\n\n") }
    published { false }
    association :author, factory: :user
    association :category

    trait :published do
      published { true }
      published_at { 1.day.ago }
    end

    trait :with_comments do
      after(:create) do |post|
        create_list(:comment, 3, post: post)
      end
    end
  end
end

# Usage
create(:post)  # Draft post
create(:post, :published)  # Published post
create(:post, :published, :with_comments)  # Published post with 3 comments
```

---

## 7. Configuration & Environment

### Environment Variables

```ruby
# .env.development
DATABASE_URL=postgres://localhost/myapp_development
REDIS_URL=redis://localhost:6379/0
SIDEKIQ_WEB_USERNAME=admin
SIDEKIQ_WEB_PASSWORD=password

# Access in code
ENV['DATABASE_URL']
ENV.fetch('REDIS_URL', 'redis://localhost:6379/0')  # With default

# config/database.yml
default: &default
  adapter: postgresql
  encoding: unicode
  pool: <%= ENV.fetch("RAILS_MAX_THREADS") { 5 } %>
  url: <%= ENV['DATABASE_URL'] %>
```

### Encrypted Credentials

```bash
# Edit credentials
EDITOR=vim rails credentials:edit

# View credentials
rails credentials:show

# Production credentials
EDITOR=vim rails credentials:edit --environment production
```

```yaml
# config/credentials.yml.enc (encrypted)
stripe:
  publishable_key: pk_test_xxxxx
  secret_key: sk_test_xxxxx

aws:
  access_key_id: AKIAIOSFODNN7EXAMPLE
  secret_access_key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

```ruby
# Access in code
Rails.application.credentials.stripe[:secret_key]
Rails.application.credentials.dig(:aws, :access_key_id)
```

---

## 8. Common Rails Commands

### Generators

```bash
# Models
rails generate model Post title:string body:text published:boolean author:references
rails generate model Comment body:text post:references user:references

# Controllers
rails generate controller Posts index show new create edit update destroy
rails generate controller Api::V1::Posts index show create update destroy

# Migrations
rails generate migration AddSlugToPosts slug:string:uniq
rails generate migration AddCategoryToPosts category:references
rails generate migration CreateJoinTablePostsTags posts tags

# Resources (model + migration + controller + views)
rails generate resource Post title:string body:text
```

### Database Commands

```bash
# Create database
rails db:create

# Run migrations
rails db:migrate

# Rollback last migration
rails db:rollback

# Rollback specific number of migrations
rails db:rollback STEP=3

# Reset database (drop, create, migrate, seed)
rails db:reset

# Seed database
rails db:seed

# Check migration status
rails db:migrate:status
```

### Testing

```bash
# Run all tests
bundle exec rspec

# Run specific file
bundle exec rspec spec/models/post_spec.rb

# Run specific test
bundle exec rspec spec/models/post_spec.rb:15

# Run with coverage
COVERAGE=true bundle exec rspec
```

### Console & Server

```bash
# Rails console
rails console
rails c

# Production console
rails console production

# Start server
rails server
rails s

# Start server on specific port
rails s -p 3001
```

---

## 9. Performance Best Practices

### Caching

```ruby
# Fragment caching (views)
<% cache post do %>
  <%= render post %>
<% end %>

# Russian doll caching (nested)
<% cache post do %>
  <%= render post %>
  <% cache post.comments do %>
    <%= render post.comments %>
  <% end %>
<% end %>

# Low-level caching
Rails.cache.fetch("user_#{user.id}_posts", expires_in: 1.hour) do
  user.posts.published.to_a
end

# Cache expiration
Rails.cache.delete("user_#{user.id}_posts")
Rails.cache.clear  # Clear all cache
```

### Counter Cache

```ruby
# Model
class Post < ApplicationRecord
  belongs_to :author, class_name: 'User', counter_cache: true
end

class User < ApplicationRecord
  has_many :posts
end

# Migration
add_column :users, :posts_count, :integer, default: 0, null: false

# Reset counter cache
User.find_each { |u| User.reset_counters(u.id, :posts) }
```

### Database Indexing

```ruby
# Add indexes for foreign keys
add_index :posts, :author_id
add_index :posts, :category_id

# Compound index for common queries
add_index :posts, [:author_id, :created_at]
add_index :posts, [:published, :created_at]

# Unique index
add_index :posts, :slug, unique: true

# Partial index (PostgreSQL)
execute "CREATE INDEX index_posts_published ON posts (published_at) WHERE published = true"
```

---

## 10. Security Patterns

### Strong Parameters

```ruby
# Always use strong parameters
def post_params
  params.require(:post).permit(:title, :body, :published, :category_id, tag_ids: [])
end

# Nested attributes
def user_params
  params.require(:user).permit(
    :name, :email,
    addresses_attributes: [:id, :street, :city, :_destroy]
  )
end
```

### Authorization (Pundit)

```ruby
# app/policies/post_policy.rb
class PostPolicy < ApplicationPolicy
  def update?
    user.admin? || record.author == user
  end

  def destroy?
    user.admin?
  end
end

# Controller
def update
  @post = Post.find(params[:id])
  authorize @post  # Raises Pundit::NotAuthorizedError if not allowed

  if @post.update(post_params)
    redirect_to @post
  else
    render :edit
  end
end
```

### Authentication (Devise)

```ruby
# Controller
class PostsController < ApplicationController
  before_action :authenticate_user!, except: %i[index show]

  def create
    @post = current_user.posts.build(post_params)
    # ...
  end
end

# View
<% if user_signed_in? %>
  <%= link_to 'New Post', new_post_path %>
<% else %>
  <%= link_to 'Sign In', new_user_session_path %>
<% end %>
```

---

**Quick Reference Complete** - See REFERENCE.md for comprehensive details and advanced patterns
