defmodule TaskerWeb.StatusLiveTest do
  use TaskerWeb.ConnCase, async: true

  import Phoenix.LiveViewTest

  test "shows the status page", %{conn: conn} do
    {:ok, _view, html} = live(conn, ~p"/status")
    assert html =~ "Status"
  end

  test "counts pings", %{conn: conn} do
    {:ok, view, _html} = live(conn, ~p"/status")
    assert view |> element("button", "Ping") |> render_click() =~ "Pings: 1"
  end
end
