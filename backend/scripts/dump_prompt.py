"""
dump_prompt.py
─────────────────────────────────────────────────────────────────────────────
Prints the exact system prompt and user prompt the backend would send, without
calling any paid API.

Why this exists: stub mode proves the pipeline works but says nothing about how
a real model behaves with this prompt. The two things worth checking most —
whether answers read well, and whether the content guardrails actually stop the
model from inventing classical text it was never given — need a real model but
not necessarily an API key. Paste the output into claude.ai (or any chat
interface) and read what comes back.

The embedding step needs a Voyage key, since retrieval is what selects the
passages. With --no-retrieval it falls back to using the hexagram's own
judgment vector as the query, which needs no network call at all.

Usage:
    python scripts/dump_prompt.py --hexagram 49 --lines 4 --transformed 17 \
        --question "这个卦对我换工作意味着什么？"

    python scripts/dump_prompt.py --hexagram 2 --lines 3 \
        --question "What should I focus on?" --lang en --no-retrieval

What to look for in the reply:
  • Does it quote 卦辞/爻辞 for a hexagram whose passages are marked
    quotable="no"? That would be the guardrail failing — the interesting
    negative result. Hexagrams 16–64 are the ones to probe.
  • Does it answer in the language the question was asked in?
  • Is the length and register right, or does the system prompt need tuning?
─────────────────────────────────────────────────────────────────────────────
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config        # noqa: E402
import oracle        # noqa: E402
import retrieval     # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hexagram", type=int, required=True,
                        help="hexagram number, 1-64")
    parser.add_argument("--lines", type=int, nargs="*", default=[],
                        help="changing line positions, 1-6")
    parser.add_argument("--transformed", type=int, default=None,
                        help="transformed hexagram number, if any")
    parser.add_argument("--question", required=True)
    parser.add_argument("--lang", choices=["zh", "en"], default="zh")
    parser.add_argument("--no-retrieval", action="store_true",
                        help="skip the Voyage call; use the hexagram's own "
                             "judgment vector as the query instead")
    args = parser.parse_args()

    if not 1 <= args.hexagram <= 64:
        sys.exit("--hexagram must be between 1 and 64")

    corpus = retrieval.Corpus(config.EMBEDDINGS_PATH)

    if args.no_retrieval:
        anchor = corpus.get(args.hexagram, "judgment")
        if anchor is None:
            sys.exit(f"hexagram {args.hexagram} not found in the corpus")
        query_vector = anchor["embedding"]
        note = ("retrieval used the hexagram's own judgment vector "
                "(--no-retrieval), not the question")
    else:
        import embedding
        try:
            query_vector = embedding.embed_query(
                args.question, corpus.provider, corpus.model, corpus.dimensions,
            )
        except embedding.EmbeddingError as exc:
            sys.exit(f"could not embed the question: {exc}\n"
                     f"Set VOYAGE_API_KEY in .env, or pass --no-retrieval.")
        note = f"retrieval used the question, embedded with {corpus.model}"

    mandatory, supplementary = retrieval.build_context(
        corpus,
        hexagram_id=args.hexagram,
        changing_lines=args.lines,
        transformed_hexagram_id=args.transformed,
        query_vector=query_vector,
        top_k=config.TOP_K,
    )
    if not mandatory:
        sys.exit(f"hexagram {args.hexagram} produced no context — is the "
                 f"corpus complete?")

    prompt = oracle.build_prompt(
        mandatory, supplementary, args.question,
        hexagram_id=args.hexagram, transformed_id=args.transformed,
        lang=args.lang,
    )

    quotable = sum(1 for _, c in list(mandatory) + list(supplementary)
                   if c["has_classical"])
    total = len(mandatory) + len(supplementary)

    bar = "=" * 74
    print(bar)
    print("SYSTEM PROMPT — paste this first, or as a custom instruction")
    print(bar)
    print(oracle.SYSTEM_PROMPT)
    print()
    print(bar)
    print("USER PROMPT — paste this as the message")
    print(bar)
    print(prompt)
    print()
    print(bar)
    print(f"{total} passages: {quotable} with real source text "
          f"(quotable=yes), {total - quotable} interpretation-only "
          f"(quotable=no)")
    print(note)
    if total - quotable:
        print()
        print("Check the reply against the quotable=\"no\" passages: if it "
              "presents any classical text as the original for those, the "
              "guardrail needs strengthening.")
    print(bar)


if __name__ == "__main__":
    main()
