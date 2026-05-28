const http = require("http");
const https = require("https");

// ── CONFIG ──
const TELEGRAM_TOKEN = "8887145132:AAHiJpYxa1McXxl27iSJbQXX8YyzoCAKYWw";
const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const CHAT_ID        = "8703109963";
const PORT           = process.env.PORT || 3000;

// ── ESTADO ──
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
    "📵 Conseguiu ficar longe do celular pela manhã?",
    "🥗 Comeu bem hoje?",
    "🙏 Tem algo pelo qual é grato hoje?"
  ],
  habitoIdx: 0,
  lastUpdate: 0,
  conversationHistory: []
};

// ── HELPERS ──
function hojeStr() {
  const d = new Date();
  const brt = new Date(d.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return `${brt.getFullYear()}-${String(brt.getMonth()+1).padStart(2,"0")}-${String(brt.getDate()).padStart(2,"0")}`;
}

function hoje() {
  return new Date().toLocaleDateString("pt-BR", {
    weekday: "long", day: "numeric", month: "long", timeZone: "America/Sao_Paulo"
  });
}

function fmt(v) {
  return "R$ " + parseFloat(v).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function resumoState() {
  const rec = state.transacoes.filter(t=>t.tipo==="receita").reduce((s,t)=>s+t.valor,0);
  const desp = state.transacoes.filter(t=>t.tipo==="despesa").reduce((s,t)=>s+t.valor,0);
  const pendentes = state.tarefas.filter(t=>!t.done);
  const proxEventos = state.eventos.slice().sort((a,b)=>a.data>b.data?1:-1).slice(0,3);
  return `HOJE: ${hojeStr()}
FINANÇAS: receitas ${fmt(rec)} | despesas ${fmt(desp)} | saldo ${fmt(rec-desp)}
EVENTOS: ${proxEventos.length ? proxEventos.map(e=>`${e.titulo} ${e.data}${e.hora?" "+e.hora:""}`).join("; ") : "nenhum"}
TAREFAS: ${pendentes.length} pendentes${pendentes.length ? ": "+pendentes.slice(0,3).map(t=>t.nome).join(", ") : ""}
METAS: ${state.metas.length ? state.metas.map(m=>`${m.nome} ${m.alvo>0?Math.round(m.atual/m.alvo*100):0}%`).join(", ") : "nenhuma"}`.trim();
}

// ── ANTHROPIC API ──
function callClaude(userMessage) {
  return new Promise((resolve) => {
    // Mantém histórico de conversa (últimas 10 mensagens)
    state.conversationHistory.push({ role: "user", content: userMessage });
    if (state.conversationHistory.length > 20) {
      state.conversationHistory = state.conversationHistory.slice(-20);
    }

    const systemPrompt = `Você é a Secretaria Virtual do Lucas Meneghetti, um assistente pessoal inteligente via Telegram. Você gerencia finanças, agenda, tarefas, metas e fornece informações.

ESTADO ATUAL DO SISTEMA:
${resumoState()}

SUAS CAPACIDADES — você pode executar essas ações respondendo com JSON:

Para CRIAR EVENTO ÚNICO:
{"acao":"criar_evento","titulo":"...","data":"YYYY-MM-DD","hora":"HH:MM","tipo":"Trabalho|Pessoal|Saúde|Social|Imóveis|Outro","link":"...opcional","diaTodo":false}

Para CRIAR MÚLTIPLOS EVENTOS (SEMPRE use quando houver 2+ eventos ou período de datas):
{"acao":"criar_eventos","eventos":[{"titulo":"...","data":"YYYY-MM-DD","hora":"HH:MM","tipo":"...","diaTodo":false}]}

Para CRIAR TAREFA ÚNICA:
{"acao":"criar_tarefa","nome":"...","prio":"alta|media|baixa","prazo":"YYYY-MM-DD","cat":"Trabalho|Pessoal|Financeiro|Saúde|Imóveis|Outro"}

Para CRIAR MÚLTIPLAS TAREFAS (SEMPRE use quando houver 2+ tarefas):
{"acao":"criar_tarefas","tarefas":[{"nome":"...","prio":"alta|media|baixa","prazo":"YYYY-MM-DD","cat":"Trabalho|Pessoal|Financeiro|Saúde|Imóveis|Outro"}]}

Para CONCLUIR TAREFA:
{"acao":"concluir_tarefa","nome":"..."}

Para LANÇAR TRANSAÇÃO:
{"acao":"lancar_transacao","tipo":"receita|despesa","valor":0.00,"desc":"...","cat":"Alimentação|Moradia|Transporte|Saúde|Educação|Lazer|Salário|Imóveis|Outros","conta":"Conta corrente|Cartão crédito|PIX|Dinheiro|Outro"}

Para CRIAR META:
{"acao":"criar_meta","nome":"...","alvo":0.00,"atual":0.00,"prazo":"YYYY-MM-DD","cat":"Financeiro|Saúde|Carreira|Pessoal|Imóveis|Educação"}

Para ATUALIZAR META:
{"acao":"atualizar_meta","nome":"...","atual":0.00}

Para DELETAR EVENTO:
{"acao":"deletar_evento","titulo":"..."}

Para BUSCAR NOTÍCIAS (quando pedir notícias, manchetes, o que aconteceu):
{"acao":"buscar_noticias"}

Para APENAS RESPONDER (consultas, conversas, análises):
{"acao":"responder","mensagem":"..."}

REGRAS CRÍTICAS — LEIA COM ATENÇÃO:
1. Sempre responda com JSON válido — apenas o JSON, sem texto antes ou depois, sem blocos de código
2. MÚLTIPLAS TAREFAS: se o usuário listar 2 ou mais tarefas, use OBRIGATORIAMENTE "criar_tarefas" com array. NUNCA crie só a primeira.
3. PERÍODO DE DATAS: "de 29/06 até 03/07" ou "do dia X ao dia Y" = crie um evento para CADA DIA do período usando "criar_eventos". Ex: viagem de 5 dias = 5 eventos, um por dia, ou crie o evento de início e fim.
4. MÚLTIPLOS EVENTOS: sempre use "criar_eventos" com array quando houver 2+ eventos
5. Para datas relativas: "amanhã" = ${new Date(new Date(hojeStr()).getTime()+86400000).toISOString().split("T")[0]}, calcule sempre a partir de hoje ${hojeStr()}
6. Seja direto, warm e objetivo. Use emojis com moderação
7. Responda sempre em português do Brasil
8. Nunca invente dados — use apenas o que está no estado do sistema
9. Para notícias, use a ação "buscar_noticias" — não diga que não tem acesso
10. Quando criar múltiplos itens, confirme todos na resposta`;

    const body = JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1000,
      system: systemPrompt,
      messages: state.conversationHistory
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => {
        try {
          console.log(`🔍 HTTP Status Anthropic: ${res.statusCode}`);
          console.log(`🔍 Resposta raw: ${data.substring(0, 300)}`);
          const parsed = JSON.parse(data);
          if (parsed.error) {
            console.error(`❌ Erro API Anthropic: ${JSON.stringify(parsed.error)}`);
            state.conversationHistory.pop();
            resolve(`{"acao":"responder","mensagem":"Erro da IA: ${parsed.error.message || parsed.error.type}"}`);
            return;
          }
          const text = parsed.content?.[0]?.text || '{"acao":"responder","mensagem":"Desculpe, não consegui processar sua mensagem."}';
          state.conversationHistory.push({ role: "assistant", content: text });
          resolve(text);
        } catch(e) {
          console.error(`❌ Parse error: ${e.message}`);
          resolve('{"acao":"responder","mensagem":"Erro ao processar resposta."}');
        }
      });
    });
    req.on("error", (e) => {
      console.error(`❌ Conexão falhou: ${e.message}`);
      resolve('{"acao":"responder","mensagem":"Erro de conexão com a IA."}');
    });
    req.write(body);
    req.end();
  });
}

