(() => {
  "use strict";
 
  /* Credenciais do lojista: apenas hashes, nunca texto puro.
   * Gerados com customHash() (definida mais abaixo) sobre o e-mail em
   * minúsculas e sobre a senha exata. */
  const ADMIN_EMAIL_HASH = "11372ab8-43c810ba-8129cbd4-5c0baa56-943a53d2-cf5d668a-150e9f55-f3073ccc";
  const ADMIN_PASS_HASH = "7a7678ae-162d72b0-6bd76b3d-4447dd32-34ce4647-88edd0ea-171832f8-0de32e92";
 
  /* EmailJS: envio automático da notinha ao lojista.
   * A Public Key do EmailJS é pública por definição (fica visível no navegador);
   * o destinatário do e-mail é definido no template configurado no painel do EmailJS. */
  const EMAILJS = {
    serviceId: "service_lttutyl",
    templateId: "template_usybrrj",
    publicKey: "12lBHI542YRruwC6L",
  };
  const EMAIL_TIMEOUT_MS = 20000;
 
  /* InfinitePay (Checkout Integrado): a InfiniteTag é pública (vai na URL de pagamento).
   * Nunca coloque X-Api-Key aqui: ela só pode existir em servidor. */
  const INFINITEPAY = {
    endpoint: "https://api.checkout.infinitepay.io/links",
    handle: "jose-mychael-55e",
    timeoutMs: 20000,
    minItemCents: 100,
  };
  const ONLINE_PAYMENTS = ["Crédito", "Débito", "Pix"]; // "Dinheiro" só envia a notinha
 
  /* Firebase: a configuração fica no bloco <script> do index.html */
  const FIREBASE_CONFIG = window.JMP_FIREBASE_CONFIG || {};
  const CONFIG_OK = ["apiKey", "projectId", "appId"].every(
    (k) => typeof FIREBASE_CONFIG[k] === "string" && FIREBASE_CONFIG[k] && !FIREBASE_CONFIG[k].startsWith("COLE_")
  );
 
  /* ============================================================
   * Constantes e utilitários
   * ============================================================ */
  const LS = {
    cart: "jmp.cart.v1",
  };
  const LEGACY_PRODUCTS_KEY = "jmp.products.v1"; // catálogo antigo, só para migração
 
  const CATEGORIES = [
    { id: "todos", label: "Todos" },
    { id: "camisa", label: "Camisas" },
    { id: "calca", label: "Calças" },
    { id: "sapato", label: "Sapatos" },
    { id: "bone", label: "Bonés" },
    { id: "acessorio", label: "Acessórios" },
  ];
 
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
 
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
 
  const storage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (err) {
        console.error(`[storage] leitura falhou (${key})`, err);
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (err) {
        console.error(`[storage] gravação falhou (${key})`, err);
        toast("Não foi possível salvar os dados neste navegador.", "error");
        return false;
      }
    },
  };
 
  const uid = () =>
    (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
 
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const child of [].concat(children)) {
      if (child) node.append(child);
    }
    return node;
  }
 
  /* Máscara monetária (BRL) preenchida da direita para a esquerda:
   * só os dígitos importam, e os dois últimos são os centavos. 23500 -> R$ 235,00 */
  const MAX_PRICE_DIGITS = 7; // R$ 99.999,99, o teto aceito pelas regras do Firestore
 
  function maskPrice(input) {
    const digits = input.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, MAX_PRICE_DIGITS);
    input.value = digits ? brl.format(parseInt(digits, 10) / 100) : "";
  }
 
  function attachPriceMask(input) {
    input.addEventListener("input", () => maskPrice(input));
  }
 
  // Valor numérico (reais) a partir do campo mascarado; NaN se vazio ou zero.
  function maskedToNumber(value) {
    const digits = String(value).replace(/\D/g, "");
    if (!digits) return NaN;
    const reais = parseInt(digits, 10) / 100;
    return reais > 0 ? reais : NaN;
  }
 
  const DATA_IMAGE_RE = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
 
  function safeImageUrl(url) {
    if (!url) return "";
    if (url.startsWith("data:")) return DATA_IMAGE_RE.test(url) ? url : "";
    try {
      const u = new URL(url, location.href);
      return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
    } catch {
      return "";
    }
  }
 
  let toastTimer;
  function toast(msg, kind = "info") {
    const t = $("#toast");
    t.textContent = msg;
    t.dataset.kind = kind;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), kind === "error" ? 5200 : 3200);
  }
 
  /* Botão em processamento: spinner + desabilitado (impede clique duplo) */
  function setBusy(btn, busy, label = "Salvando...") {
    if (!btn) return;
    if (busy) {
      if (btn.dataset.busy === "1") return;
      btn.dataset.busy = "1";
      btn.dataset.label = btn.textContent;
      btn.disabled = true;
      btn.classList.add("is-loading");
      btn.setAttribute("aria-busy", "true");
      btn.replaceChildren(el("span", { class: "spinner", "aria-hidden": "true" }), el("span", { text: label }));
    } else {
      delete btn.dataset.busy;
      btn.disabled = false;
      btn.classList.remove("is-loading");
      btn.removeAttribute("aria-busy");
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
    }
  }
 
  /* Erros por campo: borda vermelha, mensagem abaixo do campo e aria-invalid */
  let fieldErrorSeq = 0;
  const fieldHost = (input) => (input.matches("fieldset") ? input : input.closest("label") || input.parentElement);
 
  function markInvalid(input, message) {
    if (!input) return;
    const host = fieldHost(input);
    let msg = host.querySelector(".field-error");
    if (!msg) {
      msg = el("small", { class: "field-error", id: `fe-${++fieldErrorSeq}` });
      host.append(msg);
    }
    msg.textContent = message;
    input.classList.add("invalid");
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", msg.id);
  }
 
  function clearInvalid(input) {
    if (!input || !input.classList) return;
    input.classList.remove("invalid");
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
    const host = fieldHost(input);
    const msg = host && host.querySelector(".field-error");
    if (msg) msg.remove();
  }
 
  const clearFormErrors = (form) => $$('[aria-invalid="true"]', form).forEach(clearInvalid);
 
  function focusFirstInvalid(form) {
    const first = $('[aria-invalid="true"]', form);
    if (first) {
      (first.matches("fieldset") ? $("input", first) : first).focus();
      first.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
 
  // O erro some assim que o usuário volta a editar o campo
  function watchFormErrors(form) {
    form.addEventListener("input", (e) => {
      if (e.target.getAttribute && e.target.getAttribute("aria-invalid") === "true") clearInvalid(e.target);
    });
  }
 
  const normalizeText = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
 
  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }
 
  /* ============================================================
   * Hash customizado (substituição por tabela de chaves + mistura)
   * Cada caractere é codificado com uma chave da tabela derivada da
   * semente, depende da posição, e alimenta um estado de 8 palavras.
   * ============================================================ */
  const KEY_SEED = "JMP-MENS-STORE-CROWN-2026";
  const KEY_TABLE = (() => {
    let s = 0;
    for (const ch of KEY_SEED) s = (Math.imul(s, 131) + ch.charCodeAt(0)) >>> 0;
    const table = [];
    for (let i = 0; i < 64; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      table.push(s);
    }
    return table;
  })();
 
  const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
 
  function customHash(input) {
    const state = [
      0x4a4d5021, 0x43524f57, 0x474f4c44, 0x53544f52,
      0x4d454e53, 0x4c555845, 0x4b494e47, 0x50524d31,
    ];
    const chars = [...String(input)];
 
    chars.forEach((ch, i) => {
      const code = ch.codePointAt(0);
      const key = KEY_TABLE[(code * 7 + i * 13) % 64];
      const encoded = (Math.imul(code ^ (key & 0xffff), i + 31) + key) >>> 0;
      const slot = i % 8;
      state[slot] = rotl((state[slot] ^ encoded) >>> 0, (code % 23) + 1);
      state[(slot + 3) % 8] = (state[(slot + 3) % 8] + encoded) >>> 0;
    });
 
    state[0] = (state[0] ^ chars.length) >>> 0;
 
    for (let round = 0; round < 16; round++) {
      for (let j = 0; j < 8; j++) {
        const next = (j + 1) % 8;
        const k = KEY_TABLE[state[next] & 63];
        state[j] = (rotl(state[j], ((j * 5 + round) % 31) + 1) ^ k) >>> 0;
        state[next] = (state[next] + state[j]) >>> 0;
      }
    }
 
    return state.map((n) => n.toString(16).padStart(8, "0")).join("-");
  }
 
  /* ============================================================
   * Imagens neutras (sem fotos geradas)
   * Placeholder de silhueta; o lojista troca pela foto real via URL.
   * ============================================================ */
  const SHAPES = {
    camisa: "M60 40 L85 30 Q100 45 115 30 L140 40 L165 70 L145 85 L135 75 L135 165 L65 165 L65 75 L55 85 L35 70 Z",
    calca: "M65 35 L135 35 L145 170 L108 170 L100 80 L92 170 L55 170 Z",
    sapato: "M25 130 L25 88 L68 94 L92 116 L150 120 Q178 126 178 146 L178 152 L25 152 Z",
    bone: "M38 118 Q38 58 100 58 Q162 58 162 118 L192 128 Q150 136 100 130 L38 130 Z",
    acessorio: "M82 28 H118 L122 62 A44 44 0 1 1 78 62 Z M100 82 V108 L116 118",
    combo: "M30 70 L48 62 Q58 72 68 62 L86 70 L100 90 L88 98 L82 92 L82 150 L40 150 L40 92 L34 98 L22 90 Z M112 120 Q112 86 140 86 Q168 86 168 120 L186 126 Q160 132 140 128 L112 128 Z",
  };
 
  function placeholderImage(category, isCombo) {
    const shape = SHAPES[isCombo ? "combo" : category] || SHAPES.acessorio;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 250">` +
      `<rect width="200" height="250" fill="#f1e9d6"/>` +
      `<g transform="translate(0 25)" fill="none" stroke="#b8923a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"><path d="${shape}"/></g>` +
      `</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }
 
  /* ============================================================
   * Estado: catálogo (vem da nuvem) e carrinho (local de cada visitante)
   * ============================================================ */
  const CATEGORY_IDS = CATEGORIES.map((c) => c.id).filter((id) => id !== "todos");
 
  let products = [];
  let catalogReady = false;    // true após o primeiro retorno do Firestore
  let storeEmail = "";         // e-mail do lojista que recebe pedidos (vem da nuvem)
  let pixKey = "";             // chave Pix do lojista (pública, vem da nuvem)
  let pixQr = "";              // QR Code Pix do lojista, imagem em data URL (vem da nuvem)
  const seenIds = new Set();   // cards já exibidos: não repetem a animação de entrada
  let auth = null;
  let db = null;
  let persistenceReady = Promise.resolve();
 
  let cart = storage.get(LS.cart, []);
  if (!Array.isArray(cart)) cart = [];
 
  const saveCart = () => storage.set(LS.cart, cart);
  const imageFor = (p) => safeImageUrl(p.imagem) || placeholderImage(p.categoria, p.combo);
  const findProduct = (id) => products.find((p) => p.id === id);
 
  /* ============================================================
   * Animações de entrada (IntersectionObserver)
   * ============================================================ */
  const revealObserver = "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              revealObserver.unobserve(entry.target);
            }
          }
        },
        { threshold: 0.12 }
      )
    : null;
 
  function observeReveal(node, index) {
    node.style.transitionDelay = `${(index % 4) * 90}ms`;
    if (revealObserver) revealObserver.observe(node);
    else node.classList.add("is-visible");
  }
 
  /* ============================================================
   * Catálogo
   * ============================================================ */
  let activeCategory = "todos";
  let searchRaw = "";
  let searchTerm = "";          // busca normalizada (sem acento, minúscula)
  let sortMode = "recentes";
  let catalogLoading = false;   // true enquanto aguarda o primeiro retorno do Firestore
 
  const SORTERS = {
    recentes: (a, b) => b.createdAt - a.createdAt,
    menor: (a, b) => a.preco - b.preco || b.createdAt - a.createdAt,
    maior: (a, b) => b.preco - a.preco || b.createdAt - a.createdAt,
  };
 
  const matchesSearch = (p) => !searchTerm || normalizeText(`${p.nome} ${p.comboDesc}`).includes(searchTerm);
 
  function skeletonCard() {
    return el("div", { class: "product skeleton is-visible", "aria-hidden": "true" }, [
      el("div", { class: "sk sk-media" }),
      el("div", { class: "product__body" }, [
        el("div", { class: "sk sk-line sk-line--lg" }),
        el("div", { class: "sk sk-line sk-line--sm" }),
        el("div", { class: "sk sk-price" }),
        el("div", { class: "sk sk-btn" }),
      ]),
    ]);
  }
 
  function productCard(p, index) {
    const img = el("img", { src: imageFor(p), alt: p.nome, loading: "lazy", width: "400", height: "500" });
    img.addEventListener("error", () => {
      img.src = placeholderImage(p.categoria, p.combo);
    }, { once: true });
 
    const tags = [
      p.promo ? el("span", { class: "promo-tag", text: "Promoção" }) : null,
      p.combo ? el("span", { class: "combo-tag", text: "Super Combo" }) : null,
    ].filter(Boolean);
 
    const media = el("div", { class: "product__media" }, [
      tags.length ? el("div", { class: "product__tags" }, tags) : null,
      img,
    ]);
 
    const body = el("div", { class: "product__body" }, [
      el("h3", { class: "product__name", text: p.nome }),
      p.combo && p.comboDesc ? el("p", { class: "product__desc", text: p.comboDesc }) : null,
      el("p", { class: "product__price", text: brl.format(p.preco) }),
      el("button", {
        class: "btn btn--gold btn--block",
        type: "button",
        text: "Adicionar ao carrinho",
        onclick: () => addToCart(p.id),
      }),
    ]);
 
    const card = el("article", {
      class: `product${p.combo ? " product--combo" : ""}${p.promo ? " product--promo" : ""}`,
    }, [media, body]);
    if (seenIds.has(p.id)) card.classList.add("is-visible");
    else observeReveal(card, index);
    return card;
  }
 
  function renderFilters() {
    const wrap = $("#filters");
    wrap.replaceChildren(
      ...CATEGORIES.map((c) =>
        el("button", {
          class: `chip${c.id === activeCategory ? " is-active" : ""}`,
          type: "button",
          text: c.label,
          "aria-pressed": String(c.id === activeCategory),
          onclick: () => {
            activeCategory = c.id;
            renderFilters();
            renderCatalog();
          },
        })
      )
    );
  }
 
  function renderCatalog() {
    const grid = $("#productGrid");
    const emptyMsg = $("#emptyMsg");
 
    // Enquanto o Firestore não responde: esqueleto dos cards em vez de tela vazia
    if (catalogLoading && !catalogReady) {
      $("#promocoes").hidden = true;
      $("#combos").hidden = true;
      grid.setAttribute("aria-busy", "true");
      grid.replaceChildren(...Array.from({ length: 8 }, skeletonCard));
      emptyMsg.hidden = true;
      return;
    }
    grid.removeAttribute("aria-busy");
 
    // Busca e ordenação valem para promoções, combos e coleção; a categoria só para a coleção
    const sorter = SORTERS[sortMode] || SORTERS.recentes;
    const found = products.filter(matchesSearch);
    const promos = found.filter((p) => p.promo).sort(sorter);
    const combos = found.filter((p) => p.combo && !p.promo).sort(sorter);
    const regular = found
      .filter((p) => !p.promo && !p.combo && (activeCategory === "todos" || p.categoria === activeCategory))
      .sort(sorter);
 
    $("#promocoes").hidden = promos.length === 0;
    $("#promoGrid").replaceChildren(...promos.map(productCard));
    $("#combos").hidden = combos.length === 0;
    $("#comboGrid").replaceChildren(...combos.map(productCard));
    grid.replaceChildren(...regular.map(productCard));
 
    let msg = "";
    if (products.length === 0) msg = "Nenhum produto cadastrado ainda.";
    else if (searchTerm && !promos.length && !combos.length && !regular.length) msg = `Nenhum produto encontrado para "${searchRaw}".`;
    else if (!regular.length) {
      if (searchTerm) msg = "Os resultados da busca estão nas seções acima.";
      else if (activeCategory !== "todos") msg = "Nenhum produto nesta categoria.";
    }
    emptyMsg.textContent = msg;
    emptyMsg.hidden = !catalogReady || !msg;
  }
 
  /* ============================================================
   * Carrinho
   * ============================================================ */
  const drawer = $("#drawer");
  const overlay = $("#overlay");
 
  function cartCount() {
    return cart.reduce((sum, i) => sum + i.qty, 0);
  }
 
  function cartLines() {
    return cart
      .map((i) => ({ product: findProduct(i.id), qty: i.qty }))
      .filter((l) => l.product);
  }
 
  function cartTotal() {
    return cartLines().reduce((sum, l) => sum + l.product.preco * l.qty, 0);
  }
 
  function addToCart(id) {
    const item = cart.find((i) => i.id === id);
    if (item) item.qty += 1;
    else cart.push({ id, qty: 1 });
    saveCart();
    renderCart();
    bumpCart();
    toast("Item adicionado ao carrinho.");
  }
 
  function bumpCart() {
    const btn = $("#cartBtn");
    const badge = $("#cartBadge");
    for (const node of [btn, badge]) {
      node.classList.remove("bump", "pulse");
      void node.offsetWidth;
    }
    btn.classList.add("bump");
    badge.classList.add("pulse");
  }
 
  function changeQty(id, delta) {
    const item = cart.find((i) => i.id === id);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) cart = cart.filter((i) => i.id !== id);
    saveCart();
    renderCart();
  }
 
  function removeFromCart(id) {
    cart = cart.filter((i) => i.id !== id);
    saveCart();
    renderCart();
  }
 
  function renderCart() {
    // Remove do carrinho itens cujo produto foi excluído pelo lojista.
    // Só depois do primeiro retorno da nuvem, senão o carrinho seria apagado no carregamento.
    if (catalogReady) {
      const valid = cart.filter((i) => findProduct(i.id));
      if (valid.length !== cart.length) {
        cart = valid;
        saveCart();
      }
    }
 
    const count = cartCount();
    const badge = $("#cartBadge");
    badge.textContent = String(count);
    badge.hidden = count === 0;
 
    const body = $("#cartItems");
    const lines = cartLines();
 
    if (!lines.length) {
      body.replaceChildren(el("p", { class: "cart-empty", text: "Seu carrinho está vazio." }));
    } else {
      body.replaceChildren(
        ...lines.map(({ product: p, qty }) => {
          const img = el("img", { src: imageFor(p), alt: p.nome, width: "72", height: "90" });
          img.addEventListener("error", () => { img.src = placeholderImage(p.categoria, p.combo); }, { once: true });
          return el("div", { class: "cart-item" }, [
            img,
            el("div", {}, [
              el("p", { class: "cart-item__name", text: p.nome }),
              el("p", { class: "cart-item__price", text: brl.format(p.preco) }),
              el("div", { class: "qty" }, [
                el("button", { type: "button", "aria-label": "Diminuir quantidade", text: "-", onclick: () => changeQty(p.id, -1) }),
                el("span", { text: String(qty) }),
                el("button", { type: "button", "aria-label": "Aumentar quantidade", text: "+", onclick: () => changeQty(p.id, 1) }),
              ]),
            ]),
            el("button", { class: "cart-item__remove", type: "button", text: "Remover", onclick: () => removeFromCart(p.id) }),
          ]);
        })
      );
    }
 
    $("#cartTotal").textContent = brl.format(cartTotal());
    $("#checkoutBtn").disabled = lines.length === 0;
  }
 
  function openCart() {
    overlay.hidden = false;
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    $("#closeCart").focus();
  }
 
  function closeCart() {
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    overlay.hidden = true;
  }
 
  /* ============================================================
   * Checkout e resumo do pedido
   * O endereço vive só em memória (variável local) e é descartado.
   * ============================================================ */
  const dlgCheckout = $("#dlgCheckout");
  const dlgOrder = $("#dlgOrder");
  const checkoutForm = $("#checkoutForm");
  watchFormErrors(checkoutForm);
 
  function openCheckout() {
    if (!cartLines().length) return;
    closeCart();
    checkoutForm.reset();
    $("#checkoutError").hidden = true;
    clearFormErrors(checkoutForm);
    $("#dlgCheckout .modal__body").scrollTop = 0;
    dlgCheckout.showModal();
  }
 
  function formatCep(value) {
    const d = value.replace(/\D/g, "").slice(0, 8);
    return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
  }
 
  function formatPhone(value) {
    const d = value.replace(/\D/g, "").slice(0, 11);
    if (d.length === 0) return "";
    if (d.length <= 2) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
 
  // DDD válido (11 a 99) + 8 dígitos começando em 2 a 5 (fixo) ou 9 dígitos começando em 9 (celular)
  function isValidPhone(value) {
    const d = value.replace(/\D/g, "");
    if (d.length !== 10 && d.length !== 11) return false;
    if (!/^[1-9][1-9]$/.test(d.slice(0, 2))) return false;
    return d.length === 10 ? /^[2-5]$/.test(d[2]) : d[2] === "9";
  }
 
  const PAYMENT_METHODS = ["Crédito", "Débito", "Pix", "Dinheiro"];
 
  function readAddress(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const clean = (v) => String(v || "").trim().replace(/\s+/g, " ");
    return {
      nome: clean(data.nome),
      telefone: clean(data.telefone),
      cep: clean(data.cep),
      rua: clean(data.rua),
      numero: clean(data.numero),
      complemento: clean(data.complemento),
      bairro: clean(data.bairro),
      cidade: clean(data.cidade),
      uf: clean(data.uf).toUpperCase(),
      pagamento: PAYMENT_METHODS.includes(data.pagamento) ? data.pagamento : "",
    };
  }
 
  const ADDRESS_MESSAGES = {
    nome: "Informe nome e sobrenome.",
    telefone: "Telefone inválido. Use DDD + número, ex.: (11) 91234-5678.",
    cep: "CEP inválido. Use 8 dígitos, ex.: 01001-000.",
    rua: "Informe a rua.",
    numero: "Informe o número.",
    bairro: "Informe o bairro.",
    cidade: "Informe a cidade.",
    uf: "Use a sigla do estado, ex.: SP.",
    pagamento: "Escolha uma forma de pagamento.",
  };
 
  function validateAddress(a) {
    const errors = [];
    if (a.nome.length < 3) errors.push("nome");
    if (!isValidPhone(a.telefone)) errors.push("telefone");
    if (!/^\d{5}-?\d{3}$/.test(a.cep)) errors.push("cep");
    if (a.rua.length < 3) errors.push("rua");
    if (!a.numero) errors.push("numero");
    if (a.bairro.length < 2) errors.push("bairro");
    if (a.cidade.length < 2) errors.push("cidade");
    if (!/^[A-Z]{2}$/.test(a.uf)) errors.push("uf");
    if (!a.pagamento) errors.push("pagamento");
    return errors;
  }
 
  // Endereço completo (o nome do cliente aparece à parte, na seção Cliente)
  function addressText(a) {
    return [
      `${a.rua}, ${a.numero}${a.complemento ? ` - ${a.complemento}` : ""}`,
      `${a.bairro} - ${a.cidade}/${a.uf}`,
      `CEP ${a.cep}`,
    ].join("\n");
  }
 
  // Notinha do lojista: cliente, telefone, endereço, produtos, pagamento e total
  function buildOrderText(lines, total, a) {
    const items = lines.map(({ product: p, qty }, i) =>
      [
        `${i + 1}. ${p.nome}${p.combo && p.comboDesc ? ` (${p.comboDesc})` : ""}`,
        `   Quantidade: ${qty}`,
        `   Valor unitário: ${brl.format(p.preco)}`,
        `   Subtotal: ${brl.format(p.preco * qty)}`,
      ].join("\n")
    );
    return [
      "NOVO PEDIDO - JMP Men's Store",
      "",
      "CLIENTE",
      `Nome: ${a.nome}`,
      `Telefone (WhatsApp): ${a.telefone}`,
      "",
      "ENDEREÇO DE ENTREGA",
      addressText(a),
      "",
      "PRODUTOS",
      items.join("\n\n"),
      "",
      `FORMA DE PAGAMENTO: ${a.pagamento}`,
      `VALOR TOTAL: ${brl.format(total)}`,
    ].join("\n");
  }
 
  // Endereço em uma linha só (campo client_address do template)
  function addressOneLine(a) {
    return `${a.rua}, ${a.numero}${a.complemento ? ` - ${a.complemento}` : ""}, ${a.bairro}, ${a.cidade}/${a.uf}, CEP ${a.cep}`;
  }
 
  // Exatamente os 6 parâmetros do template do EmailJS
  function buildEmailParams(lines, total, a, orderNsu) {
    return {
      client_name: a.nome,
      client_phone: a.telefone,
      client_address: addressOneLine(a),
      payment_method: ONLINE_PAYMENTS.includes(a.pagamento)
        ? `${a.pagamento} via InfinitePay - AGUARDANDO CONFIRMACAO DO PAGAMENTO - Pedido ${orderNsu}`
        : a.pagamento,
      order_items: lines
        .map(({ product: p, qty }) =>
          `${qty}x ${p.nome}${p.combo && p.comboDesc ? ` (${p.comboDesc})` : ""} - ${brl.format(p.preco)} cada - subtotal ${brl.format(p.preco * qty)}`
        )
        .join("\n"),
      order_total: brl.format(total),
    };
  }
 
  let pendingOrder = null;   // pedido aguardando envio (só em memória; nada é gravado)
  let orderSending = false;  // trava de envio em andamento
 
  const orderBlock = (title, ...children) => el("section", { class: "order-block" }, [el("h3", { text: title }), ...children]);
 
  function showOrder(lines, total, a) {
    const summary = $("#orderSummary");
    summary.replaceChildren(
      orderBlock("Cliente", el("dl", { class: "order-dl" }, [
        el("dt", { text: "Nome" }), el("dd", { text: a.nome }),
        el("dt", { text: "Telefone" }), el("dd", { text: a.telefone }),
      ])),
      orderBlock("Endereço de entrega", el("div", { class: "order-addr", text: addressText(a) })),
      orderBlock("Produtos", ...lines.map(({ product: p, qty }) => {
        const img = el("img", { src: imageFor(p), alt: "", width: "56", height: "70" });
        img.addEventListener("error", () => { img.src = placeholderImage(p.categoria, p.combo); }, { once: true });
        return el("div", { class: "order-line" }, [
          img,
          el("div", { class: "order-line__name" }, [
            el("span", { text: p.nome }),
            el("small", { text: `${qty} x ${brl.format(p.preco)}` }),
          ]),
          el("strong", { text: brl.format(p.preco * qty) }),
        ]);
      })),
      orderBlock("Forma de pagamento", el("p", { class: "order-pay", text: a.pagamento })),
      el("div", { class: "order-total" }, [el("span", { text: "Valor total" }), el("strong", { text: brl.format(total) })])
    );
 
    const text = buildOrderText(lines, total, a);
    const online = ONLINE_PAYMENTS.includes(a.pagamento);
    const orderNsu = newOrderNsu();
    pendingOrder = { lines, total, address: a, text, online, orderNsu, checkoutUrl: null, params: buildEmailParams(lines, total, a, orderNsu) };
    setOrderError("");
 
    // Alternativa se o envio automático falhar: abrir o e-mail do cliente já preenchido
    const subject = encodeURIComponent(`Novo pedido - JMP Men's Store - ${brl.format(total)}`);
    const fallback = $("#mailFallback");
    fallback.href = `mailto:${encodeURIComponent(storeEmail)}?subject=${subject}&body=${encodeURIComponent(text)}`;
    fallback.hidden = true;
    setBusy($("#mailOrder"), false);
    $("#mailOrder").textContent = online ? "Ir para o pagamento" : "Enviar pedido ao lojista";
 
    $("#orderEmailHint").textContent = online
      ? "Ao continuar, o pedido é enviado ao lojista e você é levado ao ambiente seguro da InfinitePay para concluir o pagamento."
      : "O pedido será enviado automaticamente ao lojista. O pagamento em dinheiro é feito na entrega.";
 
    $("#copyOrder").onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast("Resumo copiado.");
      } catch (err) {
        console.error("[clipboard]", err);
        toast("Não foi possível copiar automaticamente.", "error");
      }
    };
 
    $("#dlgOrder .modal__body").scrollTop = 0;
    dlgOrder.showModal();
  }
 
  /* ---------- Envio automático da notinha (EmailJS) ---------- */
  function setOrderError(msg) {
    const box = $("#orderSendError");
    box.textContent = msg;
    box.hidden = !msg;
  }
 
  function emailErrorMessage(error) {
    const status = error && typeof error.status === "number" ? error.status : null;
    if (error && error.code === "timeout") return "O serviço de e-mail não respondeu. Verifique sua conexão e tente de novo.";
    if (status === 0 || status === null) return "Sem conexão com o serviço de e-mail. Verifique sua internet e tente de novo.";
    if (status === 429) return "Muitos envios em pouco tempo. Aguarde um minuto e tente de novo.";
    if (status >= 500) return "O serviço de e-mail está instável. Tente de novo em instantes.";
    return `O serviço de e-mail recusou o envio (código ${status}). Use as opções abaixo ou avise o lojista.`;
  }
 
  function showSendFailure(message) {
    setOrderError(`${message} Seu carrinho foi mantido.`);
    const fallback = $("#mailFallback");
    fallback.hidden = !storeEmail; // sem e-mail cadastrado, resta o botão Copiar resumo
    // No celular o erro nasce abaixo da dobra: leva o cliente até ele
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    $("#orderSendError").scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "auto" });
  }
 
  /* ---------- InfinitePay: criação do link de checkout ---------- */
  class PaymentError extends Error {
    constructor(message, status = null) {
      super(message);
      this.name = "PaymentError";
      this.status = status;
    }
  }
 
  // Identificador do pedido (order_nsu): único, só letras, números e hífen
  function newOrderNsu() {
    const rand = window.crypto && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 4294967296);
    return `jmp-${Date.now().toString(36)}-${rand.toString(36)}`;
  }
 
  const toCents = (value) => Math.round(Number(value) * 100);
 
  function buildInfinitePayBody(order, full) {
    const a = order.address;
    const body = {
      handle: INFINITEPAY.handle,
      order_nsu: order.orderNsu,
      items: order.lines.map(({ product: p, qty }) => ({
        quantity: qty,
        price: toCents(p.preco), // centavos, inteiro: R$ 100,00 = 10000
        description: String(p.nome).slice(0, 120),
      })),
    };
    if (/^https?:$/.test(location.protocol)) {
      body.redirect_url = `${location.origin}${location.pathname}`;
    }
    if (full) {
      body.customer = { name: a.nome, phone_number: `+55${a.telefone.replace(/\D/g, "")}` };
      body.address = {
        cep: a.cep.replace(/\D/g, ""),
        street: a.rua,
        number: a.numero,
        neighborhood: a.bairro,
        city: a.cidade,
        state: a.uf,
        ...(a.complemento ? { complement: a.complemento } : {}),
      };
    }
    return body;
  }
 
  // Só aceita https em domínio da InfinitePay (evita redirecionar para destino inesperado)
  function safeCheckoutUrl(value) {
    if (typeof value !== "string") return "";
    try {
      const u = new URL(value);
      const okHost = u.hostname === "infinitepay.io" || u.hostname.endsWith(".infinitepay.io");
      return u.protocol === "https:" && okHost ? u.href : "";
    } catch {
      return "";
    }
  }
 
  // O formato da resposta não é documentado: tenta os nomes prováveis e, por fim, qualquer URL válida no JSON
  function extractCheckoutUrl(data) {
    if (!data || typeof data !== "object") return "";
    for (const key of ["url", "checkout_url", "checkoutUrl", "link", "checkout_link", "payment_url", "payment_link"]) {
      const ok = safeCheckoutUrl(data[key]);
      if (ok) return ok;
    }
    for (const value of Object.values(data)) {
      const ok = safeCheckoutUrl(value) || (value && typeof value === "object" && !Array.isArray(value) ? extractCheckoutUrl(value) : "");
      if (ok) return ok;
    }
    return "";
  }
 
  async function postInfinitePay(body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), INFINITEPAY.timeoutMs);
    let res;
    try {
      res = await fetch(INFINITEPAY.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (error) {
      if (error && error.name === "AbortError") throw new PaymentError("timeout");
      throw new PaymentError("network"); // sem internet ou bloqueio de CORS
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch { /* corpo não-JSON */ }
    if (!res.ok) throw new PaymentError("http", res.status);
    return data;
  }
 
  async function createCheckoutLink(order) {
    const tooLow = order.lines.find(({ product: p }) => toCents(p.preco) < INFINITEPAY.minItemCents);
    if (tooLow) throw new PaymentError("min", null);
    let data;
    try {
      data = await postInfinitePay(buildInfinitePayBody(order, true));
    } catch (error) {
      // Dados opcionais recusados (validação): tenta uma vez só com o essencial
      if (error instanceof PaymentError && error.message === "http" && (error.status === 400 || error.status === 422)) {
        data = await postInfinitePay(buildInfinitePayBody(order, false));
      } else {
        throw error;
      }
    }
    const url = extractCheckoutUrl(data);
    if (!url) throw new PaymentError("no-link");
    return url;
  }
 
  function paymentErrorMessage(error) {
    if (!(error instanceof PaymentError)) return "Não foi possível iniciar o pagamento. Tente de novo.";
    switch (error.message) {
      case "timeout": return "O pagamento demorou para responder. Verifique sua conexão e tente de novo.";
      case "network": return "Não foi possível conectar ao pagamento. Verifique sua internet e tente de novo.";
      case "min": return "Há um item com valor abaixo do mínimo aceito para pagamento online (R$ 1,00).";
      case "no-link": return "O pagamento não devolveu um link válido. Tente de novo ou fale com o lojista.";
      default: return error.status === 429
        ? "Muitas tentativas em pouco tempo. Aguarde um minuto e tente de novo."
        : `O pagamento recusou o pedido (código ${error.status}). Tente de novo ou fale com o lojista.`;
    }
  }
 
  function setBusyLabel(btn, label) {
    const span = btn.querySelector("span:last-child");
    if (span) span.textContent = label;
  }
 
  function releaseOrderUi() {
    orderSending = false;
    setBusy($("#mailOrder"), false);
    $("#copyOrder").disabled = false;
    $("#dlgOrder .icon-btn").disabled = false;
  }
 
  /* Fluxo: (1) cria o link na InfinitePay, (2) envia a notinha pelo EmailJS,
   * (3) só então redireciona. Falha no passo 1 ou 2 não redireciona nem esvazia o carrinho.
   * O link criado fica guardado em pendingOrder para o "tentar de novo" não gerar outro. */
  async function sendOrder() {
    if (!pendingOrder || orderSending) return;
    const btn = $("#mailOrder");
    const order = pendingOrder;
    setOrderError("");
 
    if (!window.emailjs || typeof window.emailjs.send !== "function") {
      console.error("[emailjs] SDK não carregou");
      showSendFailure("O serviço de envio não carregou (bloqueador de anúncios ou conexão).");
      return;
    }
 
    orderSending = true;
    setBusy(btn, true, order.online ? "Gerando pagamento..." : "Enviando pedido...");
    $("#copyOrder").disabled = true;
    $("#dlgOrder .icon-btn").disabled = true;
 
    try {
      if (order.online && !order.checkoutUrl) {
        try {
          order.checkoutUrl = await createCheckoutLink(order);
        } catch (error) {
          console.error("[infinitepay]", error);
          showSendFailure(paymentErrorMessage(error));
          releaseOrderUi();
          return;
        }
        setBusyLabel(btn, "Enviando pedido...");
      }
 
      try {
        await withTimeout(
          window.emailjs.send(EMAILJS.serviceId, EMAILJS.templateId, order.params, EMAILJS.publicKey),
          EMAIL_TIMEOUT_MS
        );
      } catch (error) {
        console.error("[emailjs]", error);
        showSendFailure(emailErrorMessage(error));
        releaseOrderUi();
        return;
      }
    } catch (error) {
      console.error("[checkout]", error);
      showSendFailure("Ocorreu um erro inesperado. Tente de novo.");
      releaseOrderUi();
      return;
    }
 
    // Notinha enviada: o pedido está registrado, então o carrinho pode ser esvaziado
    pendingOrder = null;
    cart = [];
    saveCart();
    renderCart();
    checkoutForm.reset();
 
    if (order.online) {
      setBusyLabel(btn, "Redirecionando...");
      window.location.assign(order.checkoutUrl); // orderSending segue true: o modal fica travado até sair da página
      return;
    }
    releaseOrderUi();
    dlgOrder.close();
    $("#dlgSuccess").showModal();
  }
 
  // Voltar pelo botão do navegador (cache de página) não pode deixar o modal travado
  window.addEventListener("pageshow", (e) => {
    if (e.persisted && orderSending) {
      releaseOrderUi();
      if (dlgOrder.open) dlgOrder.close();
    }
  });
 
  // Retorno do checkout da InfinitePay (redirect_url): só agradece, não prova pagamento
  (() => {
    const q = new URLSearchParams(location.search);
    if (!q.has("order_nsu") || !(q.has("receipt_url") || q.has("transaction_nsu") || q.has("slug"))) return;
    history.replaceState(null, "", location.pathname + location.hash);
    setTimeout(() => toast("Obrigado! O lojista vai confirmar o seu pagamento e combinar a entrega."), 600);
  })();
 
  $("#mailOrder").addEventListener("click", sendOrder);
  dlgOrder.addEventListener("cancel", (e) => { if (orderSending) e.preventDefault(); }); // Esc não fecha durante o envio
 
  $$('input[name="pagamento"]', checkoutForm).forEach((radio) =>
    radio.addEventListener("change", () => clearInvalid($("#payChoice")))
  );
 
  checkoutForm.elements.cep.addEventListener("input", (e) => {
    e.target.value = formatCep(e.target.value);
  });
  checkoutForm.elements.telefone.addEventListener("input", (e) => {
    e.target.value = formatPhone(e.target.value);
  });
  checkoutForm.elements.uf.addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase();
  });
 
  checkoutForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const address = readAddress(checkoutForm);
    const errors = validateAddress(address);
 
    clearFormErrors(checkoutForm);
    const errBox = $("#checkoutError");
 
    if (errors.length) {
      errors.forEach((name) =>
        markInvalid(name === "pagamento" ? $("#payChoice") : checkoutForm.elements[name], ADDRESS_MESSAGES[name])
      );
      errBox.textContent = errors.length === 1 ? "Revise o campo destacado." : `Revise os ${errors.length} campos destacados.`;
      errBox.hidden = false;
      focusFirstInvalid(checkoutForm);
      return;
    }
 
    const lines = cartLines();
    const total = cartTotal();
    if (!lines.length) return;
 
    errBox.hidden = true;
    dlgCheckout.close();
    showOrder(lines, total, address);
    // O carrinho só é esvaziado depois que o envio do pedido for confirmado (sendOrder).
    // Nome, telefone e endereço ficam apenas em memória.
    checkoutForm.reset();
  });
 
  /* ============================================================
   * Modais genéricos
   * ============================================================ */
  $$("[data-open]").forEach((btn) =>
    btn.addEventListener("click", () => document.getElementById(btn.dataset.open).showModal())
  );
  $$("dialog").forEach((dlg) => {
    dlg.addEventListener("click", (e) => {
      if (dlg.id === "dlgOrder" && orderSending) return; // envio em andamento
      if (e.target === dlg) dlg.close();
      if (e.target.closest("[data-close]")) dlg.close();
    });
  });
 
  /* ============================================================
   * Painel administrativo
   * ============================================================ */
  const adminSection = $("#admin");
  const authForm = $("#authForm");
  const authError = $("#authError");
 
  const isLogged = () => Boolean(auth && auth.currentUser);
 
  function showAuthError(msg) {
    authError.textContent = msg;
    authError.hidden = !msg;
  }
 
  function renderAuthMode() {
    const logged = isLogged();
 
    $("#authCard").hidden = logged;
    $("#panel").hidden = !logged;
    $("#adminLogout").hidden = !logged;
 
    if (logged) {
      renderAdminRows();
      $("#settingsForm").elements.storeEmail.value = storeEmail;
      renderPixAdmin();
    }
    renderLegacyBox();
  }
 
  function openAdmin() {
    adminSection.hidden = false;
    document.body.style.overflow = "hidden";
    showAuthError("");
    authForm.reset();
    renderAuthMode();
  }
 
  function closeAdmin() {
    adminSection.hidden = true;
    document.body.style.overflow = "";
    if (location.hash === "#admin") history.replaceState(null, "", "#top");
  }
 
  const loginBtn = $("button[type=submit]", authForm);
  const MAX_ATTEMPTS = 5;
  const LOCK_MS = 30000;
  let failedAttempts = 0;
  let lockedUntil = 0;
 
  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showAuthError("");
 
    if (loginBtn.dataset.busy === "1") return; // login em andamento
    const now = Date.now();
    if (now < lockedUntil) {
      showAuthError(`Muitas tentativas. Aguarde ${Math.ceil((lockedUntil - now) / 1000)} segundos.`);
      return;
    }
 
    const email = authForm.elements.email.value.trim().toLowerCase();
    const senha = authForm.elements.senha.value;
 
    // Camada 1: conferência por hash (mensagem imediata, sem revelar qual campo falhou).
    const emailOk = customHash(email) === ADMIN_EMAIL_HASH;
    const passOk = customHash(senha) === ADMIN_PASS_HASH;
 
    if (emailOk && passOk) {
      if (!auth) {
        showAuthError("Painel indisponível: Firebase não configurado ou não carregado. Veja o guia de configuração.");
        return;
      }
      // Camada 2 (a que realmente protege o banco): login no Firebase Auth.
      setBusy(loginBtn, true, "Entrando...");
      try {
        await persistenceReady;
        await auth.signInWithEmailAndPassword(email, senha);
        failedAttempts = 0;
        authForm.reset();
        renderAuthMode();
        toast("Bem-vindo");
        return;
      } catch (error) {
        console.error("[auth]", error);
        const code = (error && error.code) || "";
        if (code === "auth/network-request-failed") {
          showAuthError("Sem conexão com a nuvem. Tente novamente.");
          return;
        }
        if (["auth/invalid-credential", "auth/user-not-found", "auth/wrong-password", "auth/invalid-login-credentials"].includes(code)) {
          // Só chega aqui quem digitou os dados corretos (hash confere): vale orientar.
          showAuthError("Dados corretos, mas o Firebase recusou o login. Crie este usuário em Authentication (Passo 5 do guia).");
          return;
        }
        showAuthError(`Não foi possível entrar (${code || "erro desconhecido"}).`);
        return;
      } finally {
        setBusy(loginBtn, false);
      }
    }
 
    failedAttempts += 1;
    authForm.elements.senha.value = "";
    if (failedAttempts >= MAX_ATTEMPTS) {
      lockedUntil = Date.now() + LOCK_MS;
      failedAttempts = 0;
    }
    showAuthError("Acesso Negado: Credenciais Inválidas");
    window.alert("Acesso Negado: Credenciais Inválidas");
  });
 
  $("#adminLogout").addEventListener("click", () => {
    if (auth) auth.signOut().catch((error) => console.error("[auth]", error));
  });
  $("#adminBack").addEventListener("click", closeAdmin);
 
  // Formulário de produto
  const productForm = $("#productForm");
  watchFormErrors(productForm);
  attachPriceMask(productForm.elements.preco);
  productForm.elements.combo.addEventListener("change", (e) => {
    $("#comboLabelWrap").hidden = !e.target.checked;
  });
 
  /* ---------- Upload de foto: arquivo -> canvas -> JPEG em Base64 ---------- */
  const MAX_INPUT_BYTES = 15 * 1024 * 1024;
  const MAX_SIDE = 800;
  const JPEG_QUALITY = 0.78;
  const MAX_DOC_IMAGE = 900000; // o documento do Firestore aceita ~1 MiB
  const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
 
  const photoInput = $("#productPhoto");
  const photoName = $("#photoName");
  const photoPreview = $("#photoPreview");
  const photoClear = $("#photoClear");
 
  let photoData = "";            // Base64 pronto para salvar
  let photoTask = Promise.resolve();
 
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(objectUrl); resolve(img); };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Não foi possível ler esta imagem. Use JPG, PNG ou WEBP."));
      };
      img.src = objectUrl;
    });
  }
 
  async function fileToBase64(file) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      throw new Error("Formato não suportado. Use JPG, PNG, WEBP ou GIF.");
    }
    if (file.size > MAX_INPUT_BYTES) {
      throw new Error("A imagem é grande demais (máximo 15 MB).");
    }
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
 
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; // PNG com transparência vira fundo branco no JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
 
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    if (!DATA_IMAGE_RE.test(dataUrl)) throw new Error("Falha ao converter a imagem.");
    return dataUrl;
  }
 
  function resetPhoto() {
    photoData = "";
    photoInput.value = "";
    photoName.textContent = "Nenhum arquivo selecionado";
    photoPreview.hidden = true;
    photoPreview.removeAttribute("src");
    photoClear.hidden = true;
  }
 
  photoInput.addEventListener("change", () => {
    const file = photoInput.files && photoInput.files[0];
    const err = $("#productError");
    err.hidden = true;
    if (!file) { resetPhoto(); return; }
 
    photoName.replaceChildren(el("span", { class: "spinner spinner--dark", "aria-hidden": "true" }), document.createTextNode(`Processando ${file.name}...`));
    photoTask = fileToBase64(file)
      .then((dataUrl) => {
        photoData = dataUrl;
        photoName.textContent = file.name;
        photoPreview.src = dataUrl;
        photoPreview.hidden = false;
        photoClear.hidden = false;
      })
      .catch((error) => {
        console.error("[upload]", error);
        resetPhoto();
        err.textContent = error.message;
        err.hidden = false;
      });
  });
  photoClear.addEventListener("click", resetPhoto);
 
  productForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#productError");
    if (!isLogged() || !db) {
      err.textContent = "Sessão expirada. Entre novamente na Área do Lojista.";
      err.hidden = false;
      return;
    }
 
    if ($("button[type=submit]", productForm).dataset.busy === "1") return; // já enviando
    await photoTask; // garante que a foto escolhida terminou de ser convertida
 
    const f = productForm.elements;
    const nome = f.nome.value.trim();
    const preco = maskedToNumber(f.preco.value);
 
    clearFormErrors(productForm);
    if (nome.length < 2) markInvalid(f.nome, "Informe o nome do produto (mínimo 2 letras).");
    if (Number.isNaN(preco)) markInvalid(f.preco, "Informe um valor válido, por exemplo 1.299,90.");
    else if (preco >= 100000) markInvalid(f.preco, "O valor máximo é R$ 99.999,99.");
    const photoProblem = photoData.length > MAX_DOC_IMAGE ? "A foto ficou grande demais para a nuvem. Escolha outra, menor." : "";
 
    if ($('[aria-invalid="true"]', productForm) || photoProblem) {
      err.textContent = photoProblem || "Corrija os campos destacados para continuar.";
      err.hidden = false;
      focusFirstInvalid(productForm);
      return;
    }
 
    err.hidden = true;
    const isPromo = f.promo.checked;
    const submit = $("button[type=submit]", productForm);
    setBusy(submit, true, "Adicionando...");
    try {
      await withTimeout(db.collection("produtos").add({
        nome,
        preco,
        imagem: photoData,
        categoria: f.categoria.value,
        combo: f.combo.checked,
        promo: f.promo.checked,
        comboDesc: f.combo.checked ? f.comboDesc.value.trim().slice(0, 80) : "",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      }));
      productForm.reset();
      resetPhoto();
      $("#comboLabelWrap").hidden = true;
      toast(isPromo ? "Promoção publicada no topo da loja." : "Produto publicado na loja.");
    } catch (error) {
      console.error("[produtos]", error);
      err.textContent = cloudErrorMessage(error);
      err.hidden = false;
    } finally {
      setBusy(submit, false);
    }
  });
 
  function renderAdminRows() {
    const tbody = $("#adminRows");
    tbody.replaceChildren(
      ...products.map((p) => {
        const fmt = (n) => brl.format(n);
        const priceInput = el("input", {
          type: "text",
          inputmode: "numeric",
          autocomplete: "off",
          value: fmt(p.preco),
          "aria-label": `Valor de ${p.nome}`,
        });
        attachPriceMask(priceInput);
        const save = async () => {
          const v = maskedToNumber(priceInput.value);
          if (Number.isNaN(v)) {
            priceInput.classList.add("invalid");
            toast("Valor inválido. Use o formato 1.299,90.", "error");
            return;
          }
          priceInput.classList.remove("invalid");
          if (v === p.preco) { priceInput.value = fmt(p.preco); return; }
          priceInput.readOnly = true;
          priceInput.classList.add("is-saving");
          try {
            await withTimeout(db.collection("produtos").doc(p.id).update({ preco: v }));
            toast("Preço atualizado para todos os visitantes.");
          } catch (error) {
            console.error("[produtos]", error);
            priceInput.value = fmt(p.preco);
            toast(cloudErrorMessage(error), "error");
          } finally {
            priceInput.readOnly = false;
            priceInput.classList.remove("is-saving");
          }
        };
        priceInput.addEventListener("change", save);
        priceInput.addEventListener("keydown", (e) => { if (e.key === "Enter") priceInput.blur(); });
 
        const thumb = el("img", { src: imageFor(p), alt: "", width: "48", height: "60" });
        thumb.addEventListener("error", () => { thumb.src = placeholderImage(p.categoria, p.combo); }, { once: true });
 
        return el("tr", {}, [
          el("td", {}, thumb),
          el("td", { text: p.nome }),
          el("td", {}, el("div", { class: "badges" }, [
            p.promo ? el("span", { class: "badge-promo", text: "Promoção" }) : null,
            p.combo ? el("span", { class: "badge-combo", text: "Combo" }) : el("span", { text: CATEGORIES.find((c) => c.id === p.categoria)?.label || "" }),
          ])),
          el("td", {}, priceInput),
          el("td", {}, el("div", { class: "row-actions" }, [
            el("button", {
              class: "btn btn--ghost btn--sm", type: "button",
              text: p.promo ? "Tirar da promoção" : "Priorizar como promoção",
              onclick: async (ev) => {
                const btn = ev.currentTarget;
                setBusy(btn, true, "Salvando...");
                try {
                  await withTimeout(db.collection("produtos").doc(p.id).update({ promo: !p.promo }));
                  toast(p.promo ? "Produto saiu das promoções." : "Produto movido para as promoções.");
                } catch (error) {
                  console.error("[produtos]", error);
                  toast(cloudErrorMessage(error), "error");
                } finally {
                  setBusy(btn, false);
                }
              },
            }),
            el("button", {
              class: "btn btn--danger btn--sm", type: "button", text: "Remover",
              onclick: async (ev) => {
                if (!window.confirm(`Remover "${p.nome}" da loja? Isso vale para todos os visitantes.`)) return;
                const btn = ev.currentTarget;
                setBusy(btn, true, "Removendo...");
                try {
                  await withTimeout(db.collection("produtos").doc(p.id).delete());
                  toast("Produto removido.");
                } catch (error) {
                  console.error("[produtos]", error);
                  toast(cloudErrorMessage(error), "error");
                } finally {
                  setBusy(btn, false);
                }
              },
            }),
          ])),
        ]);
      })
    );
  }
 
  const settingsForm = $("#settingsForm");
  watchFormErrors(settingsForm);
  settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("button[type=submit]", settingsForm).dataset.busy === "1") return; // já enviando
    const field = settingsForm.elements.storeEmail;
    const email = field.value.trim();
    const err = $("#settingsError");
    clearFormErrors(settingsForm);
    err.hidden = true;
 
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      markInvalid(field, "Informe um e-mail válido, por exemplo loja@dominio.com.");
      field.focus();
      return;
    }
    if (!db || !isLogged()) {
      err.textContent = "Sessão expirada. Entre novamente na Área do Lojista.";
      err.hidden = false;
      return;
    }
 
    const btn = $("button[type=submit]", settingsForm);
    setBusy(btn, true, "Salvando...");
    try {
      await withTimeout(db.collection("settings").doc("store").set({ storeEmail: email }, { merge: true }));
      toast("E-mail salvo.");
    } catch (error) {
      console.error("[settings]", error);
      err.textContent = cloudErrorMessage(error);
      err.hidden = false;
    } finally {
      setBusy(btn, false);
    }
  });
 
  /* ============================================================
   * Painel: chave Pix e QR Code (settings/store, leitura pública)
   * ============================================================ */
  const pixForm = $("#pixForm");
  const pixQrFile = $("#pixQrFile");
  const pixQrName = $("#pixQrName");
  const pixQrPreview = $("#pixQrPreview");
  const pixQrClear = $("#pixQrClear");
  const MAX_QR_CHARS = 380000; // as regras do Firestore aceitam menos de 400000
  let pixQrDraft = null;       // null = sem alteração; "" = removido; texto = novo QR ainda não salvo
  let pixQrTask = Promise.resolve();
  watchFormErrors(pixForm);
 
  async function qrToDataUrl(file) {
    if (!ACCEPTED_TYPES.includes(file.type)) throw new Error("Formato não suportado. Use JPG, PNG, WEBP ou GIF.");
    if (file.size > MAX_INPUT_BYTES) throw new Error("A imagem é grande demais (máximo 15 MB).");
    const img = await loadImage(file);
    const scale = Math.min(1, 520 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    let url = canvas.toDataURL("image/png"); // PNG mantém o QR nítido
    if (url.length > MAX_QR_CHARS) url = canvas.toDataURL("image/jpeg", 0.9);
    if (url.length > MAX_QR_CHARS || !DATA_IMAGE_RE.test(url)) {
      throw new Error("A imagem do QR Code ficou grande demais. Use um print apenas do QR Code.");
    }
    return url;
  }
 
  function renderPixAdmin() {
    const keyField = pixForm.elements.pixKey;
    if (document.activeElement !== keyField) keyField.value = pixKey;
    const shown = pixQrDraft !== null ? pixQrDraft : pixQr;
    pixQrPreview.hidden = !shown;
    if (shown) pixQrPreview.src = shown;
    else pixQrPreview.removeAttribute("src");
    pixQrClear.hidden = !shown;
    pixQrName.textContent = pixQrDraft ? "Novo QR Code (ainda não salvo)" : pixQr && pixQrDraft === null ? "QR Code cadastrado" : "Nenhum arquivo selecionado";
  }
 
  pixQrFile.addEventListener("change", () => {
    const file = pixQrFile.files && pixQrFile.files[0];
    const err = $("#pixError");
    err.hidden = true;
    if (!file) return;
    pixQrName.replaceChildren(el("span", { class: "spinner spinner--dark", "aria-hidden": "true" }), document.createTextNode(`Processando ${file.name}...`));
    pixQrTask = qrToDataUrl(file)
      .then((url) => { pixQrDraft = url; })
      .catch((error) => {
        console.error("[pix]", error);
        err.textContent = error.message;
        err.hidden = false;
      })
      .finally(() => {
        pixQrFile.value = "";
        renderPixAdmin();
      });
  });
 
  pixQrClear.addEventListener("click", () => {
    pixQrDraft = "";
    pixQrFile.value = "";
    renderPixAdmin();
  });
 
  pixForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("button[type=submit]", pixForm);
    if (btn.dataset.busy === "1") return;
    await pixQrTask;
 
    const err = $("#pixError");
    const key = pixForm.elements.pixKey.value.trim();
    const qr = pixQrDraft !== null ? pixQrDraft : pixQr;
    clearFormErrors(pixForm);
    err.hidden = true;
 
    if (!key && !qr) {
      markInvalid(pixForm.elements.pixKey, "Informe a chave Pix ou escolha o QR Code.");
      pixForm.elements.pixKey.focus();
      return;
    }
    if (/[\u0000-\u001f\u007f]/.test(key)) {
      markInvalid(pixForm.elements.pixKey, "A chave contém caracteres inválidos.");
      pixForm.elements.pixKey.focus();
      return;
    }
    if (!db || !isLogged()) {
      err.textContent = "Sessão expirada. Entre novamente na Área do Lojista.";
      err.hidden = false;
      return;
    }
 
    setBusy(btn, true, "Salvando...");
    try {
      await withTimeout(db.collection("settings").doc("store").set({ pixKey: key, pixQr: qr }, { merge: true }));
      pixQrDraft = null;
      toast("Pix salvo. Já aparece no checkout para os clientes.");
    } catch (error) {
      console.error("[pix]", error);
      err.textContent = cloudErrorMessage(error);
      err.hidden = false;
    } finally {
      setBusy(btn, false);
      renderPixAdmin();
    }
  });
 
  /* ============================================================
   * Nuvem (Firebase): catálogo em tempo real, login e escrita
   * ============================================================ */
  const cloudStatus = $("#cloudStatus");
  let loadingTimer;
 
  function setCloudStatus(msg, kind = "info") {
    cloudStatus.textContent = msg;
    cloudStatus.dataset.kind = kind;
    cloudStatus.hidden = !msg;
  }
 
  function withTimeout(promise, ms = 15000) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject({ code: "timeout" }), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }
 
  function cloudErrorMessage(error) {
    const code = (error && error.code) || "";
    if (code === "permission-denied") return "Sem permissão. Entre de novo como lojista e confira as regras do Firestore.";
    if (code === "timeout") return "Sem resposta da nuvem. Se a conexão voltar, a alteração pode ser aplicada sozinha; confira antes de repetir.";
    if (code === "unavailable") return "Sem conexão com a nuvem. Tente novamente.";
    if (code === "resource-exhausted") return "Limite diário do plano gratuito do Firebase atingido. Tente amanhã ou mude de plano.";
    if (code === "invalid-argument" || code === "out-of-range") return "A nuvem recusou os dados (foto grande demais?).";
    return `Erro na nuvem (${code || (error && error.message) || "desconhecido"}).`;
  }
 
  function normalizeProduct(id, d) {
    if (!d || typeof d.nome !== "string" || typeof d.preco !== "number" || !Number.isFinite(d.preco) || d.preco <= 0) return null;
    const created = d.createdAt && typeof d.createdAt.toMillis === "function" ? d.createdAt.toMillis() : Date.now();
    return {
      id,
      nome: d.nome.slice(0, 80),
      preco: Math.round(d.preco * 100) / 100,
      imagem: typeof d.imagem === "string" ? safeImageUrl(d.imagem) : "",
      categoria: CATEGORY_IDS.includes(d.categoria) ? d.categoria : "acessorio",
      combo: d.combo === true,
      promo: d.promo === true,
      comboDesc: typeof d.comboDesc === "string" ? d.comboDesc.slice(0, 80) : "",
      createdAt: created,
    };
  }
 
  function onProductsSnapshot(snap) {
    const list = [];
    snap.forEach((doc) => {
      const p = normalizeProduct(doc.id, doc.data({ serverTimestamps: "estimate" }));
      if (p) list.push(p);
    });
    list.sort((a, b) => b.createdAt - a.createdAt);
 
    products = list;
    catalogReady = true;
    catalogLoading = false;
    clearTimeout(loadingTimer);
    setCloudStatus("");
    renderCatalog();
    renderCart();
    // Não recria a tabela enquanto o lojista digita um preço (botões não bloqueiam a atualização)
    const active = document.activeElement;
    const editingPrice = active && active.tagName === "INPUT" && $("#adminRows").contains(active);
    if (isLogged() && !editingPrice) renderAdminRows();
    list.forEach((p) => seenIds.add(p.id));
  }
 
  function initCloud() {
    if (typeof window.firebase === "undefined") {
      setCloudStatus("Não foi possível carregar o Firebase. Verifique a conexão com a internet.", "error");
      return;
    }
    if (!CONFIG_OK) {
      setCloudStatus("Catálogo em nuvem ainda não configurado: preencha o bloco FIREBASE_CONFIG no index.html.", "warn");
      return;
    }
 
    try {
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth(app);
      db = firebase.firestore(app);
    } catch (error) {
      console.error("[firebase]", error);
      setCloudStatus("Configuração do Firebase inválida. Confira os dados colados no index.html.", "error");
      return;
    }
 
    // Sessão do lojista vale só para a aba, como antes
    persistenceReady = auth.setPersistence(firebase.auth.Auth.Persistence.SESSION)
      .catch((error) => console.error("[auth]", error));
    auth.onAuthStateChanged(() => renderAuthMode());
 
    setCloudStatus("");
    catalogLoading = true;
    renderCatalog(); // mostra o esqueleto dos cards
    loadingTimer = setTimeout(() => {
      if (!catalogReady) setCloudStatus("O catálogo está demorando mais que o normal. Verifique sua conexão.", "warn");
    }, 10000);
 
    db.collection("produtos").onSnapshot(onProductsSnapshot, (error) => {
      console.error("[catalogo]", error);
      catalogLoading = false;
      clearTimeout(loadingTimer);
      renderCatalog();
      const code = (error && error.code) || "";
      setCloudStatus(
        code === "permission-denied"
          ? "A nuvem recusou a leitura do catálogo. Confira as regras do Firestore (Passo 6 do guia)."
          : `Não foi possível carregar o catálogo (${code || "erro de rede"}).`,
        "error"
      );
    });
 
    db.collection("settings").doc("store").onSnapshot((doc) => {
      const data = doc.exists ? doc.data() : null;
      storeEmail = data && typeof data.storeEmail === "string" ? data.storeEmail : "";
      pixKey = data && typeof data.pixKey === "string" ? data.pixKey.slice(0, 140) : "";
      pixQr = data && typeof data.pixQr === "string" && DATA_IMAGE_RE.test(data.pixQr) ? data.pixQr : "";
      const field = $("#settingsForm").elements.storeEmail;
      if (isLogged() && document.activeElement !== field) field.value = storeEmail;
      if (isLogged()) renderPixAdmin();
      }, (error) => console.error("[settings]", error));
  }
 
  /* ---------- Migração do catálogo antigo (localStorage) para a nuvem ---------- */
  function legacyProducts() {
    const raw = storage.get(LEGACY_PRODUCTS_KEY, []);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p) => p && typeof p.id === "string" && /^[\w-]{1,100}$/.test(p.id) && !p.id.startsWith("seed-"))
      .map((p) => normalizeProduct(p.id, p))
      .filter(Boolean);
  }
 
  function renderLegacyBox() {
    const list = isLogged() ? legacyProducts() : [];
    $("#legacyCard").hidden = list.length === 0;
    if (list.length) {
      $("#legacyText").textContent =
        `Há ${list.length} produto(s) cadastrado(s) neste navegador antes da nuvem. Envie para que todos os visitantes passem a vê-los.`;
    }
  }
 
  $("#legacyBtn").addEventListener("click", async () => {
    const list = legacyProducts();
    const btn = $("#legacyBtn");
    setBusy(btn, true, "Enviando...");
    try {
      for (let i = 0; i < list.length; i += 10) {
        const batch = db.batch();
        list.slice(i, i + 10).forEach((p) => {
          batch.set(db.collection("produtos").doc(p.id), {
            nome: p.nome, preco: p.preco, imagem: p.imagem, categoria: p.categoria,
            combo: p.combo, comboDesc: p.comboDesc,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
        });
        await withTimeout(batch.commit(), 30000);
      }
      try { localStorage.removeItem(LEGACY_PRODUCTS_KEY); } catch (error) { console.error("[storage]", error); }
      toast("Produtos enviados para a nuvem.");
    } catch (error) {
      console.error("[migracao]", error);
      toast(cloudErrorMessage(error), "error");
    } finally {
      setBusy(btn, false);
      renderLegacyBox();
    }
  });
 
  $("#legacyDiscard").addEventListener("click", () => {
    if (!window.confirm("Descartar os produtos antigos deste navegador? Esta ação não pode ser desfeita.")) return;
    try { localStorage.removeItem(LEGACY_PRODUCTS_KEY); } catch (error) { console.error("[storage]", error); }
    renderLegacyBox();
  });
 
  /* ============================================================
   * Inicialização
   * ============================================================ */
  $("#cartBtn").addEventListener("click", openCart);
  $("#closeCart").addEventListener("click", closeCart);
  overlay.addEventListener("click", closeCart);
  $("#checkoutBtn").addEventListener("click", openCheckout);
  $$("[data-nav-promo]").forEach((a) =>
    a.addEventListener("click", (e) => {
      if (!products.some((p) => p.promo)) {
        e.preventDefault();
        toast("Nenhuma promoção no momento.");
      }
    })
  );
 
  // Menu hambúrguer (celular)
  const menuBtn = $("#menuBtn");
  const mobileMenu = $("#mobileMenu");
  const menuOverlay = $("#menuOverlay");
 
  function openMenu() {
    menuOverlay.hidden = false;
    mobileMenu.classList.add("is-open");
    mobileMenu.setAttribute("aria-hidden", "false");
    menuBtn.setAttribute("aria-expanded", "true");
    document.body.classList.add("no-scroll");
    $("#closeMenu").focus();
  }
 
  function closeMenu(restoreFocus = false) {
    if (!mobileMenu.classList.contains("is-open")) return;
    mobileMenu.classList.remove("is-open");
    mobileMenu.setAttribute("aria-hidden", "true");
    menuBtn.setAttribute("aria-expanded", "false");
    menuOverlay.hidden = true;
    document.body.classList.remove("no-scroll");
    if (restoreFocus) menuBtn.focus();
  }
 
  menuBtn.addEventListener("click", openMenu);
  $("#closeMenu").addEventListener("click", () => closeMenu(true));
  menuOverlay.addEventListener("click", () => closeMenu(true));
  $$("a", mobileMenu).forEach((a) => a.addEventListener("click", () => closeMenu()));
  const desktopQuery = window.matchMedia("(min-width: 761px)");
  const onDesktop = (e) => { if (e.matches) closeMenu(); };
  if (desktopQuery.addEventListener) desktopQuery.addEventListener("change", onDesktop);
 
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (drawer.classList.contains("is-open")) closeCart();
    closeMenu(true);
  });
 
  // Busca e ordenação do catálogo
  const searchInput = $("#searchInput");
  const sortSelect = $("#sortSelect");
  const applySearch = debounce(() => {
    searchRaw = searchInput.value.trim().slice(0, 60);
    searchTerm = normalizeText(searchRaw);
    renderCatalog();
  }, 120);
  searchInput.addEventListener("input", applySearch);
  searchInput.addEventListener("search", applySearch);
  sortSelect.addEventListener("change", () => {
    sortMode = sortSelect.value;
    renderCatalog();
  });
 
  // Logo: usa img/logo.jpg; se nao existir, mostra o texto de reserva
  [["#brandImg", "#brandFallback"], ["#splashImg", "#splashFallback"]].forEach(([imgSel, fbSel]) => {
    const img = $(imgSel);
    const fb = $(fbSel);
    const swap = () => { img.hidden = true; fb.hidden = false; };
    img.addEventListener("error", swap, { once: true });
    if (img.complete && img.naturalWidth === 0) swap();
  });
 
  // Roteamento simples do painel por hash
  const syncRoute = () => (location.hash === "#admin" ? openAdmin() : adminSection.hidden || closeAdmin());
  window.addEventListener("hashchange", syncRoute);
 
  // Splash
  const splash = $("#splash");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hideSplash = () => {
    if (splash.classList.contains("is-done")) return;
    splash.classList.add("is-done");
    setTimeout(() => splash.remove(), 800);
  };
  const startSplash = () => setTimeout(hideSplash, reduced ? 100 : 2000);
  if (document.readyState === "complete") startSplash();
  else window.addEventListener("load", startSplash);
  setTimeout(hideSplash, 5000);
 
  renderFilters();
  renderCatalog();
  renderCart();
  syncRoute();
  initCloud();
})();
 