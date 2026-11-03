// Painel espelho do instagram-mcp: só lê e mostra. Nada aqui publica ou cancela.
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, attrs = {}, ...filhos) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const f of filhos.flat()) if (f != null) el.append(f);
  return el;
};

// ---------- Preferências (só conveniências deste navegador) ----------
const PREF_PADRAO = { pagina: "agenda", visao: "semana", dias: 7, avisos: [1, 60], publicado: true, falhou: true, som: true };
const pref = (() => {
  try { return { ...PREF_PADRAO, ...JSON.parse(localStorage.getItem("painel-pref") || "{}") }; }
  catch { return { ...PREF_PADRAO }; }
})();
const salvarPref = () => { try { localStorage.setItem("painel-pref", JSON.stringify(pref)); } catch {} };

const avisados = (() => {
  try { return new Set(JSON.parse(localStorage.getItem("painel-avisados") || "[]")); } catch { return new Set(); }
})();
const salvarAvisados = () => {
  try { localStorage.setItem("painel-avisados", JSON.stringify([...avisados].slice(-500))); } catch {}
};

// ---------- Formatação ----------
const NOME = { carrossel: "Carrossel", imagem: "Imagem", reels: "Reels", story: "Story" };
const ICONE = { pendente: "⏳", filhos: "🔄", processando: "🔄", publicado: "✅", falhou: "❌" };
const ESTADO = { pendente: "Agendado", filhos: "Enviando", processando: "Processando", publicado: "Publicado", falhou: "Falhou" };
const num = (v) => Number(v || 0).toLocaleString("pt-BR");
const hora = (d) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dataCurta = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const dataLonga = (d) => d.toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });
const mesmoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const inicioDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const somaDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const inicioSemana = (d) => somaDias(inicioDia(d), -d.getDay()); // domingo
const faltam = (ms) => {
  const m = Math.round(ms / 60000);
  if (m < 60) return `em ${m} min`;
  if (m < 1440) return `em ${Math.round(m / 60)} h`;
  return `em ${Math.round(m / 1440)} dia(s)`;
};

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 3500);
}

async function pedir(caminho) {
  const r = await fetch(caminho);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || `erro ${r.status}`);
  return d;
}

// ---------- Páginas ----------
function mostrarPagina(p) {
  pref.pagina = p; salvarPref();
  $$(".pagina").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.pagina === p)));
  $("#pg-agenda").hidden = p !== "agenda";
  $("#pg-metricas").hidden = p !== "metricas";
  if (p === "metricas" && !metricas) carregarMetricas();
}
$$(".pagina").forEach((b) => b.addEventListener("click", () => mostrarPagina(b.dataset.pagina)));

// =====================================================================
// AGENDA
// =====================================================================
let agenda = [];
let foco = new Date();

async function carregarAgenda() {
  try {
    const nova = await pedir("/api/agenda");
    avisarMudancas(agenda, nova);
    agenda = nova.map((t) => ({ ...t, data: new Date(t.quando) }));
    $("#atualizado").textContent = `Atualizado às ${hora(new Date())} · atualiza sozinho a cada minuto`;
    const pend = agenda.filter((t) => t.estado === "pendente").length;
    $("#pendentes").textContent = `⏳ ${pend} agendado(s)`;
    desenharAgenda();
  } catch (e) {
    $("#atualizado").textContent = `⚠️ Sem conexão com a agenda: ${e.message}`;
  }
}

async function carregarStatus() {
  try {
    const s = await pedir("/api/status");
    $("#conta").textContent = `@${s.usuario}`;
    $("#cota").textContent = `${s.cota.usado}/${s.cota.total} posts em 24h`;
  } catch {
    $("#conta").textContent = "sem conexão com a Meta";
  }
}

