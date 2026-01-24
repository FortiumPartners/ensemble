# Rails Blog API Example
#
# Complete RESTful API demonstrating:
# - JWT authentication
# - Role-based authorization (Pundit)
# - API versioning
# - N+1 prevention
# - Serialization
# - Error handling
# - Rate limiting
# - Testing patterns
#
# Stack:
# - Rails 7.0+
# - PostgreSQL
# - JWT for authentication
# - Pundit for authorization
# - Active Model Serializers
# - RSpec for testing

# ==========================================
# MODELS
# ==========================================

# app/models/user.rb
class User < ApplicationRecord
  has_secure_password

  has_many :posts, foreign_key: :author_id, dependent: :destroy
  has_many :comments, dependent: :destroy

  validates :email, presence: true, uniqueness: { case_sensitive: false }
  validates :name, presence: true
  validates :password, length: { minimum: 8 }, if: -> { password.present? }

  enum role: { viewer: 0, author: 1, editor: 2, admin: 3 }

  before_save :downcase_email
  after_create :generate_api_token

  def admin?
    role == 'admin'
  end

  def can_publish?
    editor? || admin?
  end

  private

  def downcase_email
    self.email = email.downcase if email.present?
  end

  def generate_api_token
    update_column(:api_token, SecureRandom.hex(32))
  end
end

# app/models/post.rb
class Post < ApplicationRecord
  belongs_to :author, class_name: 'User'
  belongs_to :category, optional: true
  has_many :comments, dependent: :destroy
  has_many :taggings, dependent: :destroy
  has_many :tags, through: :taggings

  validates :title, presence: true, length: { minimum: 5, maximum: 200 }
  validates :body, presence: true
  validates :slug, uniqueness: { case_sensitive: false }, allow_nil: true

  scope :published, -> { where(published: true).where.not(published_at: nil) }
  scope :recent, -> { order(created_at: :desc) }
  scope :by_author, ->(user) { where(author: user) }
  scope :by_category, ->(category) { where(category: category) }

  before_save :generate_slug, if: :title_changed?
  after_create :increment_author_posts_count

  def self.search(query)
    where('title ILIKE ? OR body ILIKE ?', "%#{query}%", "%#{query}%")
  end

  def published?
    published && published_at.present?
  end

  def to_param
    slug.presence || id.to_s
  end

  private

  def generate_slug
    self.slug = title.parameterize if title.present?
  end

  def increment_author_posts_count
    author.increment!(:posts_count)
  end
end

# app/models/category.rb
class Category < ApplicationRecord
  has_many :posts, dependent: :nullify

  validates :name, presence: true, uniqueness: { case_sensitive: false }
  validates :slug, uniqueness: { case_sensitive: false }, allow_nil: true

  before_save :generate_slug

  private

  def generate_slug
    self.slug = name.parameterize if name.present?
  end
end

# app/models/tag.rb
class Tag < ApplicationRecord
  has_many :taggings, dependent: :destroy
  has_many :posts, through: :taggings

  validates :name, presence: true, uniqueness: { case_sensitive: false }

  before_save :downcase_name

  private

  def downcase_name
    self.name = name.downcase if name.present?
  end
end

# app/models/tagging.rb
class Tagging < ApplicationRecord
  belongs_to :post
  belongs_to :tag

  validates :post_id, uniqueness: { scope: :tag_id }
end

# app/models/comment.rb
class Comment < ApplicationRecord
  belongs_to :post
  belongs_to :user

  validates :body, presence: true, length: { minimum: 1, maximum: 1000 }

  scope :recent, -> { order(created_at: :desc) }

  after_create :increment_post_comments_count

  private

  def increment_post_comments_count
    post.increment!(:comments_count)
  end
end

# ==========================================
# POLICIES (Authorization)
# ==========================================

