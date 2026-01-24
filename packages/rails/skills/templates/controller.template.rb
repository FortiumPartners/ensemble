# Rails Controller Template
#
# Placeholder System:
# - {{ClassName}} → PascalCase class name (e.g., BlogPost)
# - {{class_name}} → snake_case name (e.g., blog_post)
# - {{table_name}} → Plural snake_case (e.g., blog_posts)
# - {{route_path}} → URL path (e.g., blog_posts)
# - {{ModelName}} → Associated model name (e.g., User for author)
# - {{field_name}} → Field name (e.g., title)
#
# Usage Example:
# Replace placeholders with actual values:
#   {{ClassName}} = BlogPost
#   {{class_name}} = blog_post
#   {{table_name}} = blog_posts
#   {{route_path}} = blog_posts

class {{ClassName}}sController < ApplicationController
  before_action :authenticate_user!, except: %i[index show]
  before_action :set_{{class_name}}, only: %i[show edit update destroy]
  before_action :authorize_{{class_name}}!, only: %i[edit update destroy]

  # GET /{{route_path}}
  def index
    @{{table_name}} = {{ClassName}}.all.order(created_at: :desc).page(params[:page])
  end

  # GET /{{route_path}}/1
  def show
    # @{{class_name}} is set by before_action
  end

  # GET /{{route_path}}/new
  def new
    @{{class_name}} = {{ClassName}}.new
  end

  # GET /{{route_path}}/1/edit
  def edit
    # @{{class_name}} is set by before_action
  end

  # POST /{{route_path}}
  def create
    @{{class_name}} = current_user.{{table_name}}.build({{class_name}}_params)

    if @{{class_name}}.save
      redirect_to @{{class_name}}, notice: '{{ClassName}} was successfully created.'
    else
      render :new, status: :unprocessable_entity
    end
  end

  # PATCH/PUT /{{route_path}}/1
  def update
    if @{{class_name}}.update({{class_name}}_params)
      redirect_to @{{class_name}}, notice: '{{ClassName}} was successfully updated.'
    else
      render :edit, status: :unprocessable_entity
    end
  end

  # DELETE /{{route_path}}/1
  def destroy
    @{{class_name}}.destroy
    redirect_to {{table_name}}_url, notice: '{{ClassName}} was successfully deleted.'
  end

  private

  def set_{{class_name}}
    @{{class_name}} = {{ClassName}}.find(params[:id])
  end

  def authorize_{{class_name}}!
    unless @{{class_name}}.{{model_name}} == current_user || current_user.admin?
      redirect_to root_path, alert: 'You are not authorized to perform this action.'
    end
  end

  # Only allow a list of trusted parameters through.
  def {{class_name}}_params
    params.require(:{{class_name}}).permit(:{{field_name}}, :body, :published, :category_id, tag_ids: [])
  end
end