function eventoBotao(t, { comHora = true } = {}) {
  return h("button", {
    class: `evento ${t.tipo} ${t.estado}`, type: "button",
    title: `${NOME[t.tipo]} · ${ESTADO[t.estado]} · ${hora(t.data)}${t.rotulo ? " · " + t.rotulo : ""}`,
    onclick: (e) => { e.stopPropagation(); abrirDetalhe(t); },
  },
    h("span", {}, ICONE[t.estado] || "•"),
    comHora ? h("strong", {}, hora(t.data)) : null,
    h("span", { class: "rot" }, t.rotulo || NOME[t.tipo]),
    t.musica ? h("span", { title: `Música: ${t.musica}` }, "🎵") : null);
}

function desenharAgenda() {
  $$(".aba[data-visao]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.visao === pref.visao)));
  const cal = $("#calendario");
  cal.replaceChildren();
  if (pref.visao === "mes") desenharMes(cal);
  else desenharGrade(cal, pref.visao === "dia" ? 1 : 7);
  desenharProximos();
}

function desenharMes(cal) {
  const ini = new Date(foco.getFullYear(), foco.getMonth(), 1);
  $("#titulo").textContent = ini.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const grade = h("div", { class: "mes" });
  ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].forEach((d) => grade.append(h("div", { class: "cab" }, d)));
  const comeco = inicioSemana(ini);
  const hoje = new Date();
  for (let i = 0; i < 42; i++) {
    const dia = somaDias(comeco, i);
    if (i === 35 && dia.getMonth() !== ini.getMonth()) break;
    const doDia = agenda.filter((t) => mesmoDia(t.data, dia)).sort((a, b) => a.data - b.data);
    const cel = h("div", {
      class: `celula${dia.getMonth() !== ini.getMonth() ? " fora" : ""}${mesmoDia(dia, hoje) ? " hoje" : ""}`,
      onclick: () => { foco = dia; pref.visao = "dia"; salvarPref(); desenharAgenda(); },
    }, h("div", { class: "num" }, dia.getDate()));
    doDia.slice(0, 3).forEach((t) => cel.append(eventoBotao(t)));
    if (doDia.length > 3) cel.append(h("div", { class: "mais" }, `+${doDia.length - 3} mais`));
    grade.append(cel);
  }
  cal.append(grade);
}

function desenharGrade(cal, nDias) {
  const ini = nDias === 1 ? inicioDia(foco) : inicioSemana(foco);
  const fim = somaDias(ini, nDias - 1);
  $("#titulo").textContent = nDias === 1
    ? ini.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })
    : `${dataCurta(ini)} – ${dataCurta(fim)} de ${fim.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`;

  const hoje = new Date();
  const grade = h("div", { class: "grade", style: `grid-template-columns: 52px repeat(${nDias}, 1fr)` });
  grade.append(h("div", { class: "cab" }));
  for (let d = 0; d < nDias; d++) {
    const dia = somaDias(ini, d);
    grade.append(h("div", {
      class: `cab${mesmoDia(dia, hoje) ? " hoje" : ""}`,
      onclick: () => { foco = dia; pref.visao = "dia"; salvarPref(); desenharAgenda(); },
    }, dia.toLocaleDateString("pt-BR", { weekday: "short" }), h("br"), h("strong", {}, dia.getDate())));
  }

  for (let hr = 0; hr < 24; hr++) {
    grade.append(h("div", { class: "hora" }, hr === 0 ? "" : `${String(hr).padStart(2, "0")}h`));
    for (let d = 0; d < nDias; d++) {
      const dia = somaDias(ini, d);
      const slot = h("div", { class: `slot${mesmoDia(dia, hoje) ? " hoje" : ""}` });
      const nesta = agenda.filter((t) => mesmoDia(t.data, dia) && t.data.getHours() === hr).sort((a, b) => a.data - b.data);
      nesta.forEach((t, i) => {
        const b = eventoBotao(t);
        b.style.top = `${(t.data.getMinutes() / 60) * 44 + i * 4}px`;
        slot.append(b);
      });
      if (mesmoDia(dia, hoje) && hoje.getHours() === hr) {
        slot.append(h("div", { class: "agora", style: `top:${(hoje.getMinutes() / 60) * 44}px` }));
      }
      grade.append(slot);
    }
  }

  const rol = h("div", { class: "rolagem" }, grade);
  cal.append(rol);
  // Abre perto da hora atual (ou do primeiro post) em vez de meia-noite.
  const alvo = agenda.find((t) => t.data >= ini && t.data <= somaDias(fim, 1));
  rol.scrollTop = Math.max(0, ((alvo ? alvo.data.getHours() : hoje.getHours()) - 2) * 44);
}

