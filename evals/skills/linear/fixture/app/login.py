"""Sign-in handler for the harbor-pilots portal."""

SESSION_TIMEOUT_SECONDS = 30


def sign_in(user, password, backend):
    """Ask the auth backend for a session; give up after SESSION_TIMEOUT_SECONDS."""
    return backend.authenticate(user, password, timeout=SESSION_TIMEOUT_SECONDS)