// ── EXECUTAR AÇÃO ──
async function executeAction(jsonStr) {
  let action;
  try {
    // Extrai JSON mesmo se vier com texto ao redor
    const match = jsonStr.match(/\{[\s\S]*\}/);
    action = JSON.parse(match ? match[0] : jsonStr);
  } catch(e) {
    return "Não consegui interpretar a resposta. Pode repetir de outra forma?";
  }

  switch(action.acao) {

    case "criar_evento": {
      state.eventos.push({
        id: Date.now(),
        titulo: action.titulo,
        data: action.data,
        hora: action.hora || "",
        tipo: action.tipo || "Trabalho",
        link: action.link || "",
        desc: action.desc || "",
        diaTodo: action.diaTodo || false
      });
      const d = action.data.split("-");
      return `📅 <b>Evento agendado!</b>\n\n• <b>${action.titulo}</b>\n📆 ${d[2]}/${d[1]}/${d[0]}${action.hora ? " às "+action.hora : " — dia todo"}${action.link?"\n🔗 "+action.link:""}`;
    }

    case "criar_eventos": {
      const criados = [];
      for (const ev of action.eventos) {
        state.eventos.push({
          id: Date.now() + Math.random(),
          titulo: ev.titulo, data: ev.data,
          hora: ev.hora || "", tipo: ev.tipo || "Trabalho",
          link: ev.link || "", desc: "", diaTodo: ev.diaTodo || false
        });
        const d = ev.data.split("-");
        criados.push(`• <b>${ev.titulo}</b> — ${d[2]}/${d[1]}/${d[0]}${ev.hora?" às "+ev.hora:""}`);
      }
      return `📅 <b>${criados.length} eventos agendados!</b>\n\n${criados.join("\n")}\n\n🔗 <a href="https://secretaria-virtual-kz3e.onrender.com">Ver no painel</a>`;
    }

    case "lancar_transacao": {
      state.transacoes.push({
        id: Date.now(),
        tipo: action.tipo, valor: action.valor,
        desc: action.desc, cat: action.cat || "Outros",
        conta: action.conta || "Não informado",
        data: hojeStr(), dataPgto: hojeStr()
      });
      const sinal = action.tipo === "receita" ? "+" : "-";
      const emoji = action.tipo === "receita" ? "💰" : "💸";
      return `${emoji} <b>${action.tipo === "receita" ? "Receita" : "Despesa"} registrada!</b>\n\n${sinal}${fmt(action.valor)} — ${action.desc}\n📂 ${action.cat} | ${action.conta || ""}\n📅 ${hojeStr()}`;
    }

    case "criar_tarefa": {
      state.tarefas.push({
        id: Date.now(), nome: action.nome,
        prio: action.prio || "media",
        prazo: action.prazo || hojeStr(),
        cat: action.cat || "Trabalho", done: false
      });
      const prioEmoji = action.prio==="alta"?"🔴":action.prio==="baixa"?"🟢":"🟡";
      return `✅ <b>Tarefa criada!</b>\n\n${prioEmoji} ${action.nome}\n📂 ${action.cat}${action.prazo?"\n📅 Prazo: "+action.prazo:""}`;
    }

    case "criar_tarefas": {
      const criadas = [];
      for (const t of action.tarefas) {
        state.tarefas.push({
          id: Date.now() + Math.random(),
          nome: t.nome, prio: t.prio || "media",
          prazo: t.prazo || hojeStr(),
          cat: t.cat || "Trabalho", done: false
        });
        const prioEmoji = t.prio==="alta"?"🔴":t.prio==="baixa"?"🟢":"🟡";
        criadas.push(`${prioEmoji} ${t.nome}`);
      }
      return `✅ <b>${criadas.length} tarefas criadas!</b>\n\n${criadas.join("\n")}`;
    }

    case "buscar_noticias": {
      const noticias = await fetchNews();
      return `📰 <b>Notícias agora</b>\n\n${noticias}\n\n<i>Fonte: Folha de S.Paulo</i>`;
    }

    case "concluir_tarefa": {
      const t = state.tarefas.find(t => t.nome.toLowerCase().includes(action.nome.toLowerCase()));
      if (t) { t.done = true; return `✅ Tarefa "<b>${t.nome}</b>" marcada como concluída!`; }
      return `Não encontrei uma tarefa com esse nome. Veja suas tarefas pendentes enviando <code>tarefas</code>.`;
    }

    case "criar_meta": {
      state.metas.push({
        id: Date.now(), nome: action.nome,
        alvo: action.alvo, atual: action.atual || 0,
        prazo: action.prazo || "", cat: action.cat || "Pessoal"
      });
      return `🎯 <b>Meta criada!</b>\n\n<b>${action.nome}</b>\nAlvo: ${fmt(action.alvo)}\nAtual: ${fmt(action.atual||0)}\n📂 ${action.cat}${action.prazo?"\n📅 Prazo: "+action.prazo:""}`;
    }

    case "atualizar_meta": {
      const m = state.metas.find(m => m.nome.toLowerCase().includes(action.nome.toLowerCase()));
      if (m) {
        m.atual = action.atual;
        const pct = m.alvo>0?Math.round(m.atual/m.alvo*100):0;
        const bar = "█".repeat(Math.floor(pct/10)) + "░".repeat(10-Math.floor(pct/10));
        return `🎯 <b>Meta atualizada!</b>\n\n<b>${m.nome}</b>\n${bar} ${pct}%\n${fmt(m.atual)} de ${fmt(m.alvo)}`;
      }
      return `Não encontrei essa meta. Envie <code>metas</code> para ver suas metas.`;
    }

    case "deletar_evento": {
      const antes = state.eventos.length;
      state.eventos = state.eventos.filter(e => !e.titulo.toLowerCase().includes(action.titulo.toLowerCase()));
      if (state.eventos.length < antes) return `🗑️ Evento "<b>${action.titulo}</b>" removido da agenda.`;
      return `Não encontrei um evento com esse nome.`;
    }

    case "responder":
    default:
      return action.mensagem || jsonStr;
  }
}

