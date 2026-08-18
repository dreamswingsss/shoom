// Delete Account — App Store Guideline 5.1.1(v) requires this to be a real,
// in-app, complete deletion (auth identity + every row + every file), not a
// soft "deactivate". The mobile app's anon key is intentionally powerless to
// do this itself (that's the whole point of RLS) — only this server-side
// function, running with the service_role key, can call
// `auth.admin.deleteUser()`. Deploy with `supabase functions deploy
// delete-account` and invoke it from the client via
// `supabase.functions.invoke('delete-account')` (see
// src/services/accountService.js).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CLOTHES_BUCKET = 'clothes-photos';

// Same cross-origin situation as telegram-verify/index.ts — the Mini App's
// web build calls this from its own origin, not *.supabase.co.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization header.' }, 401);
    }

    // Scoped to the caller's own JWT — used only to find out *who* is
    // asking. Never used to perform the deletion itself.
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
      error: userError,
    } = await callerClient.auth.getUser();
    if (userError || !user) {
      return json({ error: 'Unauthorized.' }, 401);
    }

    // Admin client — the ONLY place SUPABASE_SERVICE_ROLE_KEY is used. Set
    // as a Supabase Edge Function secret, never bundled into the app.
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Remove every Storage object under this user's folder
    //    ("{user_id}/*") — auth.admin.deleteUser() below has no idea
    //    Storage exists, so this has to happen explicitly and first.
    const { data: files, error: listError } = await adminClient.storage
      .from(CLOTHES_BUCKET)
      .list(user.id);
    if (listError) throw listError;

    if (files && files.length > 0) {
      const paths = files.map((file) => `${user.id}/${file.name}`);
      const { error: removeError } = await adminClient.storage.from(CLOTHES_BUCKET).remove(paths);
      if (removeError) throw removeError;
    }

    // 2. Delete the auth identity. public.users -> public.clothes ->
    //    public.outfits -> public.outfit_items all cascade automatically
    //    via their `on delete cascade` foreign keys (0001_init.sql) — no
    //    manual table-by-table cleanup needed here.
    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(user.id);
    if (deleteUserError) throw deleteUserError;

    return json({ success: true }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