function desenharProximos() {
  const agora = Date.now();
  const lista = agenda.filter((t) => t.estado !== "publicado" && t.estado !== "falhou" && t.data.getTime() >= agora - 3600_000)
    .sort((a, b) => a.data - b.data).slice(0, 8);
  const ol = $("#proximos");
  ol.replaceChildren();
  if (!lista.length) ol.append(h("li", { class: "vazio" }, "Nada agendado."));
  lista.forEach((t) => ol.append(h("li", {},
    h("button", { class: t.tipo, type: "button", onclick: () => abrirDetalhe(t) },
      h("div", {}, `${ICONE[t.estado]} ${NOME[t.tipo]} · ${t.rotulo || ""}${t.musica ? " 🎵" : ""}`),
      h("div", { class: "quando" }, `${dataLonga(t.data)} · ${faltam(t.data.getTime() - agora)}`)))));
}

function abrirDetalhe(t) {
  $("#d-titulo").textContent = `${NOME[t.tipo]}${t.rotulo ? " · " + t.rotulo : ""}`;
  const midias = $("#d-midias");
  midias.replaceChildren();
  if (t.estado !== "publicado") {
    t.midias.forEach((m, i) => midias.append(m.video
      ? h("video", { src: `/api/midia/${t.id}/${i}`, muted: true, controls: true, preload: "metadata" })
      : h("img", { src: `/api/midia/${t.id}/${i}`, alt: `Mídia ${i + 1}`, loading: "lazy" })));
  }
  midias.hidden = !midias.children.length;

  const info = $("#d-info");
  info.replaceChildren();
  const linha = (k, v) => { if (v) info.append(h("dt", {}, k), h("dd", {}, v)); };
  linha("Quando", dataLonga(t.data));
  linha("Situação", `${ICONE[t.estado]} ${ESTADO[t.estado]}`);
  linha("Mídias", String(t.midias.length));
  linha("🎵 Música", t.musica ? `${t.musica} — adicionar pelo app depois de publicar (··· → Editar → Adicionar música)` : "");
  linha("Erro", t.erro);

  $("#d-legenda").textContent = t.legenda || (t.tipo === "story" ? "(Story não tem legenda)" : "(sem legenda)");
  const link = $("#d-link");
  link.hidden = !t.link;
  if (t.link) link.href = t.link;
  $("#detalhe").showModal();
}

$$(".aba[data-visao]").forEach((b) => b.addEventListener("click", () => { pref.visao = b.dataset.visao; salvarPref(); desenharAgenda(); }));
const passo = (dir) => {
  if (pref.visao === "mes") foco = new Date(foco.getFullYear(), foco.getMonth() + dir, 1);
  else foco = somaDias(foco, dir * (pref.visao === "dia" ? 1 : 7));
  desenharAgenda();
};
$("#ant").addEventListener("click", () => passo(-1));
$("#prox").addEventListener("click", () => passo(1));
$("#hoje").addEventListener("click", () => { foco = new Date(); desenharAgenda(); });

// ---------- Notificações ----------
function tocarSom() {
  if (!pref.som) return;
  try {
    const ctx = new AudioContext();
    [0, 0.18].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.08;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.12);
    });
  } catch {}
}

function notificar(titulo, corpo, tag) {
  tocarSom();
  toast(`${titulo} — ${corpo}`);
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const n = new Notification(titulo, { body: corpo, tag, icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📅</text></svg>" });
      n.onclick = () => { window.focus(); n.close(); };
    } catch {}
  }
}

