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

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header.' }), { status: 401 });
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
      return new Response(JSON.stringify({ error: 'Unauthorized.' }), { status: 401 });
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

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
