# Corpus

> AI document intelligence — hybrid retrieval, cross-encoder reranking, streaming answers with clickable inline citations, and an eval harness that measures it.

**Stack:** Next.js 15 (App Router) · TypeScript (strict) · Tailwind · FastAPI · Postgres

---

## The problem this repository solves

**Naive RAG retrieves badly, and almost nobody measures it.**

Chunking by character count, embedding, and taking the top-k cosine matches is what most RAG demos do. It misses exact terms (part numbers, statute references, names) because vector search paraphrases, and it retrieves context-free fragments because a chunk reading *"it shall not exceed 30 days"* is meaningless without its heading path.

This pipeline chunks on document structure and prepends the heading path to the embedded text; runs vector search **and** BM25 keyword search and fuses them with Reciprocal Rank Fusion; then reranks the fused candidates with a cross-encoder before generation.

And then it *measures the difference*. `evals/` holds a golden set of question/answer pairs with known source chunks, and CI reports Recall@k, MRR, and LLM-judged faithfulness for each ablation:

| Configuration | Recall@5 | MRR | Faithfulness |
|---|---|---|---|
| vector only | _tbd_ | _tbd_ | _tbd_ |
| + hybrid (RRF) | _tbd_ | _tbd_ | _tbd_ |
| + cross-encoder rerank | _tbd_ | _tbd_ | _tbd_ |

_(Table is populated by `python -m evals.run` — numbers land here, not marketing copy.)_

---

## Architecture decisions

### Hybrid retrieval (vector + BM25) fused with RRF

Vector search misses exact tokens; keyword search misses paraphrase. Reciprocal Rank Fusion combines both rankings without needing to normalize incomparable score scales — `score(d) = Σ 1/(k + rank_r(d))`, k=60.

### Cross-encoder reranking

The single largest quality gain per line of code in the pipeline, and the step most implementations skip. Bi-encoders embed query and document independently; a cross-encoder reads them together and can therefore judge relevance properly. Applied to the top 20 fused candidates, cut to 5.

### Heading-path prefixing at chunk time

The embedded text of each chunk is prefixed with its structural ancestry (`Chapter 3 > Warranty Terms > ...`), while raw content is stored separately. This makes otherwise-unretrievable fragments retrievable.

### HNSW, not IVFFlat

No training step, better recall at this corpus size, and it does not degrade as rows are inserted.

### The model must abstain

The generation prompt requires citing `[chunk_id]` markers and explicitly instructs the model to say it does not know when retrieved context does not support an answer. A confidently wrong citation is worse than no answer.

---

## Running it

```bash
cp .env.example .env.local   # fill in the values
npm install
npm run dev
```

The API lives in `api/`:

```bash
cd api
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

Database migrations are in `supabase/migrations/`, applied in order.

---

## Project context for AI assistants

The complete specification for this project — stack, design system, data model, feature spec,
and a phase-by-phase build checklist — is committed at:

```
.claude/skills/corpus-ai-rag/SKILL.md
```

It is the single source of truth. Read it before changing anything; update its **Build State**
checklist when you finish a phase.

---

## Status

Scaffolded. See the Build State checklist in the skill file above for what is done and what is next.