// ── TELEGRAM ──
function sendTelegram(text, chatId = CHAT_ID) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" });
    const options = {
      hostname: "api.telegram.org",
      path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    };
    const req = https.request(options, (res) => {
      let d = ""; res.on("data", c => d+=c);
      res.on("end", () => resolve(JSON.parse(d)));
    });
    req.on("error", e => { console.error(e); resolve(null); });
    req.write(body); req.end();
  });
}

function getUpdates(offset = 0) {
  return new Promise((resolve) => {
    const options = {
      hostname: "api.telegram.org",
      path: `/bot${TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=10`,
      method: "GET"
    };
    const req = https.request(options, (res) => {
      let d = ""; res.on("data", c => d+=c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ok:false,result:[]}); } });
    });
    req.on("error", () => resolve({ok:false,result:[]}));
    req.end();
  });
}

// ── BUSCAR NOTÍCIAS VIA IA COM WEB SEARCH ──
function fetchNews() {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{
        role: "user",
        content: `Busque notícias de hoje em português sobre estes 5 temas. Para cada um, 1 manchete + fonte + 1 linha de impacto. Seja direto.

1. 💰 Economia & Finanças Brasil
2. 💻 Tecnologia/IA
3. 🏎️ Fórmula 1/MotoGP
4. 📊 Política econômica Brasil
5. 🗳️ Política Brasil`
      }]
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "interleaved-thinking-2025-05-14",
        "Content-Length": Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(d);
          // Pega o último bloco de texto da resposta
          const textos = (parsed.content || [])
            .filter(b => b.type === "text")
            .map(b => b.text);
          if (textos.length > 0) {
            resolve(textos[textos.length - 1]);
          } else {
            console.error("NewsIA sem texto:", JSON.stringify(parsed).substring(0, 300));
            resolve("Não consegui buscar as notícias agora. Tente novamente em instantes.");
          }
        } catch(e) {
          console.error("NewsIA parse error:", e.message);
          resolve("Erro ao buscar notícias.");
        }
      });
    });
    req.on("error", (e) => {
      console.error("NewsIA req error:", e.message);
      resolve("Erro de conexão ao buscar notícias.");
    });
    req.write(body);
    req.end();
  });
}

