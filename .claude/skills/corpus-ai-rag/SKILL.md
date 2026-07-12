---
name: corpus-ai-rag
description: Full project context for Corpus — an AI document intelligence platform (Next.js 15 + FastAPI + Postgres/pgvector + Claude API) with chunking, hybrid retrieval, streaming answers, inline citations, and an evaluation harness. Use this skill whenever working on Corpus in any way — the ingestion pipeline, chunking strategy, embeddings, hybrid search (vector + BM25) and reranking, the streaming chat UI, citation highlighting in the PDF viewer, prompt construction, or the eval suite. Trigger this even when the user doesn't say "Corpus" explicitly — any mention of the RAG project, the document Q&A app, pgvector, chunking or retrieval or reranking, the "Corpus" design system, or Document/Chunk/Citation/Conversation entities qualifies. Read this before generating any Corpus code so the retrieval architecture, colors, and type stay consistent, and update the Build State checklist at the end of every session.
---

# Corpus — AI Document Intelligence

**Portfolio thesis:** everyone has a ChatGPT wrapper on their resume. Almost nobody has a RAG system with an **eval harness** that measures retrieval quality. Shipping the evals is what separates "I called an API" from "I do AI engineering." This project is also directly reusable as content for the YouTube channel.

**One-liner:** *Ask questions across a document library and get answers with inline, clickable citations — hybrid retrieval (vector + keyword), a cross-encoder reranker, and a measured eval suite proving retrieval quality.*

---

## Stack

- **Frontend:** Next.js 15 (App Router), TypeScript strict, Tailwind, shadcn/ui
- **Backend:** FastAPI (Python) — this is where the ML work lives, and it shows Python range alongside the TS work
- **DB:** Postgres + `pgvector` (Supabase). `tsvector` column for keyword search
- **Embeddings:** `text-embedding-3-small` (1536d) — cheap, strong, fine
- **Generation:** Claude API, streaming
- **Reranking:** `bge-reranker-base` via a cross-encoder, or Cohere Rerank if a hosted call is preferred
- **Parsing:** `unstructured` or `pymupdf` for PDF; keep page numbers and bounding boxes
- **Queue:** background ingestion via FastAPI BackgroundTasks (upgrade to Celery/Redis only if it becomes the bottleneck)
- **Deploy:** Vercel (web) + Railway/Fly (API) + Supabase (DB)

## Design system — "Corpus"

Scholarly. Warm paper, serif display, restrained. Should feel like a research tool, not a chatbot toy.

| Token | Hex | Use |
|---|---|---|
| `parchment` | `#F6F3EC` | app background |
| `sheet` | `#FFFDF9` | document surface, cards |
| `ink` | `#14110E` | primary text |
| `sepia` | `#6B5A45` | secondary text, metadata |
| `rule` | `#E0D9CB` | borders |
| `oxide` | `#B5462F` | citation markers, highlights |
| `indigo` | `#2C3E7A` | links, primary action |
| `moss` | `#4A7A52` | indexed / ready state |

**Type:** `Newsreader` (headings, answer text — serif, it reads as authoritative) · `Public Sans` (UI chrome) · `IBM Plex Mono` (chunk IDs, scores, metadata)
**Rules:** generous line-height (`1.7`) on answer text — people actually read it. Citation markers render as superscript `[1]` in `oxide`; hovering previews the source chunk; clicking scrolls the PDF pane to the exact page and paints the bounding box in `oxide` at 20% opacity. No gradients.

---

## Data model

```
Collection ──< Document ──< Chunk
                              │
Conversation ──< Message ──< Citation ──> Chunk
```

- `collections` — id, name, owner_id
- `documents` — collection_id, filename, storage_path, page_count, status (`pending`|`parsing`|`embedding`|`ready`|`failed`), error
- `chunks` — document_id, content, embedding `vector(1536)`, tsv `tsvector`, page_number, bbox (jsonb), token_count, chunk_index, heading_path (text[])
- `conversations` — collection_id, title
- `messages` — conversation_id, role, content, created_at
- `citations` — message_id, chunk_id, span_start, span_end

**Indexes that matter:**
```sql
create index on chunks using hnsw (embedding vector_cosine_ops);
create index on chunks using gin (tsv);
```
Use HNSW, not IVFFlat — no training step, better recall at these sizes.

---

## Retrieval pipeline

The whole project's credibility lives here. Naive RAG (chunk by 500 chars, top-k cosine, stuff into prompt) is what everyone else does and it retrieves badly. Do this instead:

**1. Chunking — structure-aware, not character-count**
Split on document structure (headings, sections), target ~500 tokens with ~15% overlap, and **prepend the heading path** to each chunk's embedded text (`"Chapter 3 > Warranty Terms > ..."`). A chunk that says "It shall not exceed 30 days" is meaningless in isolation; with its heading path it's retrievable. Store the raw content separately from the embedded text.

