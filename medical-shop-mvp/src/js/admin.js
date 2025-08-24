// src/admin.js
import { supabase } from './supabaseClient.js';

// -------------- CONFIG ----------------
const EDGE_ADD_PRODUCT = "https://vrzmowqzegmaymewmbij.functions.supabase.co/addProduct"; // change si besoin
const EDGE_UPDATE_PRODUCT = "https://vrzmowqzegmaymewmbij.functions.supabase.co/updateProduct";
const EDGE_DELETE_PRODUCT = "https://vrzmowqzegmaymewmbij.functions.supabase.co/deleteProduct";
const PAGE_SIZE = 12;

// -------------- DOM -------------------
const whoami = document.getElementById('whoami');
const btnLogout = document.getElementById('btn-logout');

const btnNew = document.getElementById('btn-new');
const productsGrid = document.getElementById('productsGrid');
const btnLoadMore = document.getElementById('btn-load-more');
const searchInput = document.getElementById('searchInput');
const filterCategory = document.getElementById('filterCategory');
const filterStatus = document.getElementById('filterStatus');

const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginMsg = document.getElementById('loginMsg');

const adminPanel = document.getElementById('adminPanel');
const adminEmail = document.getElementById('adminEmail');

const productForm = document.getElementById('productForm');
const productIdInput = document.getElementById('productId');
const titleInput = document.getElementById('title');
const priceInput = document.getElementById('price');
const stockInput = document.getElementById('stock');
const categorySelect = document.getElementById('categorySelect');
const shortDesc = document.getElementById('shortDesc');
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');
const prodMsg = document.getElementById('prodMsg');
const btnSave = document.getElementById('btn-save');
const btnCancel = document.getElementById('btn-cancel');

const btnRefreshProducts = document.getElementById('btn-refresh-products');
const btnViewClient = document.getElementById('btn-view-client');
const linkHome = document.getElementById('link-home');
const linkProducts = document.getElementById('link-products');

const modalConfirm = document.getElementById('modalConfirm');
const confirmDeleteYes = document.getElementById('confirmDeleteYes');
const confirmDeleteNo = document.getElementById('confirmDeleteNo');

// State
let currentUser = null;
let isAdmin = false;
let categories = [];
let productsOffset = 0;
let currentSearch = '';
let currentCategoryFilter = '';
let currentStatusFilter = '';
let productToDeleteId = null;

// ---------- UTIL ----------
function showMessage(el, msg, type='info') {
  el.textContent = msg;
  el.style.color = type === 'error' ? '#ff9b9b' : (type === 'ok' ? '#9fffc6' : '#9fb7d6');
}
function emptyPreview() { imagePreview.innerHTML = '<span class="small muted center">Aperçu</span>'; }

// Resize image client-side and return DataURL
function fileToDataUrlResized(file, maxSize=1200) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height;
      if (Math.max(w,h) > maxSize) {
        const ratio = maxSize / Math.max(w,h);
        w = Math.round(w * ratio); h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img,0,0,w,h);
      const isJpeg = /jpe?g/i.test(file.type) || /jpe?g/i.test(file.name);
      const mime = isJpeg ? 'image/jpeg' : 'image/png';
      const dataUrl = canvas.toDataURL(mime, isJpeg ? 0.85 : 1.0);
      URL.revokeObjectURL(url);
      resolve({ dataUrl, mime });
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); }
    img.src = url;
  });
}
function dataUrlToFile(dataUrl, filename) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8 = new Uint8Array(n);
  while (n--) u8[n] = bstr.charCodeAt(n);
  return new File([u8], filename, { type: mime });
}
function formatCurrency(v,c='XOF'){ return `${Number(v).toLocaleString('fr-FR')} ${c}`; }

