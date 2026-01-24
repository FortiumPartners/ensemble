# Rails Migration Template
#
# Placeholder System:
# - {{ClassName}} → PascalCase class name (e.g., BlogPost)
# - {{class_name}} → snake_case name (e.g., blog_post)
# - {{table_name}} → Plural snake_case (e.g., blog_posts)
# - {{timestamp}} → Migration timestamp (e.g., 20251022120000)
# - {{ModelName}} → Associated model reference (e.g., User)
# - {{reference_table}} → Reference table name (e.g., users)
# - {{field_name}} → Field name (e.g., title)
# - {{field_type}} → Field type (e.g., string, text, integer, boolean)
#
# Usage Example:
# Replace placeholders with actual values:
#   {{timestamp}} = 20251022120000
#   {{ClassName}} = BlogPost
#   {{table_name}} = blog_posts
#   {{field_name}} = title
#   {{field_type}} = string
#
# Migration Types:
# 1. Create Table
# 2. Add Column
# 3. Add Index
# 4. Add Foreign Key

# ==========================================
# CREATE TABLE MIGRATION
# ==========================================
class Create{{ClassName}}s < ActiveRecord::Migration[7.0]
  def change
    create_table :{{table_name}} do |t|
      # Basic fields
      t.{{field_type}} :{{field_name}}, null: false
      t.text :body, null: false
      t.boolean :published, default: false, null: false

      # Foreign key references
      t.references :{{reference_table}}, null: false, foreign_key: true, index: true

      # Unique fields
      t.string :slug, index: { unique: true }

      # Timestamps (created_at, updated_at)
      t.timestamps
    end

    # Additional indexes
    add_index :{{table_name}}, :published
    add_index :{{table_name}}, [:{{reference_table}}_id, :created_at]
    add_index :{{table_name}}, :{{field_name}}
  end
end

# ==========================================
# ADD COLUMN MIGRATION
# ==========================================
class Add{{FieldName}}To{{ClassName}}s < ActiveRecord::Migration[7.0]
  def change
    add_column :{{table_name}}, :{{field_name}}, :{{field_type}}, null: false, default: ''
  end
end

# ==========================================
# ADD REFERENCE MIGRATION
# ==========================================
class Add{{ModelName}}RefTo{{ClassName}}s < ActiveRecord::Migration[7.0]
  def change
    add_reference :{{table_name}}, :{{reference_table}}, foreign_key: true, index: true
  end
end

# ==========================================
# ADD INDEX MIGRATION
# ==========================================
class AddIndexTo{{ClassName}}s{{FieldName}} < ActiveRecord::Migration[7.0]
  def change
    add_index :{{table_name}}, :{{field_name}}
  end
end

# ==========================================
# COMPOUND INDEX MIGRATION
# ==========================================
class AddCompoundIndexTo{{ClassName}}s < ActiveRecord::Migration[7.0]
  def change
    add_index :{{table_name}}, [:{{reference_table}}_id, :created_at], name: 'index_{{table_name}}_on_{{reference_table}}_and_date'
  end
end

# ==========================================
# REMOVE COLUMN MIGRATION (with rollback)
# ==========================================
class Remove{{FieldName}}From{{ClassName}}s < ActiveRecord::Migration[7.0]
  def up
    remove_column :{{table_name}}, :{{field_name}}
  end

  def down
    add_column :{{table_name}}, :{{field_name}}, :{{field_type}}
  end
end

# ==========================================
# CHANGE COLUMN MIGRATION (with rollback)
# ==========================================
class Change{{FieldName}}TypeIn{{ClassName}}s < ActiveRecord::Migration[7.0]
  def up
    change_column :{{table_name}}, :{{field_name}}, :text
  end

  def down
    change_column :{{table_name}}, :{{field_name}}, :string
  end
end

# ==========================================
# RENAME COLUMN MIGRATION
# ==========================================
class Rename{{OldFieldName}}To{{NewFieldName}}In{{ClassName}}s < ActiveRecord::Migration[7.0]
  def change
    rename_column :{{table_name}}, :{{old_field_name}}, :{{new_field_name}}
  end
