"""
embedding.py
─────────────────────────────────────────────────────────────────────────────
Embeds the user's question at request time.

The query vector MUST come from the same provider and model that produced the
corpus — vectors from different models are not comparable — so the provider is
read from the corpus metadata rather than configured independently.

Voyage distinguishes corpus text from search text via `input_type`; the corpus
was built with "document", so queries use "query".
─────────────────────────────────────────────────────────────────────────────
"""

import httpx

import config

VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
REQUEST_TIMEOUT = 20.0


class EmbeddingError(RuntimeError):
    """The question could not be embedded, so retrieval cannot proceed."""


def embed_query(text, provider, model, dimensions):
    if provider == "voyage":
        return _embed_voyage(text, model, dimensions)
    if provider == "openai":
        return _embed_openai(text, model, dimensions)
    raise EmbeddingError(f"unsupported embedding provider: {provider}")


def _embed_voyage(text, model, dimensions):
    if not config.VOYAGE_API_KEY:
        raise EmbeddingError("VOYAGE_API_KEY is not configured")
    try:
        response = httpx.post(
            VOYAGE_URL,
            headers={"Authorization": f"Bearer {config.VOYAGE_API_KEY}"},
            json={
                "input": [text],
                "model": model,
                "input_type": "query",
                "output_dimension": dimensions,
            },
            timeout=REQUEST_TIMEOUT,
        )
    except httpx.HTTPError as exc:
        raise EmbeddingError(f"embedding request failed: {exc}") from exc

    if response.status_code != 200:
        raise EmbeddingError(
            f"embedding provider returned {response.status_code}: "
            f"{response.text[:160]}"
        )
    try:
        return response.json()["data"][0]["embedding"]
    except (KeyError, IndexError, ValueError) as exc:
        raise EmbeddingError("malformed embedding response") from exc


def _embed_openai(text, model, dimensions):
    if not config.OPENAI_API_KEY:
        raise EmbeddingError("OPENAI_API_KEY is not configured")
    try:
        from openai import OpenAI

        client = OpenAI(api_key=config.OPENAI_API_KEY)
        result = client.embeddings.create(
            model=model, input=[text], dimensions=dimensions
        )
        return result.data[0].embedding
    except Exception as exc:  # SDK raises a wide range of transport errors
        raise EmbeddingError(f"embedding request failed: {exc}") from exc
