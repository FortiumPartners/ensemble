defmodule Cart do
  @moduledoc "Small cart module."

  @doc "Sum of price * quantity over the items (maps with :price and :quantity)."
  def cart_total(items) do
    Enum.reduce(items, 0, fn item, acc -> acc + item.price * item.quantity end)
  end

  @doc """
  Total after a percentage discount.
  A discount above 100 percent must never make the total negative: the result is clamped at 0.
  BUG (reported): apply_discount(100, 150) returns -50.
  """
  def apply_discount(total, percent) do
    total - total * percent / 100
  end
end
