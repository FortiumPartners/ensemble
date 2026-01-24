# Rails API Serializer Template (Active Model Serializers)
#
# Placeholder System:
# - {{ClassName}} → PascalCase class name (e.g., BlogPost)
# - {{class_name}} → snake_case name (e.g., blog_post)
# - {{ModelName}} → Associated model name (e.g., User, Category)
# - {{association_name}} → Association name (e.g., author, comments)
# - {{field_name}} → Field name (e.g., title, body)
#
# Usage Example:
# Replace placeholders with actual values:
#   {{ClassName}} = BlogPost
#   {{class_name}} = blog_post
#   {{ModelName}} = User
#   {{association_name}} = author
#   {{field_name}} = title
#
# Installation:
# Add to Gemfile: gem 'active_model_serializers', '~> 0.10.0'

# ==========================================
# BASIC SERIALIZER
# ==========================================
class {{ClassName}}Serializer < ActiveModel::Serializer
  attributes :id, :{{field_name}}, :body, :published, :created_at, :updated_at

  # Associations
  belongs_to :{{association_name}}
  has_many :comments

  # Custom attribute
  attribute :formatted_date

  def formatted_date
    object.created_at.strftime('%B %d, %Y')
  end
end

# Controller usage:
# render json: @{{class_name}}, serializer: {{ClassName}}Serializer

# ==========================================
# SERIALIZER WITH CONDITIONALS
# ==========================================
class Detailed{{ClassName}}Serializer < ActiveModel::Serializer
  attributes :id, :{{field_name}}, :body, :published, :created_at, :updated_at

  # Conditional attributes
  attribute :edit_url, if: :current_user_is_author?
  attribute :draft_content, if: :show_draft?

  belongs_to :{{association_name}}, serializer: Author{{ModelName}}Serializer
  has_many :comments, if: :show_comments?

  def edit_url
    # Requires passing scope: { current_user: user } from controller
    Rails.application.routes.url_helpers.edit_{{class_name}}_url(object)
  end

  def draft_content
    object.draft_body
  end

  def show_draft?
    current_user_is_author? || scope[:admin]
  end

  def show_comments?
    !scope[:minimal]
  end

  private

  def current_user_is_author?
    scope[:current_user] == object.{{association_name}}
  end
end

# Controller usage with scope:
# render json: @{{class_name}},
#        serializer: Detailed{{ClassName}}Serializer,
#        scope: { current_user: current_user, admin: current_user&.admin? }

# ==========================================
# NESTED ASSOCIATION SERIALIZER
# ==========================================
class Author{{ModelName}}Serializer < ActiveModel::Serializer
  attributes :id, :name, :email, :avatar_url

  def avatar_url
    # Return avatar URL or default
    object.avatar.url || 'https://example.com/default-avatar.png'
  end
end

class Comment{{ClassName}}Serializer < ActiveModel::Serializer
  attributes :id, :body, :created_at

  belongs_to :user, serializer: Author{{ModelName}}Serializer
end

# ==========================================
# COLLECTION SERIALIZER (for arrays)
# ==========================================
class {{ClassName}}CollectionSerializer < ActiveModel::Serializer
  attributes :{{table_name}}, :meta

  def {{table_name}}
    ActiveModelSerializers::SerializableResource.new(
      object,
      each_serializer: {{ClassName}}Serializer
    )
  end

  def meta
    {
      total_count: object.total_count,
      page: object.current_page,
      per_page: object.limit_value,
      total_pages: object.total_pages
    }
  end
end

# Controller usage:
# @{{table_name}} = {{ClassName}}.page(params[:page])
# render json: @{{table_name}}, serializer: {{ClassName}}CollectionSerializer

# ==========================================
# JBUILDER ALTERNATIVE (JSON Views)
# ==========================================
# app/views/api/v1/{{table_name}}/index.json.jbuilder
json.{{table_name}} do
  json.array! @{{table_name}} do |{{class_name}}|
    json.extract! {{class_name}}, :id, :{{field_name}}, :body, :published, :created_at
    json.{{association_name}} do
      json.extract! {{class_name}}.{{association_name}}, :id, :name, :email
    end
    json.url {{class_name}}_url({{class_name}}, format: :json)
  end
end

json.meta do
  json.total_count @{{table_name}}.total_count
  json.page @{{table_name}}.current_page
  json.per_page @{{table_name}}.limit_value
end

# app/views/api/v1/{{table_name}}/show.json.jbuilder
json.extract! @{{class_name}}, :id, :{{field_name}}, :body, :published, :created_at, :updated_at

json.{{association_name}} do
  json.extract! @{{class_name}}.{{association_name}}, :id, :name, :email, :avatar_url
end

json.comments @{{class_name}}.comments do |comment|
  json.extract! comment, :id, :body, :created_at
  json.user do
    json.extract! comment.user, :id, :name
  end
end

