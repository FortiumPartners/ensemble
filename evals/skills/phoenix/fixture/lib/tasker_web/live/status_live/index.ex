defmodule TaskerWeb.StatusLive.Index do
  use TaskerWeb, :live_view

  @impl true
  def mount(_params, _session, socket) do
    {:ok, assign(socket, page_title: "Status", clicks: 0)}
  end

  @impl true
  def handle_event("ping", _params, socket) do
    {:noreply, update(socket, :clicks, &(&1 + 1))}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <h1>Status</h1>
    <p id="clicks">Pings: {@clicks}</p>
    <button phx-click="ping">Ping</button>
    """
  end
end