**2. Hybrid search — vector AND keyword**
Vector search misses exact terms (part numbers, names, statute references). BM25/`tsvector` misses paraphrase. Run both, fuse with **Reciprocal Rank Fusion**:

```
score(d) = Σ over rankers  1 / (k + rank_r(d))     // k = 60
```

Retrieve top 20 from each, fuse, take top 20.

**3. Rerank**
Cross-encoder over the 20 fused candidates → keep top 5. This is the single biggest quality jump per line of code, and it's the step nobody does.

**4. Generate**
Pass the 5 chunks with explicit IDs. Prompt Claude to cite with `[chunk_id]` markers and — critically — **to say it doesn't know when the context doesn't support an answer.** Parse the markers out of the stream and map them to `citations` rows.

**5. Stream**
Server-Sent Events from FastAPI → Next.js. Render tokens as they arrive; resolve citation markers into interactive footnotes on completion.

---

## The eval harness (do not skip — this is the differentiator)

Build a golden set of ~50 question/answer pairs over the demo corpus with known correct source chunks. Then measure:

| Metric | What it catches |
|---|---|
| **Recall@k** | did the correct chunk make it into the retrieved set at all? |
| **MRR** | how high did it rank? |
| **Faithfulness** | is every claim in the answer supported by a retrieved chunk? (LLM-judged) |
| **Answer relevance** | does it actually answer the question? (LLM-judged) |

Run it in CI. Put the results table in the README with an **ablation**: naive vector-only vs. +hybrid vs. +rerank. Showing that reranking took Recall@5 from, say, 0.71 → 0.89 is a more compelling portfolio artifact than any screenshot, and it's a ready-made YouTube video.

---

## Routes

```
/                              landing
/collections                   list
/collections/[id]              document grid + upload + ingestion status
/collections/[id]/chat         split view: chat left, PDF viewer right
/collections/[id]/doc/[docId]  standalone document reader
/evals                         public eval dashboard (yes, ship this — it's the flex)

API (FastAPI)
POST /ingest                   upload → parse → chunk → embed (background)
GET  /documents/{id}/status    poll ingestion
POST /query                    SSE stream: retrieve → rerank → generate
GET  /chunks/{id}              citation hover preview
```

---

## Conventions

- Python: `ruff` + `mypy`, Pydantic models at every boundary.
- Retrieval params (`k`, RRF `k`, rerank cutoff, chunk size) live in one `RetrievalConfig` — the eval harness sweeps them, so they must never be hardcoded inline.
- Never let the model answer from parametric knowledge. If context is empty, say so.
- Commit directly to `main` unless told otherwise.

---

## Build state

Update this every session. Fresh sessions read this first to know where to resume.

**Phase 1 — Ingestion**
- [ ] FastAPI scaffold; Supabase + pgvector extension; schema + HNSW/GIN indexes
- [ ] PDF parse (pymupdf) preserving page numbers + bounding boxes
- [ ] Structure-aware chunker with heading-path prefixing
- [ ] Embedding + batch insert; document status state machine
- [ ] Next.js upload UI with live ingestion progress

**Phase 2 — Retrieval**
- [ ] Vector search (cosine, HNSW)
- [ ] Keyword search (`tsvector` + BM25 ranking)
- [ ] Reciprocal Rank Fusion
- [ ] Cross-encoder rerank
- [ ] `RetrievalConfig` object — every knob configurable

**Phase 3 — Answering**
- [ ] Prompt template with cite-or-abstain instruction
- [ ] SSE streaming endpoint
- [ ] Chat UI: streaming render, message history
- [ ] Citation parsing → `citations` rows
- [ ] PDF viewer pane; click citation → scroll to page + paint bbox

**Phase 4 — Evals & proof**
- [ ] Golden set: ~50 Q/A pairs with known source chunks
- [ ] Recall@k + MRR scripts
- [ ] LLM-judge faithfulness + relevance
- [ ] Ablation table: vector-only → +hybrid → +rerank
- [ ] `/evals` public dashboard
- [ ] CI: eval suite on every push to retrieval code
- [ ] README with the ablation table front and center
- [ ] Deploy + seed a public demo collection

## What Patrick needs to provide

- Anthropic API key; OpenAI key (embeddings) or a local embedding choice
- Cohere key **only** if using hosted rerank instead of a local cross-encoder
- Supabase project with `pgvector` enabled
- **A demo corpus** — pick something with genuine domain weight, not lorem PDFs. Strong options: Nigerian tax/regulatory filings, marine engine service manuals (dovetails with Drydock), or a set of IFS course materials. Domain-specific corpora make the citations visibly impressive.
