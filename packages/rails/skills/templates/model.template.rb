# Rails Model Template (Active Record)
#
# Placeholder System:
# - {{ClassName}} → PascalCase class name (e.g., BlogPost)
# - {{class_name}} → snake_case name (e.g., blog_post)
# - {{table_name}} → Plural snake_case (e.g., blog_posts)
# - {{ModelName}} → Associated model name (e.g., User, Category)
# - {{association_name}} → Association name (e.g., author, comments)
# - {{field_name}} → Field name (e.g., title, body)
#
# Usage Example:
# Replace placeholders with actual values:
#   {{ClassName}} = BlogPost
#   {{class_name}} = blog_post
#   {{table_name}} = blog_posts
#   {{ModelName}} = User (for author)
#   {{association_name}} = author

class {{ClassName}} < ApplicationRecord
  # === Associations ===
  belongs_to :{{association_name}}, class_name: '{{ModelName}}', optional: false
  has_many :comments, dependent: :destroy
  has_many :taggings, dependent: :destroy
  has_many :tags, through: :taggings

  # === Validations ===
  validates :{{field_name}}, presence: true, length: { minimum: 5, maximum: 200 }
  validates :body, presence: true
  validates :{{association_name}}, presence: true

  # === Scopes ===
  scope :published, -> { where(published: true) }
  scope :recent, -> { order(created_at: :desc) }
  scope :by_{{association_name}}, ->({{association_name}}) { where({{association_name}}: {{association_name}}) }

  # === Callbacks ===
  before_save :generate_slug, if: :{{field_name}}_changed?
  after_create :notify_subscribers
  after_commit :clear_cache, on: %i[update destroy]

  # === Class Methods ===
  def self.search(query)
    where('{{field_name}} ILIKE ? OR body ILIKE ?', "%#{query}%", "%#{query}%")
  end

  def self.trending(limit = 10)
    published
      .where('created_at > ?', 7.days.ago)
      .order(views_count: :desc)
      .limit(limit)
  end

  # === Instance Methods ===
  def published?
    published && published_at.present?
  end

  def to_param
    slug.presence || id.to_s
  end

  private

  def generate_slug
    self.slug = {{field_name}}.parameterize if {{field_name}}.present?
  end

  def notify_subscribers
    Notify{{ClassName}}SubscribersJob.perform_later(id)
  end

  def clear_cache
    Rails.cache.delete([self.class.name, id])
  end
end