# ==========================================
# CUSTOM JSON SERIALIZATION (Plain Ruby)
# ==========================================
class {{ClassName}}Presenter
  def initialize({{class_name}}, options = {})
    @{{class_name}} = {{class_name}}
    @options = options
  end

  def as_json
    {
      id: @{{class_name}}.id,
      {{field_name}}: @{{class_name}}.{{field_name}},
      body: @{{class_name}}.body,
      published: @{{class_name}}.published,
      created_at: @{{class_name}}.created_at.iso8601,
      updated_at: @{{class_name}}.updated_at.iso8601,
      {{association_name}}: {{association_name}}_json,
      comments_count: @{{class_name}}.comments.count,
      url: Rails.application.routes.url_helpers.{{class_name}}_url(@{{class_name}})
    }.tap do |hash|
      # Add optional fields
      hash[:comments] = comments_json if @options[:include_comments]
      hash[:edit_url] = edit_url if @options[:editable]
    end
  end

  private

  def {{association_name}}_json
    {
      id: @{{class_name}}.{{association_name}}.id,
      name: @{{class_name}}.{{association_name}}.name,
      email: @{{class_name}}.{{association_name}}.email
    }
  end

  def comments_json
    @{{class_name}}.comments.map do |comment|
      {
        id: comment.id,
        body: comment.body,
        user: { id: comment.user.id, name: comment.user.name }
      }
    end
  end

  def edit_url
    Rails.application.routes.url_helpers.edit_{{class_name}}_url(@{{class_name}})
  end
end

# Controller usage:
# render json: {{ClassName}}Presenter.new(@{{class_name}}, include_comments: true).as_json

# ==========================================
# API VERSIONING SERIALIZERS
# ==========================================
module Api
  module V1
    class {{ClassName}}Serializer < ActiveModel::Serializer
      attributes :id, :{{field_name}}, :body, :created_at

      # V1 specific formatting
      def created_at
        object.created_at.to_i  # Unix timestamp
      end
    end
  end

  module V2
    class {{ClassName}}Serializer < ActiveModel::Serializer
      attributes :id, :{{field_name}}, :body, :created_at, :updated_at

      # V2 uses ISO8601 format
      def created_at
        object.created_at.iso8601
      end

      def updated_at
        object.updated_at.iso8601
      end

      # V2 adds new fields
      attribute :reading_time

      def reading_time
        (object.body.split.size / 200.0).ceil  # Estimated minutes
      end
    end
  end
end

# Controller usage:
# module Api
#   module V1
#     class {{ClassName}}sController < ApiController
#       def show
#         render json: @{{class_name}}, serializer: Api::V1::{{ClassName}}Serializer
#       end
#     end
#   end
# end

# ==========================================
# PAGINATION HELPER
# ==========================================
module PaginationHelper
  def pagination_meta(collection)
    {
      current_page: collection.current_page,
      next_page: collection.next_page,
      prev_page: collection.prev_page,
      total_pages: collection.total_pages,
      total_count: collection.total_count,
      per_page: collection.limit_value
    }
  end

  def paginated_json(collection, serializer:)
    {
      data: ActiveModelSerializers::SerializableResource.new(
        collection,
        each_serializer: serializer
      ),
      meta: pagination_meta(collection)
    }
  end
end

# Controller usage:
# class {{ClassName}}sController < ApplicationController
#   include PaginationHelper
#
#   def index
#     @{{table_name}} = {{ClassName}}.page(params[:page])
#     render json: paginated_json(@{{table_name}}, serializer: {{ClassName}}Serializer)
#   end
# end

# ==========================================
# ERROR SERIALIZATION
# ==========================================
class ErrorSerializer
  def initialize(errors)
    @errors = errors
  end

  def as_json
    {
      errors: @errors.messages.map do |field, messages|
        messages.map do |message|
          {
            field: field,
            message: message,
            code: error_code(field, message)
          }
        end
      end.flatten
    }
  end

  private

  def error_code(field, message)
    # Generate error codes for client-side handling
    "#{field}_#{message.parameterize.underscore}".upcase
  end
end

# Controller usage:
# def create
#   @{{class_name}} = {{ClassName}}.new({{class_name}}_params)
#
#   if @{{class_name}}.save
#     render json: @{{class_name}}, status: :created
#   else
#     render json: ErrorSerializer.new(@{{class_name}}.errors).as_json,
#            status: :unprocessable_entity
#   end
# end

# ==========================================
# BEST PRACTICES
# ==========================================
#
# 1. Keep serializers focused and single-purpose
#    - One serializer per resource type
#    - Use inheritance for variations (ListSerializer, DetailSerializer)
#
# 2. Avoid N+1 queries
#    - Eager load associations in controller
#    - Use includes() before serialization
#
# 3. Use conditional attributes sparingly
#    - Create separate serializers for different contexts
#    - Better: Minimal{{ClassName}}Serializer vs Detailed{{ClassName}}Serializer
#
# 4. Version your API serializers
#    - Namespace serializers by version (Api::V1, Api::V2)
#    - Document breaking changes
#
# 5. Include pagination metadata
#    - Use pagination helper for consistent format
#    - Include next/prev page URLs
#
# 6. Format dates consistently
#    - Use ISO8601 for timestamps
#    - Document timezone handling
#
# 7. Handle errors gracefully
#    - Return structured error responses
#    - Include error codes for client handling
#
# 8. Cache expensive computations
#    - Use fragment caching for complex serializations
#    - Cache at serializer level when appropriate
#
# 9. Document your API responses
#    - Include example responses in comments
#    - Use OpenAPI/Swagger for API documentation
#
# 10. Test serializer output
#     - Unit test serializer structure
#     - Integration test full API responses