// Escape HTML
function esc(s=''){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ---------- AUTH ----------
async function refreshSession() {
  const { data } = await supabase.auth.getUser();
  const user = data?.user ?? null;
  currentUser = user;
  if (!user) {
    // If no user, redirect to login page (force pre-auth before admin)
    window.location.href = '/admin-login.html';
    return;
  }
  whoami.textContent = user.email || user.id;
  document.getElementById('btn-logout').style.display = 'inline-flex';
  // check admin membership
  await checkAdmin(user);
}

async function checkAdmin(user) {
  const { data, error } = await supabase.from('admins').select('user_id').eq('user_id', user.id).limit(1);
  if (error) {
    console.error('Checking admin error', error);
    showMessage(loginMsg, 'Erreur vérification admin', 'error');
    return;
  }
  if (data && data.length===1) {
    isAdmin = true;
    adminPanel.style.display = 'block';
    adminEmail.textContent = user.email || user.id;
    await initAdmin();
  } else {
    isAdmin = false;
    adminPanel.style.display = 'none';
    showMessage(loginMsg, 'Utilisateur non-admin', 'error');
  }
}

// Login form (if needed as fallback)
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMessage(loginMsg, 'Connexion en cours...');
    const email = loginEmail.value.trim(), password = loginPassword.value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) showMessage(loginMsg, error.message, 'error'); else {
      showMessage(loginMsg, 'Connecté — redirection…', 'ok');
      setTimeout(() => window.location.reload(), 400);
    }
  });
}

// Logout
btnLogout?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = '/admin-login.html';
});

// listen auth changes
supabase.auth.onAuthStateChange(() => refreshSession());
refreshSession(); // initial

// ---------- INITIALIZATION ----------
async function initAdmin() {
  await loadCategories();
  await resetAndLoadProducts();
  attachUIHandlers();
}

// ---------- CATEGORIES ----------
async function loadCategories() {
  const { data, error } = await supabase.from('categories').select('id,name').eq('is_active', true).order('name',{ascending:true});
  if (error) { console.error('Categories load', error); return; }
  categories = data || [];
  // fill filters & select
  filterCategory.innerHTML = `<option value="">Toutes catégories</option>`;
  categorySelect.innerHTML = `<option value="">— Choisir —</option>`;
  for (const c of categories) {
    const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; filterCategory.appendChild(o);
    const o2 = document.createElement('option'); o2.value = c.id; o2.textContent = c.name; categorySelect.appendChild(o2);
  }
}

// ---------- PRODUCTS LIST ----------
function resetAndLoadProducts() {
  productsOffset = 0; productsGrid.innerHTML=''; btnLoadMore.style.display='inline-flex';
  loadProducts({ reset:true });
}
async function loadProducts({ reset=false }={}) {
  if (reset) { productsOffset = 0; productsGrid.innerHTML=''; }
  // build query
  let qb = supabase.from('products').select('id,title,price,currency,stock,is_active,created_at,short_description,image_url,category_id').order('created_at',{ascending:false}).range(productsOffset, productsOffset + PAGE_SIZE - 1);
  if (currentSearch) qb = qb.ilike('title', `%${currentSearch}%`);
  if (currentCategoryFilter) qb = qb.eq('category_id', currentCategoryFilter);
  if (currentStatusFilter === 'active') qb = qb.eq('is_active', true);
  if (currentStatusFilter === 'inactive') qb = qb.eq('is_active', false);

  const { data, error } = await qb;
  if (error) { console.error('loadProducts', error); productsGrid.innerHTML = `<div class="center muted">Erreur chargement</div>`; return; }
  if (!data || data.length===0) { if (productsOffset===0) productsGrid.innerHTML = `<div class="center muted">Aucun produit</div>`; btnLoadMore.style.display='none'; return; }

  for (const p of data) {
    const card = createProductCard(p);
    productsGrid.appendChild(card);
  }
  productsOffset += data.length;
  if (data.length < PAGE_SIZE) btnLoadMore.style.display = 'none';
}

