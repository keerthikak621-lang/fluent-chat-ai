DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.chat_sessions CASCADE;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;

UPDATE public.profiles
SET username = lower(regexp_replace(coalesce(display_name, 'user'), '[^a-zA-Z0-9_]', '', 'g')) || '_' || substr(id::text, 1, 4)
WHERE username IS NULL;

ALTER TABLE public.profiles ALTER COLUMN username SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_key ON public.profiles (lower(username));
CREATE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles (lower(email));

CREATE TABLE public.contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, contact_id),
  CHECK (user_id <> contact_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own contacts"
  ON public.contacts FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  is_group BOOLEAN NOT NULL DEFAULT false,
  title TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.conversation_participants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_participants TO authenticated;
GRANT ALL ON public.conversation_participants TO service_role;

CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_text TEXT NOT NULL,
  original_language TEXT NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON public.messages (conversation_id, created_at);

CREATE TABLE public.message_translations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, language)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_translations TO authenticated;
GRANT ALL ON public.message_translations TO service_role;

CREATE OR REPLACE FUNCTION public.is_conversation_participant(_conversation_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = _conversation_id AND user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.users_share_conversation(_a UUID, _b UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp1
    JOIN public.conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
    WHERE cp1.user_id = _a AND cp2.user_id = _b
  );
$$;

CREATE OR REPLACE FUNCTION public.is_contact(_owner UUID, _contact UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.contacts WHERE user_id = _owner AND contact_id = _contact
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_message(_message_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.messages m
    JOIN public.conversation_participants cp ON cp.conversation_id = m.conversation_id
    WHERE m.id = _message_id AND cp.user_id = _user_id
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_conversation_participant(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.users_share_conversation(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_contact(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_access_message(UUID, UUID) FROM anon;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view conversations"
  ON public.conversations FOR SELECT TO authenticated
  USING (public.is_conversation_participant(id, auth.uid()));
CREATE POLICY "Users can create conversations"
  ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Participants can update conversations"
  ON public.conversations FOR UPDATE TO authenticated
  USING (public.is_conversation_participant(id, auth.uid()));

CREATE POLICY "Participants can view membership"
  ON public.conversation_participants FOR SELECT TO authenticated
  USING (public.is_conversation_participant(conversation_id, auth.uid()));
CREATE POLICY "Users can join or be added by creator"
  ON public.conversation_participants FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id AND c.created_by = auth.uid()
    )
  );
CREATE POLICY "Users can leave conversations"
  ON public.conversation_participants FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Participants can read messages"
  ON public.messages FOR SELECT TO authenticated
  USING (public.is_conversation_participant(conversation_id, auth.uid()));
CREATE POLICY "Participants can send messages"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_participant(conversation_id, auth.uid())
  );

CREATE POLICY "Participants can read translations"
  ON public.message_translations FOR SELECT TO authenticated
  USING (public.can_access_message(message_id, auth.uid()));
CREATE POLICY "Participants can cache translations"
  ON public.message_translations FOR INSERT TO authenticated
  WITH CHECK (public.can_access_message(message_id, auth.uid()));

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view relevant profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR public.is_contact(auth.uid(), id)
    OR public.users_share_conversation(auth.uid(), id)
  );

CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  base_username TEXT;
  final_username TEXT;
  suffix INT := 0;
BEGIN
  base_username := lower(regexp_replace(
    coalesce(NEW.raw_user_meta_data ->> 'username', split_part(NEW.email, '@', 1)),
    '[^a-zA-Z0-9_]', '', 'g'
  ));
  IF base_username = '' OR base_username IS NULL THEN
    base_username := 'user';
  END IF;

  final_username := base_username;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = final_username) LOOP
    suffix := suffix + 1;
    final_username := base_username || suffix::text;
  END LOOP;

  INSERT INTO public.profiles (id, display_name, preferred_language, username, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data ->> 'preferred_language', 'en'),
    final_username,
    NEW.email
  );
  RETURN NEW;
END;
$$;

ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER TABLE public.message_translations REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_translations;