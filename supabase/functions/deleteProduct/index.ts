// supabase/functions/deleteProduct/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.33.0?target=deno";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

serve(async (req) => {
  try {
    if (req.method !== "POST" && req.method !== "DELETE") return new Response("Method Not Allowed", { status: 405 });

    const authHeader = req.headers.get("authorization");
    if (!authHeader) return new Response("Unauthorized", { status: 401 });
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return new Response("Unauthorized", { status: 401 });

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return new Response("Invalid token", { status: 401 });
    const user = userData.user;

    // admin check
    const { data: adminRows, error: adminErr } = await supabase
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .limit(1);
    if (adminErr) {
      console.error("admin lookup error", adminErr);
      return jsonResponse({ error: "Server error checking admin" }, 500);
    }
    if (!adminRows || adminRows.length === 0) return new Response("Forbidden", { status: 403 });

    const body = await req.json().catch(() => null);
    if (!body) return jsonResponse({ error: "Invalid JSON" }, 400);
    const { id } = body as Record<string, any>;
    if (!id) return jsonResponse({ error: "Missing product id" }, 400);

    // get product to know storage_path
    const { data: prod, error: fetchErr } = await supabase.from("products").select("*").eq("id", id).single();
    if (fetchErr) {
      console.error("fetch product err", fetchErr);
      return jsonResponse({ error: "Product not found", details: fetchErr }, 404);
    }

    // delete DB row
    const { error: delErr } = await supabase.from("products").delete().eq("id", id);
    if (delErr) {
      console.error("delete db err", delErr);
      return jsonResponse({ error: "Delete failed", details: delErr }, 500);
    }

    // remove storage object if exists (best-effort)
    if (prod.storage_path) {
      try {
        const { error: rmErr } = await supabase.storage.from("products").remove([prod.storage_path]);
        if (rmErr) console.warn("failed to remove storage object", rmErr);
      } catch (err) {
        console.warn("storage remove failed", err);
      }
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("unexpected", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});