function createProductCard(p) {
  const el = document.createElement('div');
  el.className = 'card-product';
  el.dataset.id = p.id;
  const img = p.image_url || '/nbbcl.png';
  el.innerHTML = `
    <div class="thumb"><img src="${esc(img)}" alt="${esc(p.title)}" /></div>
    <div class="p-body">
      <div style="display:flex;justify-content:space-between;"><strong>${esc(p.title)}</strong><span class="badge">${formatCurrency(p.price,p.currency)}</span></div>
      <div class="muted" style="font-size:13px">Stock: ${p.stock ?? 0}</div>
      <div class="muted" style="font-size:13px">${esc(p.short_description || '')}</div>
      <div class="p-actions">
        <button class="btn ghost btn-edit" data-id="${p.id}">Modifier</button>
        <button class="btn ghost btn-copy" data-id="${p.id}">Dupliquer</button>
        <button class="btn warn btn-delete" data-id="${p.id}">Supprimer</button>
      </div>
    </div>`;
  // handlers
  el.querySelector('.btn-edit').addEventListener('click', () => openEdit(p.id));
  el.querySelector('.btn-delete').addEventListener('click', () => confirmDelete(p.id));
  el.querySelector('.btn-copy').addEventListener('click', () => duplicateProduct(p.id));
  return el;
}

// ---------- UI HANDLERS ----------
function attachUIHandlers() {
  btnNew.addEventListener('click', openNew);
  btnLoadMore.addEventListener('click', () => loadProducts({ reset:false }));
  searchInput.addEventListener('input', (e) => { currentSearch = e.target.value.trim(); setTimeout(()=>loadProducts({reset:true}), 300); });
  filterCategory.addEventListener('change', (e) => { currentCategoryFilter = e.target.value; loadProducts({reset:true}); });
  filterStatus.addEventListener('change', (e) => { currentStatusFilter = e.target.value; loadProducts({reset:true}); });
  btnRefreshProducts.addEventListener('click', () => loadProducts({reset:true}));
  btnViewClient.addEventListener('click', () => window.open('/src/index.html','_blank'));
  linkHome.addEventListener('click', (ev)=>{ ev.preventDefault(); window.open('/src/index.html','_blank'); });
  linkProducts.addEventListener('click', (ev)=>{ ev.preventDefault(); window.open('/src/products.html','_blank'); });
}

// ---------- FORM ----------

function openNew() {
  productIdInput.value = '';
  titleInput.value = '';
  priceInput.value = '';
  stockInput.value = '0';
  categorySelect.value = '';
  shortDesc.value = '';
  imageInput.value = '';
  emptyPreview();
  prodMsg.textContent = '';
  window.scrollTo({ top:0, behavior:'smooth' });
}

async function openEdit(productId) {
  const { data, error } = await supabase.from('products').select('*').eq('id', productId).single();
  if (error) { alert('Erreur chargement produit'); console.error(error); return; }
  const p = data;
  productIdInput.value = p.id;
  titleInput.value = p.title || '';
  priceInput.value = p.price || 0;
  stockInput.value = p.stock || 0;
  categorySelect.value = p.category_id || '';
  shortDesc.value = p.short_description || p.description || '';
  imagePreview.innerHTML = p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.title)}">` : '<span class="small muted center">Aperçu</span>';
  window.scrollTo({ top:0, behavior:'smooth' });
}

imageInput.addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) { emptyPreview(); return; }
  const { dataUrl } = await fileToDataUrlResized(f, 1200);
  imagePreview.innerHTML = `<img src="${dataUrl}" alt="preview" />`;
});

