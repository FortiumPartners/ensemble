defmodule {{AppName}}.{{ContextName}} do
  @moduledoc """
  The {{ContextName}} context - manages {{entity-display-name-plural}}.
  """

  import Ecto.Query, warn: false
  alias {{AppName}}.Repo
  alias {{AppName}}.{{ContextName}}.{{EntityName}}

  @doc """
  Returns the list of {{entity-name-plural}}.

  ## Examples

      iex> list_{{entity-name-plural}}()
      [%{{EntityName}}{}, ...]

  """
  def list_{{entity-name-plural}} do
    Repo.all({{EntityName}})
  end

  @doc """
  Returns the list of {{entity-name-plural}} with pagination.

  ## Examples

      iex> list_{{entity-name-plural}}_paginated(1, 20)
      [%{{EntityName}}{}, ...]

  """
  def list_{{entity-name-plural}}_paginated(page, per_page \\\\ 20) do
    from(e in {{EntityName}},
      order_by: [desc: e.inserted_at],
      limit: ^per_page,
      offset: ^((page - 1) * per_page)
    )
    |> Repo.all()
  end

  @doc """
  Gets a single {{entity-name}}.

  Raises `Ecto.NoResultsError` if the {{EntityName}} does not exist.

  ## Examples

      iex> get_{{entity-name}}!(123)
      %{{EntityName}}{}

      iex> get_{{entity-name}}!(456)
      ** (Ecto.NoResultsError)

  """
  def get_{{entity-name}}!(id), do: Repo.get!({{EntityName}}, id)

  @doc """
  Gets a single {{entity-name}}.

  Returns `nil` if the {{EntityName}} does not exist.

  ## Examples

      iex> get_{{entity-name}}(123)
      %{{EntityName}}{}

      iex> get_{{entity-name}}(456)
      nil

  """
  def get_{{entity-name}}(id), do: Repo.get({{EntityName}}, id)

  @doc """
  Creates a {{entity-name}}.

  ## Examples

      iex> create_{{entity-name}}(%{field: value})
      {:ok, %{{EntityName}}{}}

      iex> create_{{entity-name}}(%{field: bad_value})
      {:error, %Ecto.Changeset{}}

  """
  def create_{{entity-name}}(attrs \\\\ %{}) do
    %{{EntityName}}{}
    |> {{EntityName}}.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Updates a {{entity-name}}.

  ## Examples

      iex> update_{{entity-name}}({{entity-name}}, %{field: new_value})
      {:ok, %{{EntityName}}{}}

      iex> update_{{entity-name}}({{entity-name}}, %{field: bad_value})
      {:error, %Ecto.Changeset{}}

  """
  def update_{{entity-name}}(%{{EntityName}}{} = {{entity-name}}, attrs) do
    {{entity-name}}
    |> {{EntityName}}.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a {{entity-name}}.

  ## Examples

      iex> delete_{{entity-name}}({{entity-name}})
      {:ok, %{{EntityName}}{}}

      iex> delete_{{entity-name}}({{entity-name}})
      {:error, %Ecto.Changeset{}}

  """
  def delete_{{entity-name}}(%{{EntityName}}{} = {{entity-name}}) do
    Repo.delete({{entity-name}})
  end

  @doc """
  Returns an `%Ecto.Changeset{}` for tracking {{entity-name}} changes.

  ## Examples

      iex> change_{{entity-name}}({{entity-name}})
      %Ecto.Changeset{data: %{{EntityName}}{}}

  """
  def change_{{entity-name}}(%{{EntityName}}{} = {{entity-name}}, attrs \\\\ %{}) do
    {{EntityName}}.changeset({{entity-name}}, attrs)
  end
end