function verificarAvisos() {
  const agora = Date.now();
  for (const t of agenda) {
    if (t.estado !== "pendente") continue;
    const falta = t.data.getTime() - agora;
    if (falta <= 0) continue;
    for (const min of pref.avisos) {
      const chave = `${t.id}:${min}`;
      if (falta <= min * 60_000 && !avisados.has(chave)) {
        // Marca os avisos maiores também, para não disparar vários de uma vez.
        pref.avisos.filter((m) => m >= min).forEach((m) => avisados.add(`${t.id}:${m}`));
        salvarAvisados();
        notificar(`${NOME[t.tipo]} ${faltam(falta)}`, `${t.rotulo || NOME[t.tipo]} · ${hora(t.data)}`, chave);
        break;
      }
    }
  }
}

function avisarMudancas(antes, depois) {
  if (!antes.length) return;
  const mapa = new Map(antes.map((t) => [t.id, t.estado]));
  for (const t of depois) {
    const era = mapa.get(t.id);
    if (!era || era === t.estado) continue;
    if (t.estado === "publicado" && t.musica) notificar(`🎵 Adicione a música agora`, `"${t.musica}" em ${t.rotulo || NOME[t.tipo]} — ··· → Editar`, `mus-${t.id}`);
    else if (t.estado === "publicado" && pref.publicado) notificar(`✅ ${NOME[t.tipo]} publicado`, t.rotulo || "", `pub-${t.id}`);
    if (t.estado === "falhou" && pref.falhou) notificar(`❌ ${NOME[t.tipo]} falhou`, t.erro || t.rotulo || "", `err-${t.id}`);
  }
}

function abrirConfig() {
  const p = "Notification" in window ? Notification.permission : "indisponivel";
  $("#n-permissao").textContent = {
    granted: "✅ Notificações do Windows liberadas.",
    denied: "🚫 Bloqueadas no navegador. Libere no cadeado ao lado do endereço. Os avisos dentro da página continuam funcionando.",
    default: "As notificações do Windows ainda não foram liberadas.",
    indisponivel: "Este navegador não suporta notificações.",
  }[p];
  $("#n-pedir").hidden = p !== "default";
  $$("#config .opcoes input[value]").forEach((i) => (i.checked = pref.avisos.includes(Number(i.value))));
  $("#n-publicado").checked = pref.publicado;
  $("#n-falhou").checked = pref.falhou;
  $("#n-som").checked = pref.som;
  $("#config").showModal();
}
$("#btn-notif").addEventListener("click", abrirConfig);
$("#n-pedir").addEventListener("click", async () => { await Notification.requestPermission(); abrirConfig(); });
$("#n-testar").addEventListener("click", () => notificar("🔔 Teste", "É assim que o aviso vai aparecer.", "teste"));
$("#config").addEventListener("change", () => {
  pref.avisos = $$("#config .opcoes input[value]").filter((i) => i.checked).map((i) => Number(i.value)).sort((a, b) => a - b);
  pref.publicado = $("#n-publicado").checked;
  pref.falhou = $("#n-falhou").checked;
  pref.som = $("#n-som").checked;
  salvarPref();
});

// =====================================================================
// MÉTRICAS
// =====================================================================
let metricas = null;
let ordem = { campo: "data", desc: true };

const porPeriodo = new Map(); // "7" | "14" | "30" | "de:ate" → dados já carregados

// pref.dias é 7, 14, 30 ou "custom" (usa pref.de e pref.ate).
const chavePeriodo = (p = pref.dias) => (p === "custom" ? `${pref.de}:${pref.ate}` : String(p));

async function buscarPeriodo(p, forcar = false) {
  const qs = p === "custom"
    ? `de=${pref.de}&ate=${pref.ate}`
    : `dias=${p}&limite=15`;
  const chave = chavePeriodo(p);
  const d = await pedir(`/api/metricas?${qs}${forcar ? "&forcar" : ""}`);
  porPeriodo.set(chave, d);
  return d;
}

function marcarPeriodo() {
  $$(".periodo").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.dias === String(pref.dias))));
  $("#m-faixa").hidden = pref.dias !== "custom";
}

