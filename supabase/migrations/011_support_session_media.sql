-- Media snapshots attached to a support session before a ticket is created.

CREATE TABLE IF NOT EXISTS public.support_session_media (
  id BIGSERIAL PRIMARY KEY,
  support_session_id BIGINT NOT NULL REFERENCES public.support_sessions(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  image_url TEXT,
  mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_session_media_session_id
  ON public.support_session_media (support_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_session_media_media_id
  ON public.support_session_media (media_id);

ALTER TABLE public.support_session_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Service role can manage support session media"
ON public.support_session_media
FOR ALL TO service_role
USING (true)
WITH CHECK (true);