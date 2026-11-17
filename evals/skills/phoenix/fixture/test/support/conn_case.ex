defmodule TaskerWeb.ConnCase do
  use ExUnit.CaseTemplate

  using do
    quote do
      @endpoint TaskerWeb.Endpoint

      import Plug.Conn
      import Phoenix.ConnTest
      use Phoenix.VerifiedRoutes, endpoint: TaskerWeb.Endpoint, router: TaskerWeb.Router
    end
  end

  setup tags do
    pid = Ecto.Adapters.SQL.Sandbox.start_owner!(Tasker.Repo, shared: not tags[:async])
    on_exit(fn -> Ecto.Adapters.SQL.Sandbox.stop_owner(pid) end)
    {:ok, conn: Phoenix.ConnTest.build_conn()}
  end
end