async function carregarMetricas(forcar = false) {
  marcarPeriodo();
  const dias = pref.dias;
  if (dias === "custom" && !(pref.de && pref.ate)) {
    $("#m-atualizado").textContent = "escolha as datas e clique em Aplicar";
    return;
  }
  const chave = chavePeriodo(dias);
  const area = document.querySelector(".metricas");

  // Troca instantânea: mostra o que já tem e atualiza por trás.
  if (!forcar && porPeriodo.has(chave)) {
    metricas = porPeriodo.get(chave);
    desenharMetricas();
  } else {
    $("#m-atualizado").textContent = "carregando…";
    area.style.opacity = ".55";
  }

  try {
    const d = await buscarPeriodo(dias, forcar);
    if (chavePeriodo() !== chave) return; // já trocou de período
    metricas = d;
    desenharMetricas();
    $("#m-atualizado").textContent = `dados de ${hora(new Date(d.geradoEm))} · atualiza sozinho a cada 10 min`;
  } catch (e) {
    $("#m-atualizado").textContent = `⚠️ ${e.message}`;
  } finally {
    area.style.opacity = "";
  }

  // Pré-carrega os outros períodos em segundo plano.
  for (const outro of [7, 14, 30]) {
    if (String(outro) !== chave && (forcar || !porPeriodo.has(String(outro)))) buscarPeriodo(outro).catch(() => {});
  }
}

function desenharMetricas() {
  const { perfil, conta, posts, stories } = metricas;
  const dias = metricas.rotulo || `${metricas.dias}d`;
  const longo = metricas.faixa && Date.parse(metricas.faixa.ate) - Date.parse(metricas.faixa.de) > 30 * 86400_000;
  const cartao = (rotulo, valor, dica) => h("div", { class: "cartao", title: dica || "" },
    h("div", { class: "rotulo" }, rotulo), h("div", { class: "valor" }, valor));
  const saldo = Number(conta.follows_and_unfollows || 0);
  $("#m-cartoes").replaceChildren(
    cartao("Seguidores", num(perfil.seguidores)),
    cartao(`Saldo de seguidores (${dias}d)`, `${saldo > 0 ? "+" : ""}${num(saldo)}`),
    cartao(`Alcance (${dias}d)`, num(conta.reach), "Contas únicas que viram seu conteúdo"),
    cartao(`Visualizações (${dias}d)`, num(conta.views)),
    cartao(`Contas engajadas (${dias}d)`, num(conta.accounts_engaged)),
    cartao(`Interações (${dias}d)`, num(conta.total_interactions)),
    cartao(`Cliques no link (${dias}d)`, num(conta.profile_links_taps)),
    cartao("Posts no perfil", num(perfil.posts)),
  );
  const nota = $("#m-nota") || $("#m-cartoes").insertAdjacentElement("afterend", h("p", { id: "m-nota", class: "nota" }));
  nota.textContent = longo
    ? "Recorte maior que 30 dias: a Meta entrega em blocos de 30 dias e os valores são somados. Alcance e contas engajadas podem contar a mesma pessoa mais de uma vez."
    : metricas.faixa ? `${posts.length} post(s) publicados nesse recorte.` : "";

  // Gráfico de barras: views por post, do mais antigo ao mais recente.
  const cron = [...posts].sort((a, b) => new Date(a.data) - new Date(b.data));
  const max = Math.max(1, ...cron.map((p) => p.views));
  $("#m-grafico").replaceChildren(...cron.map((p) => h("div", {
    class: `barra-g ${p.tipo}`,
    style: `height:${Math.max(3, (p.views / max) * 100)}%`,
    title: `${dataCurta(new Date(p.data))} · ${NOME[p.tipo]} · ${num(p.views)} views\n${p.legenda}`,
    onclick: () => window.open(p.link, "_blank", "noopener"),
  }, h("span", {}, num(p.views)))));

  desenharTabela();

  $("#m-stories-bloco").hidden = !stories.length;
  $("#m-stories").replaceChildren(...stories.map((s) => h("div", { class: "cartao" },
    h("div", { class: "rotulo" }, `Story · ${hora(new Date(s.data))}`),
    h("div", { class: "valor" }, num(s.views)),
    h("div", { class: "sutil" }, `${num(s.alcance)} alcance · ${num(s.respostas)} respostas`))));
}