# app/policies/application_policy.rb
class ApplicationPolicy
  attr_reader :user, :record

  def initialize(user, record)
    @user = user
    @record = record
  end

  def index?
    true
  end

  def show?
    true
  end

  def create?
    user.present?
  end

  def update?
    user.present? && owner?
  end

  def destroy?
    user.present? && owner?
  end

  private

  def owner?
    record.respond_to?(:user) && record.user == user
  end

  class Scope
    attr_reader :user, :scope

    def initialize(user, scope)
      @user = user
      @scope = scope
    end

    def resolve
      scope.all
    end
  end
end

# app/policies/post_policy.rb
class PostPolicy < ApplicationPolicy
  class Scope < Scope
    def resolve
      if user&.admin?
        scope.all
      elsif user&.editor?
        scope.published.or(scope.where(author: user))
      else
        scope.published
      end
    end
  end

  def show?
    record.published? || owner? || user&.admin?
  end

  def update?
    owner? || user&.admin? || user&.editor?
  end

  def destroy?
    owner? || user&.admin?
  end

  def publish?
    (owner? && user.can_publish?) || user&.admin?
  end

  private

  def owner?
    record.author == user
  end
end

# ==========================================
# SERIALIZERS
# ==========================================

# app/serializers/user_serializer.rb
class UserSerializer < ActiveModel::Serializer
  attributes :id, :name, :email, :role, :created_at

  def created_at
    object.created_at.iso8601
  end
end

# app/serializers/author_serializer.rb
class AuthorSerializer < ActiveModel::Serializer
  attributes :id, :name, :posts_count
end

# app/serializers/post_serializer.rb
class PostSerializer < ActiveModel::Serializer
  attributes :id, :title, :body, :slug, :published, :published_at, :created_at, :updated_at

  belongs_to :author, serializer: AuthorSerializer
  belongs_to :category, if: -> { object.category.present? }
  has_many :tags

  def published_at
    object.published_at&.iso8601
  end

  def created_at
    object.created_at.iso8601
  end

  def updated_at
    object.updated_at.iso8601
  end
end

# app/serializers/category_serializer.rb
class CategorySerializer < ActiveModel::Serializer
  attributes :id, :name, :slug
end

# app/serializers/tag_serializer.rb
class TagSerializer < ActiveModel::Serializer
  attributes :id, :name
end

# app/serializers/comment_serializer.rb
class CommentSerializer < ActiveModel::Serializer
  attributes :id, :body, :created_at

  belongs_to :user, serializer: AuthorSerializer

  def created_at
    object.created_at.iso8601
  end
end

# ==========================================
# CONTROLLERS
# ==========================================

# app/controllers/api/api_controller.rb
module Api
  class ApiController < ActionController::API
    include Pundit::Authorization

    before_action :authenticate_user!

    rescue_from ActiveRecord::RecordNotFound, with: :not_found
    rescue_from ActionController::ParameterMissing, with: :bad_request
    rescue_from Pundit::NotAuthorizedError, with: :forbidden

    private

    def authenticate_user!
      token = request.headers['Authorization']&.split(' ')&.last
      @current_user = User.find_by(api_token: token) if token

      render_unauthorized unless @current_user
    end

    def current_user
      @current_user
    end

    def render_unauthorized
      render json: { error: 'Unauthorized' }, status: :unauthorized
    end

    def not_found
      render json: { error: 'Not found' }, status: :not_found
    end

    def bad_request
      render json: { error: 'Bad request' }, status: :bad_request
    end

    def forbidden
      render json: { error: 'Forbidden' }, status: :forbidden
    end
  end
end

