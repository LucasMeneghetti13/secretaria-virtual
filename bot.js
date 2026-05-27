const http = require("http");
const https = require("https");

// ── CONFIG ──
const TOKEN = "8887145132:AAHiJpYxa1McXxl27iSJbQXX8YyzoCAKYWw";
const CHAT_ID = "8703109963";
const PORT = process.env.PORT || 3000;

// ── ESTADO EM MEMÓRIA ──
let state = {
  transacoes: [],
  tarefas: [],
  eventos: [],
  metas: [],
  habitos: [
    "💧 Você já bebeu água hoje?",
    "😴 Como foi seu sono esta noite?",
    "🏃 Movimentou o corpo hoje?",
    "🧘 Tirou um tempo para você hoje?",
    "📵 Conseguiu ficar longe do celular pela manhã?"
  ],
  habitoIdx: 0,
  lastUpdate: 0
};

// ── TELEGRAM HELPERS ──
function sendMessage(text, chatId = CHAT_ID) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "HTML"
    });
    const options = {
      hostname: "api.telegram.org",
      path: `/bot${TOKEN}/sendMessage`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => resolve(JSON.parse(data)));
    });
    req.on("error", (e) => { console.error("Telegram error:", e); resolve(null); });
    req.write(body);
    req.end();
  });
}

function getUpdates(offset = 0) {
  return new Promise((resolve) => {
    const options = {
      hostname: "api.telegram.org",
      path: `/bot${TOKEN}/getUpdates?offset=${offset}&timeout=10`,
      method: "GET"
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ ok: false, result: [] }); }
      });
    });
    req.on("error", () => resolve({ ok: false, result: [] }));
    req.end();
  });
}

// ── BUSCAR NOTÍCIAS ──
function fetchNews() {
  return new Promise((resolve) => {
    const options = {
      hostname: "api.rss2json.com",
      path: "/v1/api.json?rss_url=https%3A%2F%2Ffeeds.folha.uol.com.br%2Femcimadahora%2Frss091.xml&count=5",
      method: "GET"
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const items = (parsed.items || []).slice(0, 4);
          resolve(items.map(i => `• <b>${i.title}</b>`).join("\n"));
        } catch(e) {
          resolve("• Não foi possível carregar notícias agora.");
        }
      });
    });
    req.on("error", () => resolve("• Serviço de notícias indisponível no momento."));
    req.end();
  });
}

// ── FORMATAR DATA ──
function hoje() {
  return new Date().toLocaleDateString("pt-BR", {
    weekday: "long", day: "numeric", month: "long", timeZone: "America/Sao_Paulo"
  });
}

function hojeStr() {
  return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
    .split("/").reverse().join("-").replace(/(\d{4})-(\d{1,2})-(\d{1,2})/, (_, y, m, d) =>
      `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`);
}

// ── BRIEFING MANHÃ (7h) ──
async function briefingManha() {
  const dataHoje = hojeStr();

  const eventosHoje = state.eventos.filter(e => e.data === dataHoje);
  const tarefasPend = state.tarefas.filter(t => !t.done).slice(0, 5);
  const habito = state.habitos[state.habitoIdx % state.habitos.length];
  state.habitoIdx++;

  let msg = `🌅 <b>Bom dia, Lucas!</b>\n`;
  msg += `📅 ${hoje()}\n\n`;

  // Hábito do dia
  msg += `💬 <b>Hábito do dia</b>\n${habito}\n\n`;

  // Agenda
  msg += `📆 <b>Agenda de hoje</b>\n`;
  if (eventosHoje.length === 0) {
    msg += `Nenhum evento hoje.\n`;
  } else {
    eventosHoje.forEach(e => {
      const hora = e.diaTodo ? "Dia todo" : (e.hora || "");
      msg += `• ${e.titulo}${hora ? " — " + hora : ""}`;
      if (e.link) msg += `\n  🔗 ${e.link}`;
      msg += "\n";
    });
  }

  // Tarefas
  msg += `\n✅ <b>Tarefas prioritárias</b>\n`;
  if (tarefasPend.length === 0) {
    msg += `Tudo em dia! Nenhuma tarefa pendente.\n`;
  } else {
    tarefasPend.forEach(t => {
      const prio = t.prio === "alta" ? "🔴" : t.prio === "media" ? "🟡" : "🟢";
      msg += `${prio} ${t.nome}${t.prazo ? " — " + t.prazo : ""}\n`;
    });
  }

  // Metas
  if (state.metas.length > 0) {
    msg += `\n🎯 <b>Metas em andamento</b>\n`;
    state.metas.slice(0, 3).forEach(m => {
      const pct = m.alvo > 0 ? Math.round(m.atual / m.alvo * 100) : 0;
      const bar = "█".repeat(Math.floor(pct/10)) + "░".repeat(10 - Math.floor(pct/10));
      msg += `• ${m.nome}: ${bar} ${pct}%\n`;
    });
  }

  msg += `\n🔗 <a href="https://secretaria-virtual-kz3e.onrender.com">Abrir Secretaria Virtual</a>`;

  await sendMessage(msg);

  // Segunda mensagem: notícias
  const noticias = await fetchNews();
  await sendMessage(`📰 <b>Destaques do dia</b>\n\n${noticias}\n\n<i>Fonte: Folha de S.Paulo</i>`);
}

