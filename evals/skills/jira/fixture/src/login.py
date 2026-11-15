"""Sign-in for the harbor-pilots portal."""

TIMEOUT_SECONDS = 30


def sign_in(user, password, connect):
    """Return a session for the user, or None when the connection gives up."""
    session = connect(user, password, timeout=TIMEOUT_SECONDS)
    return session
