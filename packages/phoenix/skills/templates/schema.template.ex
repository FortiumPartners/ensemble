defmodule {{AppName}}.{{ContextName}}.{{EntityName}} do
  use Ecto.Schema
  import Ecto.Changeset

  @type t :: %__MODULE__{
          id: integer(),
          {{field-name}}: {{field-type}},
          inserted_at: DateTime.t(),
          updated_at: DateTime.t()
        }

  schema "{{table-name}}" do
    field :{{field-name}}, :{{field-type}}
    # Add more fields here
    # field :name, :string
    # field :email, :string
    # field :age, :integer
    # field :active, :boolean, default: true
    # field :metadata, :map

    # Associations
    # belongs_to :user, {{AppName}}.Accounts.User
    # has_many :comments, {{AppName}}.Blog.Comment
    # many_to_many :tags, {{AppName}}.Blog.Tag, join_through: "{{table-name}}_tags"

    timestamps()
  end

  @doc """
  Changeset for creating or updating a {{entity-name}}.

  ## Examples

      iex> changeset(%{{EntityName}}{}, %{{{field-name}}: "value"})
      %Ecto.Changeset{}

  """
  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset({{entity-name}}, attrs) do
    {{entity-name}}
    |> cast(attrs, [:{{field-name}}])
    |> validate_required([:{{field-name}}])
    |> validate_length(:{{field-name}}, min: 1, max: 255)
    # Add more validations
    # |> validate_format(:email, ~r/@/)
    # |> validate_number(:age, greater_than: 0)
    # |> unique_constraint(:email)
    # |> foreign_key_constraint(:user_id)
  end

  @doc """
  Changeset for updating only specific fields.

  ## Examples

      iex> update_changeset(%{{EntityName}}{}, %{{{field-name}}: "new_value"})
      %Ecto.Changeset{}

  """
  @spec update_changeset(t(), map()) :: Ecto.Changeset.t()
  def update_changeset({{entity-name}}, attrs) do
    {{entity-name}}
    |> cast(attrs, [:{{field-name}}])
    |> validate_required([:{{field-name}}])
    |> validate_length(:{{field-name}}, min: 1, max: 255)
  end
end
