defmodule Tasker.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    children = [
      Tasker.Repo,
      {Phoenix.PubSub, name: Tasker.PubSub},
      TaskerWeb.Endpoint
    ]

    Supervisor.start_link(children, strategy: :one_for_one, name: Tasker.Supervisor)
  end
end