// ── PROCESSAR MENSAGEM ──
async function processMessage(text) {
  console.log(`📨 Mensagem: ${text}`);
  try {
    const jsonResposta = await callClaude(text);
    console.log(`🤖 IA respondeu: ${jsonResposta.substring(0,100)}...`);
    const resposta = await executeAction(jsonResposta);
    await sendTelegram(resposta);
  } catch(e) {
    console.error("Erro ao processar:", e);
    await sendTelegram("Ocorreu um erro. Pode tentar novamente?");
  }
}

// ── BRIEFINGS ──
let ultimoManha = "", ultimoNoite = "";

async function briefingManha() {
  const habito = state.habitos[state.habitoIdx % state.habitos.length];
  state.habitoIdx++;
  const pendentes = state.tarefas.filter(t=>!t.done);
  const dataHoje = hojeStr();
  const eventosHoje = state.eventos.filter(e=>e.data===dataHoje);

  let msg = `🌅 <b>Bom dia, Lucas!</b>\n📅 ${hoje()}\n\n`;
  msg += `💬 <b>Hábito do dia</b>\n${habito}\n\n`;
  msg += `📆 <b>Agenda de hoje</b>\n`;
  if (!eventosHoje.length) msg += "Nenhum evento hoje.\n";
  else eventosHoje.forEach(e => {
    msg += `• <b>${e.titulo}</b>${e.hora?" — "+e.hora:" — dia todo"}\n`;
    if (e.link) msg += `  🔗 ${e.link}\n`;
  });
  msg += `\n✅ <b>Tarefas prioritárias</b>\n`;
  if (!pendentes.length) msg += "Tudo em dia!\n";
  else pendentes.slice(0,5).forEach(t => {
    const p = t.prio==="alta"?"🔴":t.prio==="baixa"?"🟢":"🟡";
    msg += `${p} ${t.nome}${t.prazo?" — "+t.prazo:""}\n`;
  });
  if (state.metas.length) {
    msg += `\n🎯 <b>Metas</b>\n`;
    state.metas.slice(0,3).forEach(m => {
      const pct = m.alvo>0?Math.round(m.atual/m.alvo*100):0;
      const bar = "█".repeat(Math.floor(pct/10))+"░".repeat(10-Math.floor(pct/10));
      msg += `• ${m.nome}: ${bar} ${pct}%\n`;
    });
  }
  msg += `\n🔗 <a href="https://secretaria-virtual-kz3e.onrender.com">Abrir painel</a>`;
  await sendTelegram(msg);

  const noticias = await fetchNews();
  await sendTelegram(`📰 <b>Destaques do dia</b>\n\n${noticias}\n\n<i>Fonte: Folha de S.Paulo</i>`);
}

