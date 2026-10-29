/* ============================================================
   CONFIGURACIÓN: lo único que necesitas cambiar para empezar
   ============================================================ */
const CONFIG = {
  NOMBRE_NEGOCIO: "ADRICELL",
  WHATSAPP: "51997228280",          // código de país + número, sin + ni espacios
  MONEDA: "S/",
  // Pega aquí el enlace CSV publicado de tu Google Sheets.
  // Si lo dejas vacío, se usa el archivo local productos.csv (útil para probar).
  URL_HOJA_CSV: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyjxUYA4haHy7sga-pVPxXYU4CGaH6pMtrk6erkx96JV2aUZAbWEIsdTG4s__AIb3HQKomHttv_p9R/pub?gid=318715449&single=true&output=csv",
  ORDEN_MARCAS: ["Samsung", "Redmi", "Honor"],  // orden de los apartados; otras marcas van después
  STOCK_BAJO: 3,                    // avisa "Últimas unidades" si stock <= este valor
  CARPETA_FOTOS: "fotos/"           // si en la columna foto pones solo nombres de archivo
};

/* ============================================================
   Utilidades
   ============================================================ */
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dinero = (n) => `${CONFIG.MONEDA} ${Number(n).toFixed(2)}`;
const PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#e7edf1"/><text x="100" y="108" font-family="sans-serif" font-size="16" fill="#8a949d" text-anchor="middle">Sin foto</text></svg>'
);

/* Lector de CSV que respeta comillas y comas dentro de campos */
function parseCSV(texto) {
  const filas = [];
  let fila = [], campo = "", comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo); campo = "";
      if (fila.some((x) => x.trim() !== "")) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x.trim() !== "")) filas.push(fila);
  return filas;
}

/* Cada fila de la hoja es un modelo. Las filas con el mismo "producto" se agrupan en una sola tarjeta. */
function aProductos(filas) {
  if (!filas.length) return [];
  const cab = filas[0].map((h) => h.trim().toLowerCase());
  const idx = (n) => cab.indexOf(n);
  const afirmativo = (v) => ["si", "sí", "1", "true", "x"].includes(String(v || "").trim().toLowerCase());
  const grupos = new Map();

  filas.slice(1).forEach((f) => {
    const g = (n) => (idx(n) >= 0 ? (f[idx(n)] || "").trim() : "");
    const nombre = g("producto") || g("nombre");
    if (!nombre) return;
    const stockTxt = g("stock");
    const stock = stockTxt === "" ? null : Number(stockTxt);
    let estado = (g("estado") || "disponible").toLowerCase();
    if (estado === "oculto") return;
    if (stock === 0) estado = "agotado";

    const fotos = g("foto").split("|").map((x) => x.trim()).filter(Boolean)
      .map((x) => (/^(https?:|data:|\/)/i.test(x) ? x : CONFIG.CARPETA_FOTOS + x));

    const marca = g("marca");
    const k = (marca + "|" + nombre).toLowerCase();   // mismo producto en otra marca = otra tarjeta
    if (!grupos.has(k)) grupos.set(k, { id: "p" + grupos.size, nombre, marca, categoria: g("categoria") || "Otros", variantes: [] });
    grupos.get(k).variantes.push({
      codigo: g("codigo"), modelo: g("modelo"),
      precio: parseFloat(g("precio").replace(",", ".")) || 0,
      stock, estado, fotos, nuevo: afirmativo(g("nuevo"))
    });
  });
  const lista = [...grupos.values()];
  // Modelos en orden natural (A14, A54, A55...) dentro de cada tarjeta
  lista.forEach((p) => p.variantes.sort((a, b) => a.modelo.localeCompare(b.modelo, "es", { numeric: true, sensitivity: "base" })));
  return lista;
}

/* ============================================================
   Estado
   ============================================================ */
let productos = [];
let categoriaActiva = "Todos";
let marcaActiva = "Todas";
let carrito = {};   // { claveVariante: cantidad }
let sel = {};       // { idProducto: indice de modelo elegido }
let fotoSel = {};   // { idProducto: indice de foto elegida }

