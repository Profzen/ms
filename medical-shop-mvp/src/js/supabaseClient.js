// src/js/supabaseClient.js
// Wrapper léger autour de supabase-js (CDN import). Version améliorée.
// Nécessite un fichier ./config.js exportant SUPABASE_URL et SUPABASE_ANON_KEY
// Exemple : export const SUPABASE_URL = "..."; export const SUPABASE_ANON_KEY = "...";

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_FUNCTION_BASE_URL } from "./config.js";

// Initialise le client Supabase côté client (ANON key)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/*
  Fonctions exportées :
  - fetchProducts(opts) -> [products]
  - getProductById(id) -> product
  - uploadImage(file, { folder }) -> publicUrl
  - createProductDirect(payload) -> insert via client (requires RLS/admin)
  - createProductViaFunction(formData, functionUrl) -> calls Edge Function (multipart)
  - invokeFunctionJson(fnName, body) -> wrapper pour supabase.functions.invoke (JSON)
*/

// ----------------- Products -----------------
/**
 * Récupère produits (avec options)
 * opts: { limit=20, offset=0, query='', category=null, onlyActive=true }
 * retourne tableau de produits
 */
export async function fetchProducts({
  limit = 20,
  offset = 0,
  query = "",
  category = null,
  onlyActive = true,
} = {}) {
  try {
    let qb = supabase
      .from("products")
      .select("id,title,price,currency,image_url,stock,sku,is_active,created_at,category_id,short_description")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (onlyActive) qb = qb.eq("is_active", true);
    if (query) qb = qb.ilike("title", `%${query}%`);
    if (category) qb = qb.eq("category_id", category);

    const { data, error } = await qb;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("fetchProducts error:", err);
    throw err;
  }
}

export async function getProductById(id) {
  try {
    const { data, error } = await supabase.from("products").select("*").eq("id", id).single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error("getProductById error:", err);
    throw err;
  }
}

// ----------------- Storage (images) -----------------
/**
 * Upload d'une image dans le bucket "products".
 * file: File object
 * options: { folder: 'optional/subfolder', publicRead: true }
 * Retourne: { publicUrl, path }
 */
export async function uploadImage(file, { folder = "products", publicRead = true } = {}) {
  try {
    // sanitize filename
    const safeName = `${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
    const path = `${folder}/${safeName}`;

    const { data: upData, error: upErr } = await supabase.storage.from("products").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    });

    if (upErr) {
      // si conflit path exists, tu peux retenter avec autre filename
      console.error("uploadImage upload error:", upErr);
      throw upErr;
    }

    // getPublicUrl expects the path not the upData object
    const { data: urlData, error: urlErr } = supabase.storage.from("products").getPublicUrl(path);
    if (urlErr) {
      console.error("uploadImage getPublicUrl error:", urlErr);
      throw urlErr;
    }

    return { publicUrl: urlData.publicUrl, path };
  } catch (err) {
    console.error("uploadImage error:", err);
    throw err;
  }
}

// ----------------- Create product (client) -----------------
/**
 * Insert directement en DB via client (doit respecter RLS)
 * productPayload: { title, price, stock, currency, image_url, category_id, ... }
 */
export async function createProductDirect(productPayload) {
  try {
    const { data, error } = await supabase.from("products").insert([productPayload]).select().single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error("createProductDirect error:", err);
    throw err;
  }
}

// ----------------- Edge Function helpers -----------------
/**
 * Appelle une Edge Function déployée via son URL (multipart/form-data).
 * functionUrl: url complète (ex: https://<proj>.functions.supabase.co/addProduct)
 * formData: instance de FormData (peut contenir File)
 * token (optional): bearer token (session access token) pour vérif admin dans la function
 *
 * Renvoie { ok, status, json }
 */
export async function createProductViaFunction(functionUrl, formData, token = null) {
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(functionUrl, {
      method: "POST",
      headers,
      body: formData,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(json?.error || json?.message || `Function returned ${res.status}`);
      e.response = json;
      throw e;
    }
    return json;
  } catch (err) {
    console.error("createProductViaFunction error:", err);
    throw err;
  }
}

/**
 * Wrapper utilitaire pour appeler supabase.functions.invoke pour JSON payloads.
 * (nécessite supabase-js v2)
 */
export async function invokeFunctionJson(functionName, body = {}) {
  try {
    const res = await supabase.functions.invoke(functionName, { body });
    if (res.error) throw res.error;
    return res.data;
  } catch (err) {
    console.error("invokeFunctionJson error:", err);
    throw err;
  }
}

// ----------------- Export utilitaires -----------------
export default {
  supabase,
  fetchProducts,
  getProductById,
  uploadImage,
  createProductDirect,
  createProductViaFunction,
  invokeFunctionJson,
};
