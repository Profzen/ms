// src/js/products.js
import { supabase, fetchProducts } from "./supabaseClient.js";

/*
Responsible for:
- fetching products (server via supabaseClient)
- rendering product cards into #productsGrid
- basic search (input)
- pagination (load more) — simple pattern
*/

const grid = document.getElementById("productsGrid");
const searchInput = document.getElementById("searchInput");

let currentQuery = "";
let offset = 0;
const PAGE_SIZE = 12;

function renderCard(product) {
  const img = product.image_url || "/public/nbbcl.png";
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <a href="/product.html?id=${encodeURIComponent(product.id)}" style="display:block; height:100%;">
      <div class="media"><img src="${img}" alt="${escapeHtml(product.title)}"></div>
      <div class="body">
        <div style="font-size:13px; color:var(--muted)">${escapeHtml(product.sku || "")}</div>
        <h3 style="font-weight:700; font-size:15px;">${escapeHtml(product.title)}</h3>
        <div style="margin-top:auto; display:flex; justify-content:space-between; align-items:center;">
          <div class="price">${Number(product.price).toLocaleString()} ${product.currency || "XOF"}</div>
          <button class="btn-buy" data-id="${product.id}">Ajouter</button>
        </div>
      </div>
    </a>
  `;
  return div;
}

function escapeHtml(s){ if(!s) return ""; return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function loadProducts(reset = false) {
  if (reset) { offset = 0; grid.innerHTML = ""; }
  try {
    const products = await fetchProducts({ limit: PAGE_SIZE, offset, query: currentQuery });
    products.forEach(p => grid.appendChild(renderCard(p)));
    offset += products.length;
    // attach add-to-cart handlers (delegated)
    grid.querySelectorAll(".btn-buy").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        addToCartById(id);
      });
    });
  } catch (err) {
    console.error("Erreur fetch products:", err);
    grid.innerHTML = "<p class='text-muted'>Impossible de charger les produits pour le moment.</p>";
  }
}

// basic search
if (searchInput) {
  let debounceTimer;
  searchInput.addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      currentQuery = e.target.value.trim();
      loadProducts(true);
    }, 300);
  });
}

// cart helper (very small)
function addToCartById(id) {
  // try to fetch product details then add to localStorage
  supabase.from("products").select("id,title,price,currency,image_url").eq("id", id).single().then(({ data, error }) => {
    if (error || !data) return alert("Produit introuvable");
    const cart = JSON.parse(localStorage.getItem("ms_cart") || "[]");
    const found = cart.find(i => i.id === data.id);
    if (found) found.quantity++;
    else cart.push({ ...data, quantity: 1 });
    localStorage.setItem("ms_cart", JSON.stringify(cart));
    alert("Ajouté au panier");
  });
}

// initial load
loadProducts(true);
