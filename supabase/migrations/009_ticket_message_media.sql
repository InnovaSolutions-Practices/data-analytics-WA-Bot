-- Phase 2: WhatsApp image attachments for support tickets.
-- Existing text messages remain valid through the TEXT default.

ALTER TABLE public.ticket_messages
  ALTER COLUMN message DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'TEXT',
  ADD COLUMN IF NOT EXISTS media_id TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE public.ticket_messages
  DROP CONSTRAINT IF EXISTS ticket_messages_message_type_check;

ALTER TABLE public.ticket_messages
  ADD CONSTRAINT ticket_messages_message_type_check
  CHECK (message_type IN ('TEXT', 'IMAGE'));

CREATE INDEX IF NOT EXISTS idx_ticket_messages_media_id
  ON public.ticket_messages (media_id)
  WHERE media_id IS NOT NULL;