// submit form
productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isAdmin || !currentUser) { showMessage(prodMsg, 'Non autorisé', 'error'); return; }

  const id = productIdInput.value || null;
  const title = titleInput.value.trim();
  const price = Number(priceInput.value || 0);
  const stock = Number(stockInput.value || 0);
  const category_id = categorySelect.value || null;
  const short_description = shortDesc.value.trim();
  const imageFile = imageInput.files?.[0] || null;

  if (!title || !price) { showMessage(prodMsg, 'Titre et prix requis', 'error'); return; }
  showMessage(prodMsg, 'En cours...');

  try {
    if (!id) {
      // CREATE via Edge Function (secure)
      const fd = new FormData();
      fd.append('title', title);
      fd.append('price', String(price));
      fd.append('stock', String(stock));
      fd.append('category_id', category_id || '');
      fd.append('short_description', short_description || '');
      if (imageFile) fd.append('image', imageFile, imageFile.name);

      // attach token for the Edge Function to verify admin
      const session = await supabase.auth.getSession();
      const token = session?.data?.session?.access_token;
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

      const res = await fetch(EDGE_ADD_PRODUCT, { method:'POST', headers, body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || json?.message || 'Erreur création');

      showMessage(prodMsg, 'Produit créé ✅', 'ok');
      openNew(); loadProducts({reset:true});
      return;
    } else {
      // UPDATE: either use Edge Function or client update + storage upload
      let image_url = null;
      if (imageFile) {
        const { dataUrl, mime } = await fileToDataUrlResized(imageFile, 1600);
        const file = dataUrlToFile(dataUrl, imageFile.name);
        const path = `products/${crypto.randomUUID()}_${file.name.replace(/\s+/g,'_')}`;
        const up = await supabase.storage.from('products').upload(path, file, { cacheControl:'3600', upsert:false });
        if (up.error) throw up.error;
        const { data } = supabase.storage.from('products').getPublicUrl(path);
        image_url = data?.publicUrl || null;
      }

      const payload = { title, price, stock, category_id: category_id || null, short_description };
      if (image_url) payload.image_url = image_url;

      const { error } = await supabase.from('products').update(payload).eq('id', id);
      if (error) throw error;

      showMessage(prodMsg, 'Produit mis à jour ✅', 'ok');
      openNew(); loadProducts({ reset:true });
    }
  } catch (err) {
    console.error('Save error', err);
    showMessage(prodMsg, err.message || String(err), 'error');
  }
});

// ---------- DUPLICATE ----------
async function duplicateProduct(productId) {
  try {
    const { data, error } = await supabase.from('products').select('*').eq('id', productId).single();
    if (error) throw error;
    const p = data;
    const { data: inserted, error: insErr } = await supabase.from('products').insert([{
      title: p.title + ' (copie)',
      short_description: p.short_description,
      description: p.description,
      price: p.price,
      stock: p.stock,
      currency: p.currency,
      category_id: p.category_id,
      image_url: p.image_url,
      is_active: false
    }]);
    if (insErr) throw insErr;
    await loadProducts({ reset:true });
    alert('Produit dupliqué (inactif).');
  } catch (err) { console.error(err); alert('Erreur duplication'); }
}

// ---------- DELETE ----------
function confirmDelete(productId) {
  productToDeleteId = productId;
  modalConfirm.style.display = 'grid';
}
confirmDeleteNo.addEventListener('click', () => { modalConfirm.style.display='none'; productToDeleteId = null; });
confirmDeleteYes.addEventListener('click', async () => {
  try {
    if (!productToDeleteId) return;
    // delete through Edge Function for secure deletion (recommended)
    const session = await supabase.auth.getSession();
    const token = session?.data?.session?.access_token;
    const headers = token ? { 'Authorization': `Bearer ${token}`, 'Content-Type':'application/json' } : {'Content-Type':'application/json'};
    const res = await fetch(EDGE_DELETE_PRODUCT, { method:'POST', headers, body: JSON.stringify({ id: productToDeleteId }) });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || json?.message || 'Erreur suppression');
    modalConfirm.style.display='none';
    productToDeleteId = null;
    await loadProducts({ reset:true });
  } catch (err) { console.error('Delete error', err); alert('Erreur suppression'); }
});

// ---------- INITIAL LOAD ----------
(async function init() {
  // ensure admin is initialized
})();