async function briefingNoite() {
  const noticias = await fetchNews();
  const dataHoje = hojeStr();
  const txHoje = state.transacoes.filter(t=>t.data===dataHoje);
  const concluidas = state.tarefas.filter(t=>t.done).length;
  const pendentes = state.tarefas.filter(t=>!t.done).length;

  let msg = `🌙 <b>Boa noite, Lucas!</b>\n\n`;
  if (txHoje.length) {
    msg += `💰 <b>Movimentações de hoje</b>\n`;
    txHoje.forEach(t => {
      msg += `• ${t.tipo==="receita"?"+":"-"}${fmt(t.valor)} — ${t.desc}\n`;
    });
    msg += "\n";
  }
  msg += `✅ <b>Tarefas:</b> ${concluidas} concluída(s) · ${pendentes} pendente(s)\n\n`;
  msg += `📰 <b>Notícias das últimas horas</b>\n\n${noticias}\n\n`;
  msg += `🔗 <a href="https://secretaria-virtual-kz3e.onrender.com">Abrir painel</a>`;
  await sendTelegram(msg);
}

function checkBriefings() {
  const hora = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour:"2-digit", minute:"2-digit" });
  const dataHoje = hojeStr();
  if (hora === "07:00" && ultimoManha !== dataHoje) { ultimoManha = dataHoje; briefingManha(); }
  if (hora === "19:00" && ultimoNoite !== dataHoje) { ultimoNoite = dataHoje; briefingNoite(); }
}

// ── POLLING ──
async function pollUpdates() {
  try {
    const updates = await getUpdates(state.lastUpdate);
    if (updates.ok && updates.result.length > 0) {
      for (const update of updates.result) {
        state.lastUpdate = update.update_id + 1;
        if (update.message?.text) {
          await processMessage(update.message.text);
        }
      }
    }
  } catch(e) { console.error("Poll error:", e); }
  setTimeout(pollUpdates, 2000);
}

