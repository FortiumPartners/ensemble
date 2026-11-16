defmodule Tasker.Accounts do
  @moduledoc "Accounts context: the only module that talks to the database about users."

  alias Tasker.Accounts.User
  alias Tasker.Repo

  def list_users, do: Repo.all(User)

  def get_user!(id), do: Repo.get!(User, id)

  def register_user(attrs) do
    %User{}
    |> User.changeset(attrs)
    |> Repo.insert()
  end
end
