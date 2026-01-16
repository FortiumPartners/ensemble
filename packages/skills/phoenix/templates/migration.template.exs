defmodule {{AppName}}.Repo.Migrations.Create{{EntityNamePlural}} do
  use Ecto.Migration

  def change do
    create table(:{{table-name}}) do
      add :{{field-name}}, :{{field-type}}, null: false
      # Add more fields
      # add :name, :string, null: false
      # add :email, :string
      # add :age, :integer
      # add :active, :boolean, default: true, null: false
      # add :metadata, :map, default: %{}
      # add :description, :text

      # Foreign keys
      # add :user_id, references(:users, on_delete: :delete_all), null: false

      timestamps()
    end

    # Indexes
    create index(:{{table-name}}, [:{{field-name}}])
    # create unique_index(:{{table-name}}, [:email])
    # create index(:{{table-name}}, [:user_id])
    # create index(:{{table-name}}, [:inserted_at])

    # Composite indexes
    # create index(:{{table-name}}, [:user_id, :created_at])

    # Full-text search (PostgreSQL)
    # execute """
    # CREATE INDEX {{table-name}}_search_idx ON {{table-name}}
    # USING GIN (to_tsvector('english', {{field-name}}))
    # """
  end
end