const claveV = (p, v) => v.codigo || `${p.nombre}|${v.modelo}`;
const agotado = (v) => v.estado === "agotado";
const nombreCompleto = (p, v) => [p.nombre, p.marca, v.modelo].filter(Boolean).join(" - ");

function guardarCarrito() { try { localStorage.setItem("carrito", JSON.stringify(carrito)); } catch (e) {} }
function cargarCarrito() { try { carrito = JSON.parse(localStorage.getItem("carrito")) || {}; } catch (e) { carrito = {}; } }

/* Fotos del modelo; si no tiene, usa las de otro modelo del mismo producto */
function fotosDe(p, v) {
  if (v.fotos.length) return v.fotos;
  const otro = p.variantes.find((x) => x.fotos.length);
  return otro ? otro.fotos : [];
}
const esReferencial = (v) => !v.fotos.length;   // foto prestada de otro modelo

/* ============================================================
   Catálogo
   ============================================================ */
function pintarCategorias() {
  const cats = ["Todos", ...new Set(productos.map((p) => p.categoria))];
  $("chips").innerHTML = cats.map((c) =>
    `<button class="chip" aria-pressed="${c === categoriaActiva}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
}

function pintarMarcas() {
  const marcas = [...new Set(productos.map((p) => p.marca).filter(Boolean))];
  const pos = (m) => { const i = CONFIG.ORDEN_MARCAS.findIndex((x) => x.toLowerCase() === m.toLowerCase()); return i < 0 ? 99 : i; };
  marcas.sort((a, b) => pos(a) - pos(b) || a.localeCompare(b));
  const cuenta = (m) => productos.filter((p) => m === "Todas" || p.marca === m).reduce((s, p) => s + p.variantes.length, 0);
  $("marcas").hidden = marcas.length < 2;
  $("marcas").innerHTML = ["Todas", ...marcas].map((m) =>
    `<button class="marca" aria-pressed="${m === marcaActiva}" data-marca="${esc(m)}">${esc(m)} <small>${cuenta(m)}</small></button>`).join("");
}

function cardHTML(p) {
  const v = p.variantes[sel[p.id]];
  const fotos = fotosDe(p, v);
  const fi = Math.min(fotoSel[p.id] || 0, Math.max(fotos.length - 1, 0));
  const principal = fotos[fi] || PLACEHOLDER;
  const sinStock = agotado(v);
  const bajo = !sinStock && v.stock !== null && v.stock <= CONFIG.STOCK_BAJO;
  const hayNuevo = p.variantes.some((x) => x.nuevo);
  const conModelos = p.variantes.length > 1 || v.modelo;

  const miniaturas = fotos.length > 1 ? `<div class="minis">${fotos.map((f, i) =>
    `<button class="mini" aria-pressed="${i === fi}" data-foto="${p.id}:${i}" aria-label="Ver foto ${i + 1}"><img src="${esc(f)}" alt="" loading="lazy"></button>`).join("")}</div>` : "";

  const modelos = conModelos ? `<div class="modelos" role="group" aria-label="Modelos">${p.variantes.map((x, i) =>
    `<button class="modelo ${agotado(x) ? "sin" : ""}" aria-pressed="${i === sel[p.id]}" data-var="${p.id}:${i}" title="${agotado(x) ? "Agotado" : ""}">${esc(x.modelo || "Único")}</button>`).join("")}</div>` : "";

  return `
  <article class="card" data-p="${p.id}">
    <div class="foto">
      <button class="zoom" data-zoom="${p.id}" aria-label="Ampliar foto de ${esc(p.nombre)}">
        <img src="${esc(principal)}" alt="${esc((p.marca ? p.marca + " " : "") + nombreCompleto(p, v))}" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">
      </button>
      ${sinStock ? '<span class="badge agotado">Agotado</span>' : hayNuevo && v.nuevo ? '<span class="badge nuevo">Nuevo</span>' : ""}
    </div>
    ${miniaturas}
    <div class="info">
      <span class="cat">${p.marca ? `<b class="marca-tag">${esc(p.marca)}</b> · ` : ""}${esc(p.categoria)}</span>
      <h3 class="nombre">${esc(p.nombre)}</h3>
      ${modelos}
      ${v.codigo ? `<span class="cod">Cód. ${esc(v.codigo)}</span>` : ""}
      ${esReferencial(v) && fotos.length ? '<span class="ref">Foto referencial</span>' : ""}
      ${bajo ? '<span class="stock-bajo">Últimas unidades</span>' : ""}
      <span class="precio">${dinero(v.precio)}</span>
    </div>
    <div class="acciones">
      <a class="btn-wa ${sinStock ? "disabled" : ""}" target="_blank" rel="noopener" href="${enlaceProducto(p, v)}">Pedir por WhatsApp</a>
      <button class="btn-sec" data-add="${p.id}" ${sinStock ? "disabled" : ""}>Agregar al pedido</button>
    </div>
  </article>`;
}

function pintarProductos() {
  const q = $("buscador").value.trim().toLowerCase();
  const lista = productos.filter((p) =>
    (categoriaActiva === "Todos" || p.categoria === categoriaActiva) &&
    (marcaActiva === "Todas" || p.marca === marcaActiva) &&
    (!q || p.nombre.toLowerCase().includes(q) || p.marca.toLowerCase().includes(q) ||
      p.variantes.some((v) => v.modelo.toLowerCase().includes(q) || v.codigo.toLowerCase().includes(q))));

  $("estado").textContent = lista.length ? "" : "No encontramos productos con ese filtro.";
  $("grid").innerHTML = lista.map(cardHTML).join("");
}

function repintarTarjeta(id, enfocar) {
  const p = productos.find((x) => x.id === id);
  const el = document.querySelector(`[data-p="${id}"]`);
  if (!p || !el) return;
  el.outerHTML = cardHTML(p);
  if (enfocar) { const b = document.querySelector(`[${enfocar}]`); if (b) b.focus(); }
}

/* ============================================================
   WhatsApp
   ============================================================ */
const wa = (msg) => `https://wa.me/${CONFIG.WHATSAPP}?text=${encodeURIComponent(msg)}`;

function enlaceProducto(p, v) {
  const cod = v.codigo ? ` (Cód. ${v.codigo})` : "";
  return wa(`Hola ${CONFIG.NOMBRE_NEGOCIO}, quiero consultar por: ${nombreCompleto(p, v)}${cod} - ${dinero(v.precio)}`);
}

function enviarPedido() {
  const items = itemsCarrito();
  if (!items.length) return;
  const lineas = items.map(({ p, v, n }) => `- ${n} x ${nombreCompleto(p, v)}${v.codigo ? ` (${v.codigo})` : ""} = ${dinero(v.precio * n)}`);
  const total = items.reduce((s, { v, n }) => s + v.precio * n, 0);
  window.open(wa(`Hola ${CONFIG.NOMBRE_NEGOCIO}, quiero hacer este pedido:\n\n${lineas.join("\n")}\n\nTotal: ${dinero(total)}`), "_blank", "noopener");
}

/* ============================================================
   Lista de pedido
   ============================================================ */
function buscarVariante(k) {
  for (const p of productos) for (const v of p.variantes) if (claveV(p, v) === k) return { p, v };
  return null;
}

function itemsCarrito() {
  return Object.entries(carrito)
    .map(([k, n]) => ({ ...buscarVariante(k), n }))
    .filter((i) => i.p && i.n > 0);
}

function pintarCarrito() {
  const items = itemsCarrito();
  $("contador").textContent = items.reduce((s, i) => s + i.n, 0);
  $("lista").innerHTML = items.length ? items.map(({ p, v, n }) => `
    <li class="item">
      <span class="n">${esc(nombreCompleto(p, v))}</span>
      <div class="cant">
        <button data-menos="${esc(claveV(p, v))}" aria-label="Quitar uno">−</button>
        <span>${n}</span>
        <button data-mas="${esc(claveV(p, v))}" aria-label="Agregar uno">+</button>
      </div>
      <span class="p">${dinero(v.precio)} c/u</span>
    </li>`).join("") : '<li class="vacio">Aún no agregaste productos.</li>';
  $("total").textContent = dinero(items.reduce((s, { v, n }) => s + v.precio * n, 0));
  $("enviarPedido").disabled = !items.length;
}

function cambiarCantidad(k, delta) {
  carrito[k] = Math.max(0, (carrito[k] || 0) + delta);
  if (!carrito[k]) delete carrito[k];
  guardarCarrito(); pintarCarrito();
}

function drawer(abrir) {
  $("drawer").classList.toggle("abierto", abrir);
  $("drawer").setAttribute("aria-hidden", String(!abrir));
  $("velo").hidden = !abrir;
}

function ampliar(src) { if (src) { $("zoomImg").src = src; $("zoomBox").hidden = false; } }

/* ============================================================
   Inicio
   ============================================================ */
async function iniciar() {
  document.title = `Catálogo - ${CONFIG.NOMBRE_NEGOCIO}`;
  $("nombreNegocio").textContent = CONFIG.NOMBRE_NEGOCIO;
  $("pie").textContent = `Pedidos y consultas por WhatsApp: +${CONFIG.WHATSAPP}`;
  cargarCarrito();

  try {
    const url = CONFIG.URL_HOJA_CSV || "productos.csv";
    const sep = url.includes("?") ? "&" : "?";
    const resp = await fetch(`${url}${sep}t=${Date.now()}`);
    if (!resp.ok) throw new Error(resp.status);
    productos = aProductos(parseCSV(await resp.text()));
  } catch (e) {
    $("estado").textContent = "No se pudo cargar el catálogo. Revisa tu conexión o el enlace de la hoja.";
    return;
  }

  // Modelo inicial: el primero que no esté agotado
  productos.forEach((p) => {
    const libre = p.variantes.findIndex((v) => !agotado(v));
    sel[p.id] = libre >= 0 ? libre : 0;
    fotoSel[p.id] = 0;
  });
  Object.keys(carrito).forEach((k) => { if (!buscarVariante(k)) delete carrito[k]; });

  pintarMarcas(); pintarCategorias(); pintarProductos(); pintarCarrito();
}

$("chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]"); if (!b) return;
  categoriaActiva = b.dataset.cat; pintarCategorias(); pintarProductos();
});
$("marcas").addEventListener("click", (e) => {
  const b = e.target.closest("[data-marca]"); if (!b) return;
  marcaActiva = b.dataset.marca; pintarMarcas(); pintarProductos();
});
$("buscador").addEventListener("input", pintarProductos);

