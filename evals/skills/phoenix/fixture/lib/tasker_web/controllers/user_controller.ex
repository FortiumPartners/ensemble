defmodule TaskerWeb.UserController do
  use TaskerWeb, :controller

  alias Tasker.Accounts

  def index(conn, _params) do
    users = Accounts.list_users()
    json(conn, %{data: Enum.map(users, &%{id: &1.id, email: &1.email, name: &1.name})})
  end
end