end

# ==========================================
# ADD NOT NULL CONSTRAINT (safe with default)
# ==========================================
class AddNotNullTo{{ClassName}}s{{FieldName}} < ActiveRecord::Migration[7.0]
  def change
    # First, set default value for existing records
    change_column_default :{{table_name}}, :{{field_name}}, from: nil, to: ''

    # Update existing NULL values
    reversible do |dir|
      dir.up do
        {{ClassName}}.where({{field_name}}: nil).update_all({{field_name}}: '')
      end
    end

    # Add NOT NULL constraint
    change_column_null :{{table_name}}, :{{field_name}}, false
  end
end

# ==========================================
# CREATE JOIN TABLE (many-to-many)
# ==========================================
class CreateJoinTable{{ClassName}}s{{OtherClassName}}s < ActiveRecord::Migration[7.0]
  def change
    create_join_table :{{table_name}}, :{{other_table_name}} do |t|
      t.index [:{{class_name}}_id, :{{other_class_name}}_id], name: 'index_{{table_name}}_{{other_table_name}}'
      t.index [:{{other_class_name}}_id, :{{class_name}}_id], name: 'index_{{other_table_name}}_{{table_name}}'

      # Optional: Add timestamps to join table
      # t.timestamps
    end
  end
end

# ==========================================
# DATA MIGRATION (with transaction safety)
# ==========================================
class Migrate{{ClassName}}Data < ActiveRecord::Migration[7.0]
  def up
    say_with_time "Migrating {{ClassName}} data" do
      {{ClassName}}.find_each do |record|
        # Perform data transformation
        record.update_column(:new_field, transform_value(record.old_field))
      end
    end
  end

  def down
    say_with_time "Reverting {{ClassName}} data migration" do
      {{ClassName}}.find_each do |record|
        # Revert data transformation
        record.update_column(:old_field, revert_value(record.new_field))
      end
    end
  end

  private

  def transform_value(value)
    # Transformation logic
    value.to_s.upcase
  end

  def revert_value(value)
    # Revert logic
    value.to_s.downcase
  end
end

# ==========================================
# ADD FULL-TEXT SEARCH (PostgreSQL)
# ==========================================
class AddFullTextSearchTo{{ClassName}}s < ActiveRecord::Migration[7.0]
  def up
    # Add tsvector column
    add_column :{{table_name}}, :search_vector, :tsvector

    # Add GIN index for fast full-text search
    execute <<-SQL
      CREATE INDEX {{table_name}}_search_vector_idx
      ON {{table_name}}
      USING gin(search_vector)
    SQL

    # Add trigger to automatically update search_vector
    execute <<-SQL
      CREATE TRIGGER {{table_name}}_search_vector_update
      BEFORE INSERT OR UPDATE ON {{table_name}}
      FOR EACH ROW EXECUTE FUNCTION
      tsvector_update_trigger(
        search_vector, 'pg_catalog.english', {{field_name}}, body
      )
    SQL

    # Populate existing records
    execute <<-SQL
      UPDATE {{table_name}}
      SET search_vector = to_tsvector('english',
        COALESCE({{field_name}}, '') || ' ' || COALESCE(body, '')
      )
    SQL
  end

  def down
    execute "DROP TRIGGER IF EXISTS {{table_name}}_search_vector_update ON {{table_name}}"
    remove_index :{{table_name}}, name: :{{table_name}}_search_vector_idx
    remove_column :{{table_name}}, :search_vector
  end
end

# ==========================================
# BEST PRACTICES
# ==========================================
#
# 1. Always make migrations reversible (define both up and down)
# 2. Use change when possible (Rails auto-reverses most operations)
# 3. Add indexes for foreign keys and frequently queried columns
# 4. Use null: false with default values to prevent NULL issues
# 5. Batch updates for large datasets (find_each instead of all)
# 6. Test migrations on a copy of production data before deploying
# 7. Keep migrations idempotent when possible
# 8. Use transactions for data migrations (automatic with change/up/down)
# 9. Add timestamps to all tables for auditing
# 10. Document complex migrations with comments
