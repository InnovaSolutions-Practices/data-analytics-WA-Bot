-- Replaces the knowledge_base keyword-search RAG with pgvector similarity search.
-- knowledge_base itself is left in place (not dropped) in case anything else still
-- reads it; the application code simply stops querying it once this ships.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.rag_documents (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1536) NOT NULL, -- text-embedding-3-small output size
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, chunk_index)
);

-- HNSW is the current pgvector-recommended index for cosine similarity search
-- (no ANALYZE/lists tuning required, unlike ivfflat).
CREATE INDEX IF NOT EXISTS rag_documents_embedding_idx
  ON public.rag_documents
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS rag_documents_source_idx
  ON public.rag_documents (source);

-- Similarity search RPC, called from the Worker via supabase-js `.rpc(...)`.
-- Returns rows with cosine similarity >= match_threshold, closest first.
CREATE OR REPLACE FUNCTION public.match_rag_documents(
  query_embedding VECTOR(1536),
  match_count INT DEFAULT 5,
  match_threshold FLOAT DEFAULT 0.75
)
RETURNS TABLE (
  id BIGINT,
  source TEXT,
  chunk_index INT,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    rag_documents.id,
    rag_documents.source,
    rag_documents.chunk_index,
    rag_documents.content,
    rag_documents.metadata,
    1 - (rag_documents.embedding <=> query_embedding) AS similarity
  FROM public.rag_documents
  WHERE 1 - (rag_documents.embedding <=> query_embedding) >= match_threshold
  ORDER BY rag_documents.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_rag_documents(VECTOR(1536), INT, FLOAT) TO service_role;
GRANT ALL ON public.rag_documents TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.rag_documents_id_seq TO service_role;
