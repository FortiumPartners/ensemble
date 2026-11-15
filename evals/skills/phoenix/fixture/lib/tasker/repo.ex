defmodule Tasker.Repo do
  use Ecto.Repo,
    otp_app: :tasker,
    adapter: Ecto.Adapters.Postgres
end