// ── BRIEFING NOITE (19h) ──
async function briefingNoite() {
  const noticias = await fetchNews();

  let msg = `🌙 <b>Resumo da tarde, Lucas!</b>\n\n`;

  // Resumo financeiro do dia
  const dataHoje = hojeStr();
  const txHoje = state.transacoes.filter(t => t.data === dataHoje);
  if (txHoje.length > 0) {
    msg += `💰 <b>Movimentações de hoje</b>\n`;
    txHoje.forEach(t => {
      const sinal = t.tipo === "receita" ? "+" : "-";
      msg += `• ${sinal}R$ ${parseFloat(t.valor).toFixed(2).replace(".", ",")} — ${t.desc}\n`;
    });
    msg += "\n";
  }

  // Tarefas concluídas hoje
  const concluidas = state.tarefas.filter(t => t.done).length;
  const pendentes = state.tarefas.filter(t => !t.done).length;
  msg += `✅ <b>Tarefas:</b> ${concluidas} concluída(s) · ${pendentes} pendente(s)\n\n`;

  // Notícias das últimas horas
  msg += `📰 <b>Notícias das últimas horas</b>\n\n${noticias}\n\n`;
  msg += `🔗 <a href="https://secretaria-virtual-kz3e.onrender.com">Abrir Secretaria Virtual</a>`;

  await sendMessage(msg);
}

// ── PROCESSAR MENSAGEM DO USUÁRIO ──
async function processMessage(text) {
  const t = text.trim().toLowerCase();

  // LANÇAMENTO RÁPIDO: "paguei 150 almoço" ou "recebi 3000 salário"
  const padraoDesp = /^(paguei|gastei|comprei|debitou)\s+([\d,\.]+)\s+(.+)/i;
  const padraoRec = /^(recebi|entrou|ganhei|depositou)\s+([\d,\.]+)\s+(.+)/i;

  if (padraoDesp.test(text)) {
    const m = text.match(padraoDesp);
    const valor = parseFloat(m[2].replace(",", "."));
    const desc = m[3];
    state.transacoes.push({
      id: Date.now(), tipo: "despesa", valor, desc,
      cat: "Outros", conta: "Não informado",
      data: hojeStr(), dataPgto: hojeStr()
    });
    return await sendMessage(`✅ <b>Despesa registrada!</b>\n💸 -R$ ${valor.toFixed(2).replace(".", ",")} — ${desc}\n📅 ${hoje()}`);
  }

  if (padraoRec.test(text)) {
    const m = text.match(padraoRec);
    const valor = parseFloat(m[2].replace(",", "."));
    const desc = m[3];
    state.transacoes.push({
      id: Date.now(), tipo: "receita", valor, desc,
      cat: "Outros", conta: "Não informado",
      data: hojeStr(), dataPgto: hojeStr()
    });
    return await sendMessage(`✅ <b>Receita registrada!</b>\n💰 +R$ ${valor.toFixed(2).replace(".", ",")} — ${desc}\n📅 ${hoje()}`);
  }

  // SALDO
  if (t === "saldo" || t === "financas" || t === "finanças") {
    let rec = 0, desp = 0;
    state.transacoes.forEach(tx => {
      if (tx.tipo === "receita") rec += tx.valor;
      else desp += tx.valor;
    });
    const saldo = rec - desp;
    const sinal = saldo >= 0 ? "+" : "";
    return await sendMessage(
      `💰 <b>Resumo financeiro</b>\n\n` +
      `📈 Receitas: R$ ${rec.toFixed(2).replace(".", ",")}\n` +
      `📉 Despesas: R$ ${desp.toFixed(2).replace(".", ",")}\n` +
      `💵 Saldo: ${sinal}R$ ${saldo.toFixed(2).replace(".", ",")}`
    );
  }

  // AGENDA
  if (t === "agenda" || t === "hoje" || t === "eventos") {
    const dataHoje = hojeStr();
    const evHoje = state.eventos.filter(e => e.data === dataHoje);
    if (evHoje.length === 0) {
      return await sendMessage(`📅 <b>Agenda de hoje</b>\n\nNenhum evento hoje.`);
    }
    let msg = `📅 <b>Agenda de hoje</b>\n\n`;
    evHoje.forEach(e => {
      msg += `• <b>${e.titulo}</b>${e.hora ? " — " + e.hora : " — Dia todo"}\n`;
      if (e.link) msg += `  🔗 ${e.link}\n`;
    });
    return await sendMessage(msg);
  }

  // TAREFAS
  if (t === "tarefas" || t === "tasks") {
    const pend = state.tarefas.filter(t => !t.done);
    if (pend.length === 0) {
      return await sendMessage(`✅ <b>Tarefas</b>\n\nTudo em dia! Nenhuma tarefa pendente.`);
    }
    let msg = `✅ <b>Tarefas pendentes</b>\n\n`;
    pend.forEach(t => {
      const prio = t.prio === "alta" ? "🔴" : t.prio === "media" ? "🟡" : "🟢";
      msg += `${prio} ${t.nome}${t.prazo ? " — " + t.prazo : ""}\n`;
    });
    return await sendMessage(msg);
  }

  // METAS
  if (t === "metas") {
    if (state.metas.length === 0) {
      return await sendMessage(`🎯 <b>Metas</b>\n\nNenhuma meta cadastrada ainda.`);
    }
    let msg = `🎯 <b>Suas metas</b>\n\n`;
    state.metas.forEach(m => {
      const pct = m.alvo > 0 ? Math.round(m.atual / m.alvo * 100) : 0;
      const bar = "█".repeat(Math.floor(pct/10)) + "░".repeat(10 - Math.floor(pct/10));
      msg += `<b>${m.nome}</b>\n${bar} ${pct}%\nR$ ${m.atual.toFixed(2)} / R$ ${m.alvo.toFixed(2)}\n\n`;
    });
    return await sendMessage(msg);
  }

  // NOTICIAS
  if (t === "noticias" || t === "notícias" || t === "news") {
    const noticias = await fetchNews();
    return await sendMessage(`📰 <b>Notícias agora</b>\n\n${noticias}`);
  }

  // AJUDA
  if (t === "ajuda" || t === "help" || t === "/start" || t === "/help") {
    return await sendMessage(
      `👋 <b>Olá, Lucas! Sou sua Secretaria Virtual.</b>\n\n` +
      `<b>Lançamentos rápidos:</b>\n` +
      `• <code>paguei 50 almoço</code>\n` +
      `• <code>recebi 3000 salário</code>\n` +
      `• <code>gastei 200 mercado</code>\n\n` +
      `<b>Consultas:</b>\n` +
      `• <code>saldo</code> — resumo financeiro\n` +
      `• <code>agenda</code> — eventos de hoje\n` +
      `• <code>tarefas</code> — pendências\n` +
      `• <code>metas</code> — progresso\n` +
      `• <code>notícias</code> — últimas notícias\n\n` +
      `🔗 <a href="https://secretaria-virtual-kz3e.onrender.com">Abrir painel completo</a>`
    );
  }

  // RESPOSTA PADRÃO
  await sendMessage(
    `Entendi! Mas não reconheci esse comando.\n\nMande <code>ajuda</code> para ver o que posso fazer por você. 😊`
  );
}