function desenharTabela() {
  const posts = metricas.posts.map((p) => ({ ...p, taxa: p.alcance ? p.interacoes / p.alcance : 0 }));
  const { campo, desc } = ordem;
  posts.sort((a, b) => {
    const va = campo === "data" ? new Date(a.data) : a[campo], vb = campo === "data" ? new Date(b.data) : b[campo];
    return (va > vb ? 1 : va < vb ? -1 : 0) * (desc ? -1 : 1);
  });
  const melhor = Math.max(...posts.map((p) => p.views));
  $$(".tabela th[data-ord]").forEach((th) => th.classList.toggle("ativo", th.dataset.ord === campo));
  $("#m-tabela").replaceChildren(...posts.map((p) => h("tr", { class: p.views === melhor && melhor > 0 ? "destaque-linha" : "" },
    h("td", {}, dataCurta(new Date(p.data))),
    h("td", {}, h("span", { class: `tag ${p.tipo}` }, NOME[p.tipo]), h("a", { href: p.link, target: "_blank", rel: "noopener" }, p.legenda || "(sem legenda)")),
    h("td", {}, num(p.views)), h("td", {}, num(p.alcance)), h("td", {}, num(p.curtidas)),
    h("td", {}, num(p.comentarios)), h("td", {}, num(p.salvos)), h("td", {}, num(p.compart)),
    h("td", {}, p.alcance ? `${(p.taxa * 100).toFixed(1)}%` : "—"))));
}

$$(".tabela th[data-ord]").forEach((th) => th.addEventListener("click", () => {
  ordem = { campo: th.dataset.ord, desc: ordem.campo === th.dataset.ord ? !ordem.desc : true };
  if (metricas) desenharTabela();
}));
$$(".periodo").forEach((b) => b.addEventListener("click", () => {
  pref.dias = b.dataset.dias === "custom" ? "custom" : Number(b.dataset.dias);
  salvarPref();
  if (pref.dias === "custom") {
    // Sugere o mês passado na primeira vez.
    const hoje = new Date();
    const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    $("#m-de").value = pref.de || iso(ini);
    $("#m-ate").value = pref.ate || iso(fim);
    $("#m-ate").max = $("#m-de").max = iso(hoje);
  }
  carregarMetricas();
}));
$("#m-faixa").addEventListener("submit", (e) => {
  e.preventDefault();
  pref.de = $("#m-de").value;
  pref.ate = $("#m-ate").value;
  salvarPref();
  carregarMetricas();
});
$("#m-recarregar").addEventListener("click", () => carregarMetricas(true));

// ---------- Início e atualização automática ----------
// Endereço com #metricas ou #agenda abre direto na aba.
const inicial = location.hash.slice(1);
mostrarPagina(["agenda", "metricas"].includes(inicial) ? inicial : pref.pagina);
new MutationObserver(() => {
  const t = $("#titulo");
  const cap = t.textContent.charAt(0).toUpperCase() + t.textContent.slice(1);
  if (t.textContent !== cap) t.textContent = cap;
}).observe($("#titulo"), { childList: true });
carregarStatus();
carregarAgenda();
setInterval(carregarAgenda, 60_000);
setInterval(carregarStatus, 5 * 60_000);
setInterval(verificarAvisos, 20_000);
setInterval(() => { if (metricas) carregarMetricas(); }, 10 * 60_000);
setInterval(() => { if (pref.pagina === "agenda") desenharProximos(); }, 60_000);

// Abre o VS Code numa conversa nova do Claude, com o MCP do Instagram carregado.
$("#btn-postar").addEventListener("click", async () => {
  try {
    const r = await fetch("/api/nova-postagem", { method: "POST" });
    if (!r.ok) throw new Error((await r.json()).erro);
    toast("Abrindo o VS Code… é só dizer o que quer postar.");
  } catch (e) {
    toast(`Não consegui abrir o VS Code: ${e.message}`);
  }
});
