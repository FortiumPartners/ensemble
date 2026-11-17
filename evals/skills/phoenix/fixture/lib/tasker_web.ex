defmodule TaskerWeb do
  @moduledoc "Entrypoint for the web interface: `use TaskerWeb, :controller` and friends."

  def controller do
    quote do
      use Phoenix.Controller, formats: [:html, :json]
      import Plug.Conn
    end
  end

  def live_view do
    quote do
      use Phoenix.LiveView
      use Phoenix.VerifiedRoutes, endpoint: TaskerWeb.Endpoint, router: TaskerWeb.Router
    end
  end

  def router do
    quote do
      use Phoenix.Router
      import Plug.Conn
      import Phoenix.Controller
      import Phoenix.LiveView.Router
    end
  end

  defmacro __using__(which) when is_atom(which) do
    apply(__MODULE__, which, [])
  end
end
