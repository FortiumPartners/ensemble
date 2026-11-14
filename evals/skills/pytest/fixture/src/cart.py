"""Small cart module."""


def cart_total(items):
    """Sum of price * quantity over the items (dicts with price and quantity)."""
    return sum(item["price"] * item["quantity"] for item in items)


def apply_discount(total, percent):
    """Total after a percentage discount.

    A discount above 100 percent must never make the total negative: the result is clamped at 0.
    BUG (reported): apply_discount(100, 150) returns -50.
    """
    return total - (total * percent) / 100
