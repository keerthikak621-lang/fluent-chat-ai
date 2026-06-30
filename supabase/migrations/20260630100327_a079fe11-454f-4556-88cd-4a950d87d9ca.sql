CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.is_conversation_participant(_conversation_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = _conversation_id AND user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION private.users_share_conversation(_a UUID, _b UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp1
    JOIN public.conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
    WHERE cp1.user_id = _a AND cp2.user_id = _b
  );
$$;

CREATE OR REPLACE FUNCTION private.is_contact(_owner UUID, _contact UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.contacts WHERE user_id = _owner AND contact_id = _contact
  );
$$;

CREATE OR REPLACE FUNCTION private.can_access_message(_message_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.messages m
    JOIN public.conversation_participants cp ON cp.conversation_id = m.conversation_id
    WHERE m.id = _message_id AND cp.user_id = _user_id
  );
$$;

GRANT EXECUTE ON FUNCTION private.is_conversation_participant(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.users_share_conversation(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_contact(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_message(UUID, UUID) TO authenticated;

-- Recreate policies to reference the private-schema helpers
DROP POLICY IF EXISTS "Participants can view conversations" ON public.conversations;
DROP POLICY IF EXISTS "Participants can update conversations" ON public.conversations;
CREATE POLICY "Participants can view conversations"
  ON public.conversations FOR SELECT TO authenticated
  USING (private.is_conversation_participant(id, auth.uid()));
CREATE POLICY "Participants can update conversations"
  ON public.conversations FOR UPDATE TO authenticated
  USING (private.is_conversation_participant(id, auth.uid()));

DROP POLICY IF EXISTS "Participants can view membership" ON public.conversation_participants;
CREATE POLICY "Participants can view membership"
  ON public.conversation_participants FOR SELECT TO authenticated
  USING (private.is_conversation_participant(conversation_id, auth.uid()));

DROP POLICY IF EXISTS "Participants can read messages" ON public.messages;
DROP POLICY IF EXISTS "Participants can send messages" ON public.messages;
CREATE POLICY "Participants can read messages"
  ON public.messages FOR SELECT TO authenticated
  USING (private.is_conversation_participant(conversation_id, auth.uid()));
CREATE POLICY "Participants can send messages"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND private.is_conversation_participant(conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS "Participants can read translations" ON public.message_translations;
DROP POLICY IF EXISTS "Participants can cache translations" ON public.message_translations;
CREATE POLICY "Participants can read translations"
  ON public.message_translations FOR SELECT TO authenticated
  USING (private.can_access_message(message_id, auth.uid()));
CREATE POLICY "Participants can cache translations"
  ON public.message_translations FOR INSERT TO authenticated
  WITH CHECK (private.can_access_message(message_id, auth.uid()));

DROP POLICY IF EXISTS "Users can view relevant profiles" ON public.profiles;
CREATE POLICY "Users can view relevant profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR private.is_contact(auth.uid(), id)
    OR private.users_share_conversation(auth.uid(), id)
  );

-- Drop the now-unused public-schema helpers
DROP FUNCTION IF EXISTS public.is_conversation_participant(UUID, UUID);
DROP FUNCTION IF EXISTS public.users_share_conversation(UUID, UUID);
DROP FUNCTION IF EXISTS public.is_contact(UUID, UUID);
DROP FUNCTION IF EXISTS public.can_access_message(UUID, UUID);