// ── SERVIDOR HTTP ──
const server = http.createServer((req, res) => {
  const CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  const url = req.url.split("?")[0];

  // ── GET /api/state — retorna tudo ──
  if (req.method === "GET" && url === "/api/state") {
    res.writeHead(200, CORS);
    return res.end(JSON.stringify({
      transacoes: state.transacoes,
      tarefas: state.tarefas,
      eventos: state.eventos,
      metas: state.metas,
      habitos: state.habitos
    }));
  }

  // ── POST /api/transacao ──
  if (req.method === "POST" && url === "/api/transacao") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        data.id = Date.now();
        state.transacoes.push(data);
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, data }));
      } catch(e) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }

  // ── DELETE /api/transacao/:id ──
  if (req.method === "DELETE" && url.startsWith("/api/transacao/")) {
    const id = parseInt(url.split("/")[3]);
    state.transacoes = state.transacoes.filter(t => t.id !== id);
    res.writeHead(200, CORS);
    return res.end(JSON.stringify({ ok: true }));
  }

  // ── POST /api/evento ──
  if (req.method === "POST" && url === "/api/evento") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        data.id = Date.now();
        state.eventos.push(data);
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, data }));
      } catch(e) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }

  // ── DELETE /api/evento/:id ──
  if (req.method === "DELETE" && url.startsWith("/api/evento/")) {
    const id = parseInt(url.split("/")[3]);
    state.eventos = state.eventos.filter(e => e.id !== id);
    res.writeHead(200, CORS);
    return res.end(JSON.stringify({ ok: true }));
  }

  // ── POST /api/tarefa ──
  if (req.method === "POST" && url === "/api/tarefa") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        data.id = Date.now();
        data.done = false;
        state.tarefas.push(data);
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, data }));
      } catch(e) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }

  // ── PUT /api/tarefa/:id — toggle done ──
  if (req.method === "PUT" && url.startsWith("/api/tarefa/")) {
    const id = parseInt(url.split("/")[3]);
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const t = state.tarefas.find(t => t.id === id);
        if (t) Object.assign(t, data);
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }

  // ── DELETE /api/tarefa/:id ──
  if (req.method === "DELETE" && url.startsWith("/api/tarefa/")) {
    const id = parseInt(url.split("/")[3]);
    state.tarefas = state.tarefas.filter(t => t.id !== id);
    res.writeHead(200, CORS);
    return res.end(JSON.stringify({ ok: true }));
  }

  // ── POST /api/meta ──
  if (req.method === "POST" && url === "/api/meta") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        data.id = Date.now();
        state.metas.push(data);
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, data }));
      } catch(e) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }

  // ── PUT /api/meta/:id ──
  if (req.method === "PUT" && url.startsWith("/api/meta/")) {
    const id = parseInt(url.split("/")[3]);
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const m = state.metas.find(m => m.id === id);
        if (m) Object.assign(m, data);
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }

  // ── DELETE /api/meta/:id ──
  if (req.method === "DELETE" && url.startsWith("/api/meta/")) {
    const id = parseInt(url.split("/")[3]);
    state.metas = state.metas.filter(m => m.id !== id);
    res.writeHead(200, CORS);
    return res.end(JSON.stringify({ ok: true }));
  }

  // ── POST /api/habito ──
  if (req.method === "POST" && url === "/api/habito") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      try {
        const { texto } = JSON.parse(body);
        if (texto) state.habitos.push(texto);
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }

  // ── GET / — status ──
  res.writeHead(200, CORS);
  res.end(JSON.stringify({ status: "online", uptime: process.uptime() }));
});

server.listen(PORT, () => {
  console.log(`✅ Secretaria Virtual rodando na porta ${PORT}`);
  console.log(`📱 Bot: @secretaria_virtual_lucas_bot`);
  console.log(`💬 Chat ID: ${CHAT_ID}`);
  console.log(`🤖 IA: Claude Sonnet ativo`);

  pollUpdates();
  setInterval(checkBriefings, 60000);

  setTimeout(() => {
    sendTelegram(
      `🤖 <b>Secretaria Virtual — IA ativada!</b>\n\n` +
      `Olá Lucas! Agora você pode falar comigo em linguagem natural.\n\n` +
      `Exemplos do que posso fazer:\n` +
      `• "Amanhã às 9h tenho reunião com João"\n` +
      `• "Gastei 85 reais no mercado"\n` +
      `• "Me lembra de ligar pro cliente na sexta"\n` +
      `• "Como estão meus gastos este mês?"\n` +
      `• "Agendar dia 01/06 às 14h visita Deltasul e dia 04/06 às 15h visita Quero Quero"\n\n` +
      `⏰ Briefing às 7h · Resumo às 19h\n` +
      `🔗 <a href="https://secretaria-virtual-kz3e.onrender.com">Abrir painel</a>`
    );
  }, 3000);
});