# app/controllers/api/v1/authentication_controller.rb
module Api
  module V1
    class AuthenticationController < ApiController
      skip_before_action :authenticate_user!, only: %i[login register]

      def login
        user = User.find_by(email: params[:email]&.downcase)

        if user&.authenticate(params[:password])
          token = JsonWebToken.encode(user_id: user.id)
          render json: { token: token, user: UserSerializer.new(user) }
        else
          render json: { error: 'Invalid credentials' }, status: :unauthorized
        end
      end

      def register
        user = User.new(registration_params)

        if user.save
          token = JsonWebToken.encode(user_id: user.id)
          render json: { token: token, user: UserSerializer.new(user) }, status: :created
        else
          render json: { errors: user.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def logout
        # JWT is stateless, so just return success
        head :no_content
      end

      private

      def registration_params
        params.require(:user).permit(:name, :email, :password, :password_confirmation)
      end
    end
  end
end

# app/controllers/api/v1/posts_controller.rb
module Api
  module V1
    class PostsController < ApiController
      skip_before_action :authenticate_user!, only: %i[index show]
      before_action :set_post, only: %i[show update destroy publish]

      def index
        @posts = policy_scope(Post)
                 .includes(:author, :category, :tags)
                 .page(params[:page])
                 .per(params[:per_page] || 20)

        @posts = @posts.search(params[:q]) if params[:q].present?
        @posts = @posts.by_category(params[:category_id]) if params[:category_id].present?

        render json: @posts, each_serializer: PostSerializer, meta: pagination_meta(@posts)
      end

      def show
        authorize @post
        render json: @post, serializer: PostSerializer
      end

      def create
        @post = current_user.posts.build(post_params)
        authorize @post

        if @post.save
          render json: @post, serializer: PostSerializer, status: :created
        else
          render json: { errors: @post.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        authorize @post

        if @post.update(post_params)
          render json: @post, serializer: PostSerializer
        else
          render json: { errors: @post.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        authorize @post
        @post.destroy
        head :no_content
      end

      def publish
        authorize @post, :publish?

        if @post.update(published: true, published_at: Time.current)
          render json: @post, serializer: PostSerializer
        else
          render json: { errors: @post.errors.full_messages }, status: :unprocessable_entity
        end
      end

      private

      def set_post
        @post = Post.find(params[:id])
      end

      def post_params
        params.require(:post).permit(:title, :body, :published, :category_id, tag_ids: [])
      end

      def pagination_meta(collection)
        {
          current_page: collection.current_page,
          next_page: collection.next_page,
          prev_page: collection.prev_page,
          total_pages: collection.total_pages,
          total_count: collection.total_count
        }
      end
    end
  end
end

# app/controllers/api/v1/comments_controller.rb
module Api
  module V1
    class CommentsController < ApiController
      before_action :set_post

      def index
        @comments = @post.comments.includes(:user).recent
        render json: @comments, each_serializer: CommentSerializer
      end

      def create
        @comment = @post.comments.build(comment_params.merge(user: current_user))

        if @comment.save
          render json: @comment, serializer: CommentSerializer, status: :created
        else
          render json: { errors: @comment.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        @comment = @post.comments.find(params[:id])

        if @comment.user == current_user || current_user.admin?
          @comment.destroy
          head :no_content
        else
          render json: { error: 'Forbidden' }, status: :forbidden
        end
      end

      private

      def set_post
        @post = Post.find(params[:post_id])
      end

      def comment_params
        params.require(:comment).permit(:body)
      end
    end
  end
end

# ==========================================
# UTILITIES
# ==========================================

# lib/json_web_token.rb
class JsonWebToken
  SECRET_KEY = Rails.application.credentials.secret_key_base.to_s

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

# ==========================================
# ROUTES
# ==========================================

# config/routes.rb
Rails.application.routes.draw do
  namespace :api do
    namespace :v1 do
      # Authentication
      post '/auth/login', to: 'authentication#login'
      post '/auth/register', to: 'authentication#register'
      delete '/auth/logout', to: 'authentication#logout'

      # Posts
      resources :posts do
        member do
          post :publish
        end
        resources :comments, only: %i[index create destroy]
      end

      # Categories
      resources :categories, only: %i[index show]

      # Tags
      resources :tags, only: %i[index show]
    end
  end
end

# ==========================================
# CONFIGURATION
# ==========================================

# config/initializers/rack_attack.rb
class Rack::Attack
  # Throttle login attempts
  throttle('api/login', limit: 5, period: 20.seconds) do |req|
    req.ip if req.path == '/api/v1/auth/login' && req.post?
  end

  # Throttle API requests by IP
  throttle('api/ip', limit: 100, period: 1.minute) do |req|
    req.ip if req.path.start_with?('/api')
  end

  # Throttle authenticated API requests
  throttle('api/user', limit: 300, period: 5.minutes) do |req|
    if req.path.start_with?('/api') && req.env['current_user']
      req.env['current_user'].id
    end
  end
end

# config/application.rb
# Add to application configuration
config.middleware.use Rack::Attack
config.api_only = true

# ==========================================
# MIGRATIONS
# ==========================================

# db/migrate/XXXXXX_create_users.rb
class CreateUsers < ActiveRecord::Migration[7.0]
  def change
    create_table :users do |t|
      t.string :name, null: false
      t.string :email, null: false
      t.string :password_digest, null: false
      t.string :api_token
      t.integer :role, default: 0, null: false
      t.integer :posts_count, default: 0, null: false

      t.timestamps
    end

    add_index :users, :email, unique: true
    add_index :users, :api_token, unique: true
  end
end

# db/migrate/XXXXXX_create_posts.rb
class CreatePosts < ActiveRecord::Migration[7.0]
  def change
    create_table :posts do |t|
      t.string :title, null: false
      t.text :body, null: false
      t.string :slug
      t.boolean :published, default: false, null: false
      t.datetime :published_at
      t.references :author, null: false, foreign_key: { to_table: :users }
      t.references :category, foreign_key: true
      t.integer :comments_count, default: 0, null: false

      t.timestamps
    end

    add_index :posts, :slug, unique: true
    add_index :posts, :published
    add_index :posts, [:author_id, :created_at]
  end
end

# ==========================================
# TESTS (RSpec)
# ==========================================

# spec/requests/api/v1/posts_spec.rb
require 'rails_helper'

RSpec.describe 'Api::V1::Posts', type: :request do
  let(:user) { create(:user, role: :author) }
  let(:headers) { { 'Authorization' => "Bearer #{user.api_token}" } }

  describe 'GET /api/v1/posts' do
    it 'returns published posts' do
      published_posts = create_list(:post, 3, :published)
      draft_post = create(:post, published: false)

      get '/api/v1/posts'

      expect(response).to have_http_status(:success)
      json = JSON.parse(response.body)
      expect(json.size).to eq(3)
    end

    it 'searches posts by query' do
      post1 = create(:post, :published, title: 'Ruby on Rails')
      post2 = create(:post, :published, title: 'Python Guide')

      get '/api/v1/posts', params: { q: 'Ruby' }

      expect(response).to have_http_status(:success)
      json = JSON.parse(response.body)
      expect(json.size).to eq(1)
      expect(json[0]['title']).to eq('Ruby on Rails')
    end
  end

  describe 'POST /api/v1/posts' do
    let(:valid_params) do
      { post: { title: 'New Post', body: 'Post content' } }
    end

    context 'with authentication' do
      it 'creates a post' do
        expect {
          post '/api/v1/posts', params: valid_params, headers: headers
        }.to change(Post, :count).by(1)

        expect(response).to have_http_status(:created)
        json = JSON.parse(response.body)
        expect(json['title']).to eq('New Post')
      end
    end

    context 'without authentication' do
      it 'returns unauthorized' do
        post '/api/v1/posts', params: valid_params
        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe 'DELETE /api/v1/posts/:id' do
    let(:post_record) { create(:post, author: user) }

    it 'deletes own post' do
      expect {
        delete "/api/v1/posts/#{post_record.id}", headers: headers
      }.to change(Post, :count).by(-1)

      expect(response).to have_http_status(:no_content)
    end

    it 'cannot delete other user post' do
      other_post = create(:post)

      delete "/api/v1/posts/#{other_post.id}", headers: headers
      expect(response).to have_http_status(:forbidden)
    end
  end
end

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
