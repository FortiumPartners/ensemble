# frozen_string_literal: true

# Small cart module.
module Cart
  # Sum of price * quantity over the items (hashes with :price and :quantity).
  def self.total(items)
    items.sum { |item| item[:price] * item[:quantity] }
  end

  # Total after a percentage discount.
  #
  # A discount above 100 percent must never make the total negative: the result is clamped at 0.
  # BUG (reported): Cart.apply_discount(100, 150) returns -50.
  def self.apply_discount(total, percent)
    total - (total * percent) / 100.0
  end
end
