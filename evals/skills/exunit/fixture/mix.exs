defmodule Cart.MixProject do
  use Mix.Project

  def project do
    [app: :cart, version: "0.1.0", elixir: "~> 1.15", deps: []]
  end

  def application do
    [extra_applications: [:logger]]
  end
end
