// supabase/functions/addProduct/index.ts
import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.33.0?target=deno";

const SUPABASE_URL = Deno.env.get("https://vrzmowqzegmaymewmbij.supabase.co")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyem1vd3F6ZWdtYXltZXdtYmlqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTMwMzA3OSwiZXhwIjoyMDcwODc5MDc5fQ.cDFf-FPDxqHvZOphtoWR09CS9GGXL6OziGHEQLgx9S8")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

function base64ToUint8Array(dataBase64: string) {
  // dataBase64 can be "data:<mime>;base64,AAAA..." or just "AAAA..."
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
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const authHeader = req.headers.get("authorization");
    if (!authHeader) return new Response("Unauthorized", { status: 401 });
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return new Response("Unauthorized", { status: 401 });

    // Validate token -> get user
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return new Response("Invalid token", { status: 401 });

    const user = userData.user;

    // Check admin membership
    const { data: adminRows, error: adminErr } = await supabase
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .limit(1);

    if (adminErr) {
      console.error("admins lookup error:", adminErr);
      return jsonResponse({ error: "Server error checking admin" }, 500);
    }
    if (!adminRows || adminRows.length === 0) return new Response("Forbidden", { status: 403 });

    // Parse body
    const body = await req.json().catch(() => null);
    if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

    const {
      title,
      price,
      currency = "XOF",
      stock = 0,
      sku = null,
      category_id = null,
      short_description = null,
      image_base64 = null, // optional data URL or base64 string
      image_url = null,    // optional if already uploaded client-side
    } = body as Record<string, any>;

    if (!title || typeof price === "undefined") return jsonResponse({ error: "title and price required" }, 400);

    // If image_base64 present -> upload to storage
    let image_url_result: string | null = image_url || null;
    let storage_path: string | null = null;

    if (image_base64) {
      const { bytes, mime } = base64ToUint8Array(String(image_base64));
      // determine extension
      const ext = mime.split("/")[1] ? mime.split("/")[1].split("+")[0] : "jpg";
      const filename = `${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
      const path = `products/${filename}`;
      const { error: upErr } = await supabase.storage.from("products").upload(path, bytes, {
        contentType: mime,
        cacheControl: "3600",
        upsert: false,
      });
      if (upErr) {
        console.error("upload error", upErr);
        return jsonResponse({ error: "Storage upload failed", details: upErr }, 500);
      }
      const { data: urlData } = supabase.storage.from("products").getPublicUrl(path);
      image_url_result = (urlData as any)?.publicUrl || null;
      storage_path = path;
    }

    // Insert product row using service_role (we use client already created with service role)
    const insertPayload: Record<string, any> = {
      title,
      price,
      currency,
      stock,
      sku,
      category_id,
      short_description,
      image_url: image_url_result,
      storage_path,
      is_active: true,
      created_at: new Date().toISOString(),
    };

    const { data: newProduct, error: insertErr } = await supabase
      .from("products")
      .insert([insertPayload])
      .select()
      .single();

    if (insertErr) {
      console.error("insertErr", insertErr);
      return jsonResponse({ error: "Insert failed", details: insertErr }, 500);
    }

    return jsonResponse({ success: true, data: newProduct });
  } catch (err) {
    console.error("unexpected", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});
