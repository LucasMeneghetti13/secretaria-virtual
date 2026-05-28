const http = require("http");
const https = require("https");

// ── CONFIG ──
const TELEGRAM_TOKEN = "8887145132:AAHiJpYxa1McXxl27iSJbQXX8YyzoCAKYWw";
const ANTHROPIC_KEY  = "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";
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
  const proxEventos = state.eventos.slice().sort((a,b)=>a.data>b.data?1:-1).slice(0,5);
  return `
DATA HOJE: ${hojeStr()}

FINANCEIRO:
- Receitas: ${fmt(rec)}
- Despesas: ${fmt(desp)}  
- Saldo: ${fmt(rec-desp)}
- Últimas transações: ${state.transacoes.slice(-5).map(t=>`${t.tipo==="receita"?"+":"-"}${fmt(t.valor)} ${t.desc} (${t.data})`).join(", ") || "nenhuma"}

AGENDA (próximos eventos):
${proxEventos.length ? proxEventos.map(e=>`- ${e.titulo} em ${e.data}${e.hora?" às "+e.hora:""}${e.link?" 🔗"+e.link:""}`).join("\n") : "- Nenhum evento"}

TAREFAS PENDENTES (${pendentes.length}):
${pendentes.slice(0,5).map(t=>`- [${t.prio}] ${t.nome}${t.prazo?" (prazo: "+t.prazo+")":""}`).join("\n") || "- Nenhuma"}

METAS:
${state.metas.length ? state.metas.map(m=>{
  const pct = m.alvo>0?Math.round(m.atual/m.alvo*100):0;
  return `- ${m.nome}: ${pct}% (${fmt(m.atual)} de ${fmt(m.alvo)})`;
}).join("\n") : "- Nenhuma meta cadastrada"}

HÁBITOS CONFIGURADOS: ${state.habitos.join(" | ")}
`.trim();
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

Para CRIAR EVENTO:
{"acao":"criar_evento","titulo":"...","data":"YYYY-MM-DD","hora":"HH:MM","tipo":"Trabalho|Pessoal|Saúde|Social|Imóveis|Outro","link":"...opcional","diaTodo":false}

Para CRIAR MÚLTIPLOS EVENTOS (array):
{"acao":"criar_eventos","eventos":[{"titulo":"...","data":"YYYY-MM-DD","hora":"HH:MM","tipo":"...","diaTodo":false}]}

Para LANÇAR TRANSAÇÃO:
{"acao":"lancar_transacao","tipo":"receita|despesa","valor":0.00,"desc":"...","cat":"Alimentação|Moradia|Transporte|Saúde|Educação|Lazer|Salário|Imóveis|Outros","conta":"Conta corrente|Cartão crédito|PIX|Dinheiro|Outro"}

Para CRIAR TAREFA:
{"acao":"criar_tarefa","nome":"...","prio":"alta|media|baixa","prazo":"YYYY-MM-DD","cat":"Trabalho|Pessoal|Financeiro|Saúde|Imóveis|Outro"}

Para CONCLUIR TAREFA:
{"acao":"concluir_tarefa","nome":"..."}

Para CRIAR META:
{"acao":"criar_meta","nome":"...","alvo":0.00,"atual":0.00,"prazo":"YYYY-MM-DD","cat":"Financeiro|Saúde|Carreira|Pessoal|Imóveis|Educação"}

Para ATUALIZAR META:
{"acao":"atualizar_meta","nome":"...","atual":0.00}

Para DELETAR EVENTO:
{"acao":"deletar_evento","titulo":"..."}

Para APENAS RESPONDER (consultas, conversas, análises):
{"acao":"responder","mensagem":"..."}

REGRAS IMPORTANTES:
1. Sempre responda com JSON válido — apenas o JSON, sem texto antes ou depois
2. Para datas relativas: "amanhã" = ${new Date(new Date(hojeStr()).getTime()+86400000).toISOString().split("T")[0]}, "semana que vem" = calcule a partir de hoje
3. Seja direto, warm e objetivo nas mensagens de resposta
4. Use emojis com moderação
5. Quando o usuário contar sobre progresso de metas em linguagem livre, interprete e responda com encorajamento real, não genérico
6. Para análises financeiras, compare com períodos anteriores se tiver dados
7. Responda sempre em português do Brasil
8. Quando criar eventos ou tarefas, confirme o que foi feito de forma clara
9. Para múltiplos eventos na mesma mensagem, use criar_eventos (array)
10. Nunca invente dados — use apenas o que está no estado do sistema`;

    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514",
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
          const parsed = JSON.parse(data);
          const text = parsed.content?.[0]?.text || '{"acao":"responder","mensagem":"Desculpe, não consegui processar sua mensagem."}';
          state.conversationHistory.push({ role: "assistant", content: text });
          resolve(text);
        } catch(e) {
          resolve('{"acao":"responder","mensagem":"Erro ao processar resposta."}');
        }
      });
    });
    req.on("error", () => resolve('{"acao":"responder","mensagem":"Erro de conexão com a IA."}'));
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

// ── BUSCAR NOTÍCIAS ──
function fetchNews() {
  return new Promise((resolve) => {
    const options = {
      hostname: "api.rss2json.com",
      path: "/v1/api.json?rss_url=https%3A%2F%2Ffeeds.folha.uol.com.br%2Femcimadahora%2Frss091.xml&count=5",
      method: "GET"
    };
    const req = https.request(options, (res) => {
      let d = ""; res.on("data", c => d+=c);
      res.on("end", () => {
        try {
          const items = JSON.parse(d).items || [];
          resolve(items.slice(0,4).map(i=>`• ${i.title}`).join("\n"));
        } catch(e) { resolve("• Notícias indisponíveis no momento."); }
      });
    });
    req.on("error", () => resolve("• Serviço de notícias indisponível."));
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
  res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify({
    status: "online",
    eventos: state.eventos.length,
    tarefas: state.tarefas.filter(t=>!t.done).length,
    transacoes: state.transacoes.length,
    metas: state.metas.length
  }));
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