$("grid").addEventListener("click", (e) => {
  const mod = e.target.closest("[data-var]");
  if (mod) {
    const [id, i] = mod.dataset.var.split(":");
    sel[id] = Number(i); fotoSel[id] = 0;
    return repintarTarjeta(id, `data-var="${id}:${i}"`);
  }
  const mini = e.target.closest("[data-foto]");
  if (mini) {
    const [id, i] = mini.dataset.foto.split(":");
    fotoSel[id] = Number(i);
    return repintarTarjeta(id, `data-foto="${id}:${i}"`);
  }
  const zoom = e.target.closest("[data-zoom]");
  if (zoom) { const img = zoom.querySelector("img"); return ampliar(img && img.src); }
  const add = e.target.closest("[data-add]");
  if (add) {
    const p = productos.find((x) => x.id === add.dataset.add);
    cambiarCantidad(claveV(p, p.variantes[sel[p.id]]), 1);
    add.textContent = "Agregado";
    setTimeout(() => (add.textContent = "Agregar al pedido"), 900);
  }
});
$("lista").addEventListener("click", (e) => {
  const mas = e.target.closest("[data-mas]"), menos = e.target.closest("[data-menos]");
  if (mas) cambiarCantidad(mas.dataset.mas, 1);
  if (menos) cambiarCantidad(menos.dataset.menos, -1);
});
$("abrirCarrito").addEventListener("click", () => drawer(true));
$("cerrarCarrito").addEventListener("click", () => drawer(false));
$("velo").addEventListener("click", () => drawer(false));
$("vaciar").addEventListener("click", () => { carrito = {}; guardarCarrito(); pintarCarrito(); });
$("enviarPedido").addEventListener("click", enviarPedido);
$("zoomBox").addEventListener("click", () => ($("zoomBox").hidden = true));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { drawer(false); $("zoomBox").hidden = true; } });

iniciar();