// ── VERIFICAR HORÁRIO E DISPARAR BRIEFINGS ──
let ultimoBriefingManha = "";
let ultimoBriefingNoite = "";

function checkBriefings() {
  const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const hora = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  const dataHoje = hojeStr();

  if (hora === "07:00" && ultimoBriefingManha !== dataHoje) {
    ultimoBriefingManha = dataHoje;
    briefingManha();
  }

  if (hora === "19:00" && ultimoBriefingNoite !== dataHoje) {
    ultimoBriefingNoite = dataHoje;
    briefingNoite();
  }
}

// ── POLLING DE MENSAGENS ──
async function pollUpdates() {
  try {
    const updates = await getUpdates(state.lastUpdate);
    if (updates.ok && updates.result.length > 0) {
      for (const update of updates.result) {
        state.lastUpdate = update.update_id + 1;
        if (update.message && update.message.text) {
          await processMessage(update.message.text);
        }
      }
    }
  } catch (e) {
    console.error("Poll error:", e);
  }
  setTimeout(pollUpdates, 2000);
}

// ── SERVIDOR HTTP (para o Render manter vivo) ──
const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/sync") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        if (data.transacoes) state.transacoes = data.transacoes;
        if (data.tarefas) state.tarefas = data.tarefas;
        if (data.eventos) state.eventos = data.eventos;
        if (data.metas) state.metas = data.metas;
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false }));
      }
    });
  } else if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "online",
      transacoes: state.transacoes.length,
      tarefas: state.tarefas.filter(t => !t.done).length,
      eventos: state.eventos.length,
      metas: state.metas.length
    }));
  }
});

server.listen(PORT, () => {
  console.log(`✅ Secretaria Virtual rodando na porta ${PORT}`);
  console.log(`📱 Bot: @secretaria_virtual_lucas_bot`);
  console.log(`💬 Chat ID: ${CHAT_ID}`);

  // Iniciar polling
  pollUpdates();

  // Verificar briefings a cada minuto
  setInterval(checkBriefings, 60000);

  // Mensagem de boas-vindas
  setTimeout(() => {
    sendMessage(
      `🤖 <b>Secretaria Virtual online!</b>\n\n` +
      `Estou pronta, Lucas.\n\n` +
      `⏰ Briefing matinal às <b>7h</b>\n` +
      `🌙 Resumo noturno às <b>19h</b>\n\n` +
      `Mande <code>ajuda</code> para ver os comandos disponíveis.\n` +
      `🔗 <a href="https://secretaria-virtual-kz3e.onrender.com">Abrir painel</a>`
    );
  }, 3000);
});
