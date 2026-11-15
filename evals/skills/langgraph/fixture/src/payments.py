"""Refunds against the payment provider."""

REFUNDS = []


def issue_refund(order_id: str, amount: float) -> str:
    """Pay the amount back for an order and return the refund id. Calling it twice pays twice."""
    REFUNDS.append((order_id, amount))
    return f"refund-{order_id}"
