// supabase/functions/updateProduct/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.33.0?target=deno";
// Use Deno.env if available, otherwise fallback to process.env for Node.js compatibility
const SUPABASE_URL = (typeof Deno !== "undefined" && Deno.env?.get)
  ? Deno.env.get("SUPABASE_URL")!
  : process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = (typeof Deno !== "undefined" && Deno.env?.get)
  ? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  : process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

function base64ToUint8Array(dataBase64: string) {
  const match = dataBase64.match(/^data:([^;]+);base64,(.*)$/);
  const b64 = match ? match[2] : dataBase64;
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mime: match ? match[1] : "application/octet-stream" };
}

serve(async (req) => {
  try {
    if (req.method !== "POST" && req.method !== "PUT") return new Response("Method Not Allowed", { status: 405 });

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
    if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);
    const { id } = body as Record<string, any>;
    if (!id) return jsonResponse({ error: "Missing product id" }, 400);

    // fetch existing product
    const { data: existing, error: fetchErr } = await supabase.from("products").select("*").eq("id", id).single();
    if (fetchErr) {
      console.error("fetch product err", fetchErr);
      return jsonResponse({ error: "Product not found", details: fetchErr }, 404);
    }

    // prepare payload
    const payload: Record<string, any> = {};
    const updatableFields = ["title", "price", "currency", "stock", "sku", "category_id", "short_description", "is_active"];
    for (const f of updatableFields) {
      if (typeof body[f] !== "undefined") payload[f] = body[f];
    }

    // handle image update: image_base64 or image_url
    if (body.image_base64) {
      const { bytes, mime } = base64ToUint8Array(String(body.image_base64));
      const ext = mime.split("/")[1] ? mime.split("/")[1].split("+")[0] : "jpg";
      const filename = `${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
      const path = `products/${filename}`;

      const { error: upErr } = await supabase.storage.from("products").upload(path, bytes, {
        contentType: mime,
        cacheControl: "3600",
        upsert: false,
      });
      if (upErr) {
        console.error("storage upload err", upErr);
        return jsonResponse({ error: "Storage upload failed", details: upErr }, 500);
      }
      const { data: urlData } = supabase.storage.from("products").getPublicUrl(path);
      payload.image_url = (urlData as any)?.publicUrl || null;
      payload.storage_path = path;

      // delete old storage object if present
      if (existing.storage_path) {
        try {
          await supabase.storage.from("products").remove([existing.storage_path]);
        } catch (rmErr) {
          console.warn("failed to remove old storage path", existing.storage_path, rmErr);
        }
      }
    } else if (body.image_url) {
      payload.image_url = body.image_url;
      // if we explicitly provide image_url but do not want to remove previous storage_path, leave as-is
      // optionally: remove previous storage_path if you want to migrate away from storage-backed urls
    }

    const { data: updated, error: updateErr } = await supabase.from("products").update(payload).eq("id", id).select().single();
    if (updateErr) {
      console.error("updateErr", updateErr);
      return jsonResponse({ error: "Update failed", details: updateErr }, 500);
    }

    return jsonResponse({ success: true, data: updated });
  } catch (err) {
    console.error("unexpected", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});
