"""Replies to customers."""

SENT = []


def send_reply(customer_id: str, text: str) -> None:
    """Send an email reply to a customer."""
    SENT.append((customer_id, text))
