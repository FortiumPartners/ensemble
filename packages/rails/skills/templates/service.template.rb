# Rails Service Object Template
#
# Placeholder System:
# - {{ActionName}} → Action verb + noun (e.g., CreateBlogPost, ProcessPayment)
# - {{ClassName}} → Model class name (e.g., BlogPost)
# - {{class_name}} → snake_case model name (e.g., blog_post)
# - {{ModelName}} → Associated model name (e.g., User)
# - {{association_name}} → Association name (e.g., author)
#
# Usage Example:
# Replace placeholders with actual values:
#   {{ActionName}} = CreateBlogPost
#   {{ClassName}} = BlogPost
#   {{class_name}} = blog_post
#   {{ModelName}} = User
#   {{association_name}} = author
#
# Service Object Pattern:
# - Single Responsibility: One service, one action
# - Transaction Safety: Wrap operations in ActiveRecord transaction
# - Result Object: Return Result.success or Result.failure
# - Error Handling: Catch and log errors appropriately

class {{ActionName}}Service
  # Initialize with required dependencies
  def initialize({{association_name}}, params)
    @{{association_name}} = {{association_name}}
    @params = params
  end

  # Main service execution method
  # @return [Result] Result object with success/failure and payload
  def call
    ActiveRecord::Base.transaction do
      {{class_name}} = create_{{class_name}}
      perform_additional_actions({{class_name}})
      Result.success({{class_name}})
    end
  rescue ActiveRecord::RecordInvalid => e
    Result.failure(errors: e.record.errors.full_messages)
  rescue StandardError => e
    Rails.logger.error("{{ActionName}}Service failed: #{e.message}")
    Rails.logger.error(e.backtrace.join("\n"))
    Result.failure(errors: ['An unexpected error occurred. Please try again.'])
  end

  private

  # Create the main resource
  def create_{{class_name}}
    {{class_name}} = @{{association_name}}.{{class_name}}s.build(@params)
    {{class_name}}.save!
    {{class_name}}
  end

  # Perform additional business logic
  def perform_additional_actions({{class_name}})
    send_notifications({{class_name}})
    update_related_records({{class_name}})
    track_analytics({{class_name}})
  end

  def send_notifications({{class_name}})
    {{ClassName}}Mailer.created({{class_name}}).deliver_later
  end

  def update_related_records({{class_name}})
    # Update related records if needed
    # Example: @{{association_name}}.increment!(:{{class_name}}s_count)
  end

  def track_analytics({{class_name}})
    # Track analytics event
    # Example: Analytics.track('{{class_name}}_created', {{class_name}}: {{class_name}}.id)
  end
end

# Result Object for Service Pattern
# This provides a consistent interface for service responses
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

  def self.failure(errors:)
    errors_array = errors.is_a?(Array) ? errors : [errors]
    new(success: false, errors: errors_array)
  end
end

# Controller Usage Example:
#
# class {{ClassName}}sController < ApplicationController
#   def create
#     result = {{ActionName}}Service.new(current_user, {{class_name}}_params).call
#
#     if result.success?
#       redirect_to result.value, notice: '{{ClassName}} was successfully created.'
#     else
#       @{{class_name}} = {{ClassName}}.new({{class_name}}_params)
#       @{{class_name}}.errors.add(:base, result.errors)
#       render :new, status: :unprocessable_entity
#     end
#   end
#
#   private
#
#   def {{class_name}}_params
#     params.require(:{{class_name}}).permit(:title, :body, :published)
#   end
# end
