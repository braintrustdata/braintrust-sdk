---
"braintrust": patch
---

fix(pi-coding-agent,flue): Count cache reads and writes in prompt_tokens

Pi and Flue report `usage.input` without cached tokens, so LLM and prompt spans logged a `prompt_tokens` smaller than `prompt_cached_tokens` on cache-heavy calls. `prompt_tokens` now includes `prompt_cached_tokens` and `prompt_cache_creation_tokens`, as the token metric convention requires.
