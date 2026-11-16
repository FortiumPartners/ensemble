"""The one place that asks the language model."""


def complete(model: str, prompt: str) -> str:
    """Return the model's text answer to a prompt (wired to the provider in production)."""
    raise NotImplementedError("the provider client is wired in at deploy time")
