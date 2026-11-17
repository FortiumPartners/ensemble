defmodule TaskerWeb.Router do
  use TaskerWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :protect_from_forgery
  end

  scope "/", TaskerWeb do
    pipe_through :browser

    get "/users", UserController, :index
    live "/status", StatusLive.Index, :index
  end
end
