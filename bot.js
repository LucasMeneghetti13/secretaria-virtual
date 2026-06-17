const http = require("http");
const https = require("https");

// ── CONFIG ──
const TELEGRAM_TOKEN  = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_KEY;
const CHAT_ID         = "8703109963";
const PORT            = process.env.PORT || 3000;
const SUPABASE_URL    = "https://oyiuehtobjeaorlctvhe.supabase.co";
const SUPABASE_KEY    = process.env.SUPABASE_KEY || "sb_secret_OGGGvn5HEWa7_WA7ONWUNQ_YnIhZ4U1";

// ── SUPABASE HELPERS ──
function sbRequest(method, table, body, query) {
  query = query || "";
  return new Promise((resolve) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = {
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      "Prefer": method === "POST" ? "return=representation" : "return=minimal"
    };
    if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr);
    const options = {
      hostname: "oyiuehtobjeaorlctvhe.supabase.co",
      path: "/rest/v1/" + table + query,
      method, headers
    };
    const req = https.request(options, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: d ? JSON.parse(d) : null }); }
        catch(e) { resolve({ status: res.statusCode, data: null }); }
      });
    });
    req.on("error", (e) => { console.error("Supabase err:", e.message); resolve({ status: 500, data: null }); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function sbGet(table) {
  const r = await sbRequest("GET", table, null, "?order=created_at.asc");
  return Array.isArray(r.data) ? r.data : [];
}

async function sbInsert(table, row) {
  const r = await sbRequest("POST", table, row);
  return (Array.isArray(r.data) && r.data[0]) ? r.data[0] : row;
}

async function sbUpdate(table, id, row) {
  await sbRequest("PATCH", table, row, "?id=eq." + id);
}

async function sbDelete(table, id) {
  await sbRequest("DELETE", table, null, "?id=eq." + id);
}

async function loadFromSupabase() {
  try {
    const [tr, ev, tk, mt, hb, cfg] = await Promise.all([
      sbGet("transacoes"), sbGet("eventos"), sbGet("tarefas"),
      sbGet("metas"), sbGet("habitos"),
      sbRequest("GET", "configuracoes", null, "?chave=eq.cfg&select=valor")
    ]);
    state.transacoes = tr.map(t => ({...t, desc: t.descricao, dataPgto: t.data_pgto}));
    state.eventos    = ev.map(e => ({...e, desc: e.descricao, diaTodo: e.dia_todo, concluido: e.concluido||false}));
    state.tarefas    = tk;
    state.metas      = mt;
    if (hb.length) state.habitos = hb.map(h => h.texto);
    // Carrega categorias e contas personalizadas
    if (cfg.data?.[0]?.valor) {
      try {
        const userCfg = JSON.parse(cfg.data[0].valor);
        if (userCfg.cats) state.userCats = userCfg.cats;
        if (userCfg.contas) state.userContas = userCfg.contas.map(c => c.nome || c);
        if (userCfg.tipos) state.userTipos = userCfg.tipos;
        if (userCfg.emailsUrgentes) state.emailsUrgentes = userCfg.emailsUrgentes;
      } catch(e) {}
    }
    console.log("📂 Supabase: " + state.transacoes.length + " transações, " + state.eventos.length + " eventos, " + state.tarefas.length + " tarefas | cats: " + (state.userCats||[]).join(', '));
  } catch(e) { console.error("❌ loadFromSupabase:", e.message); }
}

async function saveTransacao(t) {
  return sbInsert("transacoes", {
    id: t.id, tipo: t.tipo, valor: t.valor,
    descricao: t.desc||t.descricao||"", cat: t.cat,
    conta: t.conta||"", data: t.data, data_pgto: t.dataPgto||t.data
  });
}

async function saveEvento(e) {
  return sbInsert("eventos", {
    id: e.id, titulo: e.titulo, data: e.data, hora: e.hora||"",
    tipo: e.tipo||"Trabalho", link: e.link||"",
    descricao: e.desc||"", dia_todo: e.diaTodo||false
  });
}

async function saveTarefa(t) {
  return sbInsert("tarefas", {
    id: t.id, nome: t.nome, prio: t.prio||"media",
    prazo: t.prazo||"", cat: t.cat||"Trabalho", done: t.done||false
  });
}

async function saveMeta(m) {
  return sbInsert("metas", {
    id: m.id, nome: m.nome, alvo: m.alvo||0,
    atual: m.atual||0, prazo: m.prazo||"", cat: m.cat||"Pessoal"
  });
}

function saveData() {} // mantido para compatibilidade

// ── ESTADO ──
let state = {
  transacoes: [],
  tarefas: [],
  eventos: [],
  metas: [],
  userCats: [],
  userContas: [],
  userTipos: [],
  emailsUrgentes: [],
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
  const hoje = hojeStr();
  const amanha = new Date(new Date().setDate(new Date().getDate()+1)).toISOString().split('T')[0];
  const diaSemana = new Date().toLocaleDateString("pt-BR", {weekday:"long", timeZone:"America/Sao_Paulo"});
  // Calcula próximos dias da semana para referência
  const diasRef = [];
  for (let i=1; i<=7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const ds = d.toLocaleDateString("pt-BR", {weekday:"long", timeZone:"America/Sao_Paulo"});
    const dt = d.toLocaleDateString("en-CA", {timeZone:"America/Sao_Paulo"});
    diasRef.push(`${ds}=${dt}`);
  }
  const eventosHoje = state.eventos.filter(e=>e.data===hoje);
  const eventosAmanha = state.eventos.filter(e=>e.data===amanha);
  const proxEventos = state.eventos.filter(e=>e.data>hoje).sort((a,b)=>a.data>b.data?1:-1).slice(0,5);
  return `HOJE: ${hoje} (${diaSemana}) | AMANHÃ: ${amanha}
PRÓXIMOS DIAS: ${diasRef.join(" | ")}
FINANÇAS: receitas ${fmt(rec)} | despesas ${fmt(desp)} | saldo ${fmt(rec-desp)}
EVENTOS HOJE (${eventosHoje.length}): ${eventosHoje.length ? eventosHoje.map(e=>`${e.titulo}${e.hora?" "+e.hora:""}`).join("; ") : "nenhum"}
EVENTOS AMANHÃ (${eventosAmanha.length}): ${eventosAmanha.length ? eventosAmanha.map(e=>`${e.titulo}${e.hora?" "+e.hora:""}`).join("; ") : "nenhum"}
PRÓXIMOS EVENTOS: ${proxEventos.length ? proxEventos.map(e=>`${e.titulo} em ${e.data}${e.hora?" "+e.hora:""}`).join("; ") : "nenhum"}
TAREFAS PENDENTES (${pendentes.length}): ${pendentes.length ? pendentes.map(t=>`${t.nome} [${t.prio}]${t.prazo?" prazo:"+t.prazo:""}`).join("; ") : "nenhuma"}
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

    const systemPrompt = `Você é a Claudete, secretária virtual pessoal do Lucas Meneghetti. Você é eficiente, simpática e direta — como uma boa secretária que conhece bem o chefe. Você gerencia finanças, agenda, tarefas, metas, e-mails e fornece informações.

Personalidade da Claudete:
- Chama o Lucas pelo nome às vezes, mas não em toda mensagem
- É objetiva mas tem um toque de simpatia e humor leve quando pertinente
- Usa emojis com moderação — só quando fazem sentido
- Quando não consegue fazer algo, explica de forma clara e sugere alternativa
- Conhece bem a rotina do Lucas: ele trabalha com imóveis (Meneghetii Móveis) e tem o Cacafé

ESTADO ATUAL DO SISTEMA:
${resumoState()}

⚠️ REGRA ABSOLUTA: Responda SEMPRE e SOMENTE com JSON válido, sem texto antes ou depois, sem markdown, sem \`\`\`. Nunca responda em texto puro.

SUAS CAPACIDADES — você pode executar essas ações respondendo com JSON:

Para CRIAR EVENTO ÚNICO:
{"acao":"criar_evento","titulo":"...","data":"YYYY-MM-DD","hora":"HH:MM","tipo":"Trabalho|Pessoal|Saúde|Social|Imóveis|Outro","link":"...opcional","diaTodo":false}

Para CRIAR MÚLTIPLOS EVENTOS (SEMPRE use quando houver 2+ eventos ou período de datas):
{"acao":"criar_eventos","eventos":[{"titulo":"...","data":"YYYY-MM-DD","hora":"HH:MM","tipo":"...","diaTodo":false}]}

Para CRIAR TAREFA ÚNICA:
{"acao":"criar_tarefa","nome":"...","prio":"alta|media|baixa","prazo":"YYYY-MM-DD","cat":"Trabalho|Pessoal|Financeiro|Saúde|Imóveis|Outro"}

Para CRIAR MÚLTIPLAS TAREFAS (SEMPRE use quando houver 2+ tarefas):
{"acao":"criar_tarefas","tarefas":[{"nome":"...","prio":"alta|media|baixa","prazo":"YYYY-MM-DD","cat":"Trabalho|Pessoal|Financeiro|Saúde|Imóveis|Outro"}]}

Para CONCLUIR TAREFA ÚNICA:
{"acao":"concluir_tarefa","nome":"..."}

Para CONCLUIR MÚLTIPLAS TAREFAS (quando pedir para marcar várias ou todas como concluídas):
{"acao":"concluir_tarefas","nomes":["tarefa 1","tarefa 2","..."]}

Para LANÇAR TRANSAÇÃO:
{"acao":"lancar_transacao","tipo":"receita|despesa","valor":0.00,"desc":"...","cat":"use as categorias do usuário abaixo","conta":"use as contas do usuário abaixo"}

CATEGORIAS DISPONÍVEIS (use exatamente esses nomes):
${state.userCats.length ? state.userCats.join(' | ') : 'Alimentação | Moradia | Transporte | Saúde | Educação | Lazer | Salário | Imóveis | Outros'}

CONTAS/CARTÕES DISPONÍVEIS (use exatamente esses nomes):
${state.userContas.length ? state.userContas.join(' | ') : 'Conta corrente | Cartão crédito | PIX | Dinheiro'}

TIPOS DE EVENTO DISPONÍVEIS:
${state.userTipos.length ? state.userTipos.join(' | ') : 'Trabalho | Pessoal | Saúde | Social | Outro'}

Para CRIAR META:
{"acao":"criar_meta","nome":"...","alvo":0.00,"atual":0.00,"prazo":"YYYY-MM-DD","cat":"Financeiro|Saúde|Carreira|Pessoal|Imóveis|Educação"}

Para ATUALIZAR META:
{"acao":"atualizar_meta","nome":"...","atual":0.00}

Para EDITAR EVENTO (quando pedir para alterar data, hora ou título de um evento):
{"acao":"editar_evento","titulo_atual":"nome atual do evento","titulo":"novo título","data":"YYYY-MM-DD","hora":"HH:MM","tipo":"Trabalho"}

Para DELETAR EVENTO:
{"acao":"deletar_evento","titulo":"..."}

Para BUSCAR NOTÍCIAS (quando pedir notícias, manchetes, o que aconteceu):
{"acao":"buscar_noticias"}

Para VERIFICAR COMPROMISSOS ATRASADOS (quando perguntar sobre pendentes, atrasados, o que ficou pra trás, o que passou):
{"acao":"verificar_atrasados"}

Para MARCAR EVENTO COMO CONCLUÍDO (quando disser que fez, realizou, concluiu um compromisso):
{"acao":"concluir_evento","titulo":"..."}

Para CRIAR NOTA (quando pedir para anotar, registrar, guardar uma informação, lembrete de texto):
{"acao":"criar_nota","titulo":"...","conteudo":"...","pasta":"Geral"}



Para LANÇAR COMPRA PARCELADA (quando mencionar parcelas, parcelado, X vezes):
{"acao":"lancar_parcelado","valor_total":0.00,"ou_valor_parcela":0.00,"parcelas":6,"desc":"...","cat":"...","conta":"...","data_compra":"YYYY-MM-DD","primeira_parcela":"YYYY-MM-DD"}
Use valor_total se informou o total, ou_valor_parcela se informou o valor da parcela. Calcule a primeira_parcela como o próximo mês se não informado.


{"acao":"relatorio","tipo":"despesa|receita|todos","mes":"01-12 ou vazio","ano":"2026 ou vazio","cat":"categoria ou vazio","conta":"conta ou vazio"}



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
10. Quando criar múltiplos itens, confirme todos na resposta
11. Transação financeira SEM conta informada: responda com {"acao":"responder","mensagem":"Foi no cartão de crédito, débito, PIX ou dinheiro?"} e aguarde a resposta antes de registrar
12. Para editar/alterar/mudar/corrigir evento existente, use a ação "editar_evento" com "titulo_atual" (nome atual) e os campos novos
13. Formato rápido com pipe: "50 almoço Rio Grande | empresa | débito Sicoob" = valor+desc | categoria | conta. Interprete da mesma forma que texto livre`;

    const body = JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 4000,
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
    // Remove markdown code blocks se existir
    const clean = jsonStr.replace(/```json\s*/gi,'').replace(/```\s*/gi,'').trim();
    // Extrai JSON mesmo se vier com texto ao redor
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) {
      return clean || "Não entendi. Pode repetir de outra forma?";
    }
    // Tenta fazer o parse — se falhar o JSON está incompleto
    try {
      action = JSON.parse(match[0]);
    } catch(parseErr) {
      console.error("❌ JSON inválido (possivelmente truncado):", match[0].substring(0,200));
      return "O comando era muito longo e foi cortado. Tente dividir em partes menores — por exemplo, mande metade dos compromissos de cada vez.";
    }
  } catch(e) {
    const clean = jsonStr.replace(/```json\s*/gi,'').replace(/```\s*/gi,'').trim();
    return clean || "Não consegui interpretar a resposta. Pode repetir de outra forma?";
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
      await saveEvento(state.eventos[state.eventos.length-1]);
      return `📅 <b>Evento agendado!</b>\n\n• <b>${action.titulo}</b>\n📆 ${d[2]}/${d[1]}/${d[0]}${action.hora ? " às "+action.hora : " — dia todo"}${action.link?"\n🔗 "+action.link:""}`;
    }

    case "criar_eventos": {
      const criados = [];
      let erros = 0;
      for (let i = 0; i < action.eventos.length; i++) {
        const ev = action.eventos[i];
        // ID único garantido com índice
        const novoEv = {
          id: Date.now() + i * 10,
          titulo: ev.titulo, data: ev.data,
          hora: ev.hora || "", tipo: ev.tipo || "Trabalho",
          link: ev.link || "", desc: "", diaTodo: ev.diaTodo || false,
          concluido: false
        };
        try {
          await saveEvento(novoEv);
          state.eventos.push(novoEv);
          const d = ev.data.split("-");
          criados.push(`• <b>${ev.titulo}</b> — ${d[2]}/${d[1]}/${d[0]}${ev.hora?" às "+ev.hora:""}`);
        } catch(e) {
          erros++;
          console.error(`❌ Erro ao salvar evento ${ev.titulo}:`, e.message);
        }
        // Pequena pausa entre salvamentos para evitar conflito de ID
        if (i < action.eventos.length - 1) await new Promise(r => setTimeout(r, 50));
      }
      let msg = `📅 <b>${criados.length} evento(s) agendado(s)!</b>\n\n${criados.join("\n")}`;
      if (erros > 0) msg += `\n\n⚠️ ${erros} evento(s) não puderam ser salvos. Tente novamente.`;
      msg += `\n\n🔗 <a href="https://secretaria-virtual-kz3e.onrender.com">Ver no painel</a>`;
      return msg;
    }

    case "lancar_transacao": {
      state.transacoes.push({
        id: Date.now(),
        tipo: action.tipo, valor: action.valor,
        desc: action.desc, cat: action.cat || "Outros",
        conta: action.conta || "Não informado",
        data: hojeStr(), dataPgto: hojeStr()
      });
      await saveTransacao(state.transacoes[state.transacoes.length-1]);
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
      await saveTarefa(state.tarefas[state.tarefas.length-1]);
      return `✅ <b>Tarefa criada!</b>\n\n${prioEmoji} ${action.nome}\n📂 ${action.cat}${action.prazo?"\n📅 Prazo: "+action.prazo:""}`;
    }

    case "criar_tarefas": {
      const criadas = [];
      for (let i = 0; i < action.tarefas.length; i++) {
        const t = action.tarefas[i];
        const novaTarefa = {
          id: Date.now() + i * 10,
          nome: t.nome, prio: t.prio || "media",
          prazo: t.prazo || "", cat: t.cat || "Trabalho", done: false
        };
        await saveTarefa(novaTarefa);
        state.tarefas.push(novaTarefa);
        const prioEmoji = t.prio==="alta"?"🔴":t.prio==="baixa"?"🟢":"🟡";
        criadas.push(`${prioEmoji} ${t.nome}`);
        if (i < action.tarefas.length - 1) await new Promise(r => setTimeout(r, 50));
      }
      return `✅ <b>${criadas.length} tarefas criadas!</b>\n\n${criadas.join("\n")}`;
    }

    case "criar_nota": {
      const nota = {
        id: Date.now(),
        titulo: action.titulo || "Nota",
        conteudo: action.conteudo || "",
        pasta: action.pasta || "Geral",
        data: hojeStr(),
        created_at: new Date().toISOString()
      };
      // Salva via API do painel
      return `📝 <b>Nota salva!</b>\n\n<b>${nota.titulo}</b>\n${nota.conteudo}\n📂 ${nota.pasta}`;
    }

    case "concluir_evento": {
      const ev = state.eventos.find(e =>
        e.titulo.toLowerCase().includes(action.titulo.toLowerCase())
      );
      if (ev) {
        ev.concluido = true;
        await sbUpdate("eventos", ev.id, { concluido: true });
        return `✅ <b>${ev.titulo}</b> marcado como concluído! Registrado no histórico.`;
      }
      return `Não encontrei esse compromisso. Pode repetir o nome?`;
    }

    case "verificar_atrasados": {
      const hoje = hojeStr();
      const atrasados = state.eventos
        .filter(e => e.data < hoje && !e.concluido)
        .sort((a,b) => a.data > b.data ? 1 : -1);
      if (!atrasados.length) {
        return `✅ Nenhum compromisso atrasado! Tudo em dia, Lucas.`;
      }
      let msg = `⚠️ <b>${atrasados.length} compromisso(s) passado(s) sem confirmação:</b>\n\n`;
      atrasados.forEach(e => {
        const d = e.data.split("-");
        msg += `📅 <b>${e.titulo}</b>\n`;
        msg += `   ${d[2]}/${d[1]}/${d[0]}${e.hora?" às "+e.hora:""}\n\n`;
      });
      msg += `Quer reagendar algum ou marcar como feito? É só me falar!`;
      return msg;
    }

    case "verificar_emails": {
      await sendTelegram("📧 Verificando sua caixa de entrada...");
      await buscarEmailsNovos();
      const info = _emailsInformativos.length;
      if (info > 0) {
        let msg = `📬 <b>${info} e-mail(s) informativo(s):</b>\n`;
        _emailsInformativos.forEach(e => {
          msg += `• <b>${e.from.split("<")[0].trim()}</b> — ${e.subject}\n`;
        });
        return msg;
      }
      return "📭 Nenhum e-mail novo no momento. E-mails urgentes são enviados assim que chegam!";
    }

    case "buscar_noticias": {
      const noticias = await fetchNews();
      return `📰 <b>Notícias agora</b>\n\n${noticias}\n\n<i>Fonte: Folha de S.Paulo</i>`;
    }

    case "concluir_tarefa": {
      const t = state.tarefas.find(t => t.nome.toLowerCase().includes(action.nome.toLowerCase()));
      if (t) {
        t.done = true;
        await sbUpdate("tarefas", t.id, { done: true });
        return `✅ Tarefa "<b>${t.nome}</b>" marcada como concluída!`;
      }
      return `Não encontrei uma tarefa com esse nome.`;
    }

    case "concluir_tarefas": {
      const nomes = action.nomes || [];
      const concluidas = [];
      const naoEncontradas = [];
      // Se pediu "todas", conclui todas as pendentes
      const todasPendentes = state.tarefas.filter(t => !t.done);
      const lista = nomes.length === 0 ? todasPendentes.map(t => t.nome) : nomes;
      for (const nome of lista) {
        const t = state.tarefas.find(t => !t.done && t.nome.toLowerCase().includes(nome.toLowerCase()));
        if (t) {
          t.done = true;
          await sbUpdate("tarefas", t.id, { done: true });
          concluidas.push(t.nome);
        } else {
          naoEncontradas.push(nome);
        }
      }
      let msg = `✅ <b>${concluidas.length} tarefa(s) concluída(s)!</b>\n`;
      concluidas.forEach(n => msg += `• ${n}\n`);
      if (naoEncontradas.length) msg += `\n⚠️ Não encontrei: ${naoEncontradas.join(", ")}`;
      return msg;
    }

    case "criar_meta": {
      state.metas.push({
        id: Date.now(), nome: action.nome,
        alvo: action.alvo, atual: action.atual || 0,
        prazo: action.prazo || "", cat: action.cat || "Pessoal"
      });
      await saveMeta(state.metas[state.metas.length-1]);
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

    case "editar_evento": {
      const ev = state.eventos.find(e =>
        e.titulo.toLowerCase().includes((action.titulo_atual||action.titulo).toLowerCase())
      );
      if (ev) {
        if (action.data) ev.data = action.data;
        if (action.hora !== undefined) ev.hora = action.hora;
        if (action.titulo && action.titulo_atual) ev.titulo = action.titulo;
        if (action.tipo) ev.tipo = action.tipo;
        if (action.link !== undefined) ev.link = action.link;
        // Salva no Supabase
        await sbUpdate("eventos", ev.id, {
          titulo: ev.titulo, data: ev.data,
          hora: ev.hora||"", tipo: ev.tipo||"Trabalho",
          link: ev.link||""
        });
        const d = ev.data.split("-");
        return `✏️ <b>Evento atualizado!</b>\n\n• <b>${ev.titulo}</b>\n📆 ${d[2]}/${d[1]}/${d[0]}${ev.hora?" às "+ev.hora:""}`;
      }
      return `Não encontrei o evento "${action.titulo_atual||action.titulo}". Verifique o nome e tente novamente.`;
    }

    case "deletar_evento": {
      const ev = state.eventos.find(e => e.titulo.toLowerCase().includes(action.titulo.toLowerCase()));
      if (ev) {
        await sbDelete("eventos", ev.id);
        state.eventos = state.eventos.filter(e => e.id !== ev.id);
        return `🗑️ Evento "<b>${ev.titulo}</b>" removido da agenda.`;
      }
      return `Não encontrei um evento com esse nome.`;
    }

    case "lancar_parcelado": {
      const n = action.parcelas || 2;
      const valorParcela = action.ou_valor_parcela || (action.valor_total ? Math.round((action.valor_total / n) * 100) / 100 : 0);
      const valorTotal = action.valor_total || valorParcela * n;
      if (!valorParcela) return "Não consegui identificar o valor. Pode repetir informando o valor total ou o valor de cada parcela?";
      const dataCompra = action.data_compra || hojeStr();
      // Primeira parcela — próximo mês se não informado
      let primeiraParcela = action.primeira_parcela;
      if (!primeiraParcela) {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        d.setDate(1);
        primeiraParcela = d.toISOString().split('T')[0];
      }
      const [pAno, pMes, pDia] = primeiraParcela.split('-').map(Number);
      const criadas = [];
      for (let i = 0; i < n; i++) {
        const pgto = new Date(pAno, pMes - 1 + i, pDia);
        const pgtoStr = pgto.getFullYear() + '-' + String(pgto.getMonth()+1).padStart(2,'0') + '-' + String(pgto.getDate()).padStart(2,'0');
        const descParcela = `${action.desc} (${i+1}/${n})`;
        const tx = { id: Date.now() + i, tipo: "despesa", valor: valorParcela, desc: descParcela, descricao: descParcela, cat: action.cat || "Outros", conta: action.conta || "", data: dataCompra, dataPgto: pgtoStr, data_pgto: pgtoStr };
        state.transacoes.push(tx);
        await saveTransacao(tx);
        criadas.push(pgtoStr);
      }
      const d = primeiraParcela.split('-');
      return `💳 <b>${n} parcelas lançadas!</b>\n\n📦 ${action.desc}\n💰 ${n}x de ${fmt(valorParcela)} = ${fmt(valorTotal)} no total\n🏦 ${action.conta||'Cartão'}\n📅 ${d[2]}/${d[1]}/${d[0]} → ${criadas[n-1].split('-').reverse().join('/')}`;
    }

    case "relatorio": {
      const filtradas = state.transacoes.filter(t => {
        const dtBase = t.dataPgto || t.data_pgto || t.data || '';
        const parts = dtBase.split('-');
        if (action.mes && parts[1] !== action.mes.padStart(2,'0')) return false;
        if (action.ano && parts[0] !== action.ano) return false;
        if (action.tipo && action.tipo !== 'todos' && t.tipo !== action.tipo) return false;
        if (action.cat && t.cat !== action.cat) return false;
        if (action.conta && t.conta !== action.conta) return false;
        return true;
      });
      const rec = filtradas.filter(t=>t.tipo==='receita').reduce((s,t)=>s+t.valor,0);
      const desp = filtradas.filter(t=>t.tipo==='despesa').reduce((s,t)=>s+t.valor,0);
      const catMap = {};
      filtradas.filter(t=>t.tipo==='despesa').forEach(t=>{catMap[t.cat]=(catMap[t.cat]||0)+t.valor;});
      const mesesNome = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      const periodo = action.mes ? mesesNome[parseInt(action.mes)-1]+(action.ano?'/'+action.ano:'') : (action.ano||'todos os períodos');
      let msg = `📊 <b>Relatório — ${periodo}</b>\n`;
      if (action.cat) msg += `📂 Categoria: ${action.cat}\n`;
      if (action.conta) msg += `💳 Conta: ${action.conta}\n`;
      msg += `\n💰 Receitas: ${fmt(rec)}\n💸 Despesas: ${fmt(desp)}\n`;
      msg += `📈 Saldo: ${fmt(rec-desp)}\n\n`;
      if (Object.keys(catMap).length) {
        msg += `<b>Por categoria:</b>\n`;
        Object.keys(catMap).sort((a,b)=>catMap[b]-catMap[a]).slice(0,8).forEach(c=>{
          msg += `• ${c}: ${fmt(catMap[c])}\n`;
        });
        msg += '\n';
      }
      msg += `<b>Lançamentos (${filtradas.length}):</b>\n`;
      filtradas.slice().sort((a,b)=>{
        const da=a.dataPgto||a.data||'', db=b.dataPgto||b.data||'';
        return da>db?1:-1;
      }).slice(0,15).forEach(t=>{
        const d=(t.dataPgto||t.data||'').split('-');
        const data=d.length===3?d[2]+'/'+d[1]:'';
        msg += `${t.tipo==='receita'?'💚':'🔴'} ${data} ${t.desc||t.descricao||''} — ${fmt(t.valor)}\n`;
      });
      if (filtradas.length > 15) msg += `<i>... e mais ${filtradas.length-15} lançamentos</i>\n`;
      msg += `\n🔗 <a href="https://secretaria-virtual-kz3e.onrender.com">Ver relatório completo no painel</a>`;
      return msg;
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
const NEWSAPI_KEY = "7a81c82b82d84c51a99ce66080c6c360";
let _newsCache = { texto: null, time: 0 };

function fetchFromNewsAPI(query) {
  return new Promise((resolve) => {
    const params = "q=" + encodeURIComponent(query) + "&language=pt&sortBy=publishedAt&pageSize=3&apiKey=" + NEWSAPI_KEY;
    const options = {
      hostname: "newsapi.org",
      path: "/v2/everything?" + params,
      method: "GET",
      headers: { "User-Agent": "SecretariaVirtual/1.0" }
    };
    const req = https.request(options, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { resolve({ articles: [] }); }
      });
    });
    req.on("error", () => resolve({ articles: [] }));
    req.end();
  });
}

function formatarArtigo(art) {
  if (!art || !art.title || art.title.includes("[Removed]")) return null;
  const titulo = art.title.replace(/\s*-\s*[^-]+$/, "").trim();
  const fonte = art.source?.name || "";
  const data = art.publishedAt ? new Date(art.publishedAt).toLocaleDateString("pt-BR", {day:"2-digit",month:"2-digit"}) : "";
  const desc = art.description ? art.description.substring(0, 150).trim() + "..." : "";
  return "• <b>" + titulo + "</b>\n  " + desc + "\n  <i>" + fonte + " · " + data + "</i>";
}

async function fetchNews(categoria) {
  const agora = Date.now();
  if (_newsCache.texto && agora - _newsCache.time < 6 * 60 * 60 * 1000) {
    return _newsCache.texto;
  }
  try {
    const temas = [
      { nome: "💰 Economia", query: "economia brasil negócios" },
      { nome: "💻 Tecnologia & IA", query: "inteligência artificial tecnologia inovação" },
      { nome: "🏎️ Automobilismo", query: "formula 1 NASCAR MotoGP automobilismo" },
      { nome: "📊 Mercado", query: "mercado imobiliário investimento brasil" },
      { nome: "🗳️ Brasil", query: "brasil política economia noticias" }
    ];
    const resultados = await Promise.all(
      temas.map(t => fetchFromNewsAPI(t.query).then(r => ({ tema: t.nome, articles: r.articles || [] })))
    );
    let texto = "";
    let total = 0;
    for (const res of resultados) {
      const artigos = res.articles.filter(a => a.title && !a.title.includes("[Removed]")).slice(0, 2);
      if (!artigos.length) continue;
      texto += "\n" + res.tema + "\n";
      for (const art of artigos) {
        const f = formatarArtigo(art);
        if (f) { texto += f + "\n"; total++; }
      }
    }
    if (!texto || total === 0) return "Não encontrei notícias no momento. Tente mais tarde.";
    _newsCache = { texto: texto.trim(), time: agora };
    return _newsCache.texto;
  } catch(e) {
    console.error("fetchNews error:", e.message);
    return "Erro ao buscar notícias. Tente novamente.";
  }
}

// ── EMAIL IMAP ──
const tls = require("tls");

const EMAIL_CONFIG = {
  host: "mail.meneghettimoveis.com.br",
  port: 993,
  user: "lucas@meneghettimoveis.com.br",
  pass: process.env.EMAIL_PASS || "Esmeralda@4s"
};

let _emailsVistos = new Set(); // UIDs já processados
let _emailsInformativos = []; // acumula para briefing

function imapConnect() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: EMAIL_CONFIG.host, port: EMAIL_CONFIG.port, rejectUnauthorized: false });
    let buffer = "";
    let tagCount = 0;
    const commands = [];
    let cmdIndex = 0;
    let onData = null;

    socket.on("data", d => {
      buffer += d.toString();
      if (onData) onData(buffer);
    });
    socket.on("error", reject);

    function sendCmd(cmd) {
      return new Promise((res) => {
        tagCount++;
        const tag = "A" + String(tagCount).padStart(3,"0");
        const full = tag + " " + cmd + "\r\n";
        buffer = "";
        onData = (buf) => {
          if (buf.includes(tag + " OK") || buf.includes(tag + " NO") || buf.includes(tag + " BAD")) {
            onData = null;
            res(buf);
          }
        };
        socket.write(full);
      });
    }

    socket.once("data", async () => {
      try {
        await sendCmd(`LOGIN "${EMAIL_CONFIG.user}" "${EMAIL_CONFIG.pass}"`);
        resolve({ sendCmd, socket });
      } catch(e) { reject(e); }
    });
  });
}

async function buscarEmailsNovos() {
  try {
    const { sendCmd, socket } = await imapConnect();
    await sendCmd("SELECT INBOX");

    // Busca não lidos
    const searchRes = await sendCmd("SEARCH UNSEEN");
    const match = searchRes.match(/\* SEARCH([\d\s]*)/);
    const uids = match ? match[1].trim().split(/\s+/).filter(Boolean) : [];

    const novos = uids.filter(u => !_emailsVistos.has(u)).slice(-10); // max 10 por vez

    for (const uid of novos) {
      _emailsVistos.add(uid);
      const fetchRes = await sendCmd(`FETCH ${uid} (BODY[HEADER.FIELDS (FROM SUBJECT DATE)] BODY[TEXT]<0.500>)`);

      // Extrai campos básicos
      const fromMatch = fetchRes.match(/From:\s*(.+)/i);
      const subjectMatch = fetchRes.match(/Subject:\s*(.+)/i);
      const from = fromMatch ? fromMatch[1].trim().replace(/\r/g,"") : "Desconhecido";
      const subject = subjectMatch ? subjectMatch[1].trim().replace(/\r/g,"") : "(sem assunto)";

      // Classifica com IA
      const classificacao = await classificarEmail(from, subject);

      if (classificacao === "urgente") {
        await sendTelegram(`📧 <b>E-mail urgente!</b>\n\n<b>De:</b> ${from}\n<b>Assunto:</b> ${subject}\n\n<i>Responda: "responder e-mail de ${from.split("<")[0].trim()} dizendo..."</i>`);
      } else if (classificacao === "informativo") {
        _emailsInformativos.push({ from, subject, time: new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) });
      }
      // spam/marketing: ignora
    }

    socket.write("A999 LOGOUT\r\n");
    setTimeout(() => socket.destroy(), 500);
  } catch(e) {
    console.error("❌ IMAP error:", e.message);
  }
}

async function classificarEmail(from, subject) {
  const fromLower = from.toLowerCase();
  const subLower = subject.toLowerCase();

  // Lista branca — sempre urgente
  const whitelist = state.emailsUrgentes || [];
  if (whitelist.some(e => fromLower.includes(e.toLowerCase()))) return "urgente";

  // Spam óbvio
  const spamPatterns = ["unsubscribe","descadastrar","newsletter","promoção","oferta",
    "desconto","sale","noreply","no-reply","marketing","notify@","notification@","donotreply",
    "fatura eletrônica","não responda","não responda este","automaticamente gerado"];
  if (spamPatterns.some(p => fromLower.includes(p) || subLower.includes(p))) return "spam";

  // Padrões urgentes por assunto
  const urgentPatterns = ["urgente","importante","contrato","proposta","reunião","pagamento",
    "vencimento","boleto","cliente","fornecedor","prazo","orçamento","fatura","cobrança",
    "imóvel","visita","proposta","negócio"];
  if (urgentPatterns.some(p => subLower.includes(p))) return "urgente";

  // Domínio corporativo = informativo
  if (fromLower.includes("@") && !fromLower.includes("gmail") &&
      !fromLower.includes("hotmail") && !fromLower.includes("yahoo")) {
    return "informativo";
  }

  // Chama IA para o resto
  try {
    const body = JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 20,
      messages: [{ role: "user", content: `Classifique este e-mail. Responda APENAS uma palavra: urgente, informativo ou spam.\n\nDe: ${from}\nAssunto: ${subject}` }]
    });
    const res = await callAnthropic(body);
    const txt = res.toLowerCase();
    if (txt.includes("urgente")) return "urgente";
    if (txt.includes("spam")) return "spam";
    return "informativo";
  } catch(e) {
    return "informativo";
  }
}

function callAnthropic(bodyStr) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(options, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(d);
          resolve(parsed.content?.[0]?.text || "");
        } catch(e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}


// Resolve datas relativas para datas concretas antes de enviar à IA
function resolverDatasRelativas(text) {
  const diasSemana = {
    'segunda':1,'segunda-feira':1,'seg':1,
    'terça':2,'terca':2,'terça-feira':2,'ter':2,
    'quarta':3,'quarta-feira':3,'qua':3,
    'quinta':4,'quinta-feira':4,'qui':4,
    'sexta':5,'sexta-feira':5,'sex':5,
    'sábado':6,'sabado':6,'sab':6,
    'domingo':0,'dom':0
  };

  function proximoDia(diaSemanaAlvo) {
    const d = new Date();
    const brt = new Date(d.toLocaleString("en-US", {timeZone:"America/Sao_Paulo"}));
    const hoje = brt.getDay();
    let diff = diaSemanaAlvo - hoje;
    if (diff <= 0) diff += 7;
    brt.setDate(brt.getDate() + diff);
    return brt.getFullYear()+'-'+String(brt.getMonth()+1).padStart(2,'0')+'-'+String(brt.getDate()).padStart(2,'0');
  }

  function dataRelativa(dias) {
    const d = new Date();
    const brt = new Date(d.toLocaleString("en-US", {timeZone:"America/Sao_Paulo"}));
    brt.setDate(brt.getDate() + dias);
    return brt.getFullYear()+'-'+String(brt.getMonth()+1).padStart(2,'0')+'-'+String(brt.getDate()).padStart(2,'0');
  }

  let result = text;

  // Substitui "próxima sexta", "na sexta", "essa sexta" etc
  result = result.replace(/(?:próxima?|na|essa?|este?)\s+(segunda(?:-feira)?|terça(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sábado|sabado|domingo)/gi, (match, dia) => {
    const key = dia.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace("-feira","");
    const num = diasSemana[dia.toLowerCase()] ?? diasSemana[key];
    if (num === undefined) return match;
    return proximoDia(num) + ' ('+dia+')';
  });

  // Substitui "amanhã"
  result = result.replace(/\bamanhã\b/gi, dataRelativa(1) + ' (amanhã)');

  // Substitui "depois de amanhã"
  result = result.replace(/\bdepois de amanhã\b/gi, dataRelativa(2) + ' (depois de amanhã)');

  // Substitui "hoje"
  result = result.replace(/\bhoje\b/gi, hojeStr() + ' (hoje)');

  if (result !== text) console.log(`📅 Datas resolvidas: "${text}" → "${result}"`);
  return result;
}

async function processMessage(text) {
  console.log(`📨 Mensagem: ${text}`);
  try {
    // Resolve datas relativas antes de enviar à IA
    const textProcessado = resolverDatasRelativas(text);

    // Se a mensagem envolve datas, limpa histórico para evitar contaminação
    if (textProcessado !== text) {
      state.conversationHistory = [];
      console.log(`🗑️ Histórico limpo — data resolvida`);
    }

    const jsonResposta = await callClaude(textProcessado);
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
  // Recarrega dados frescos do Supabase antes do briefing
  await loadFromSupabase();

  const habito = state.habitos[state.habitoIdx % state.habitos.length];
  state.habitoIdx++;
  const pendentes = state.tarefas.filter(t=>!t.done);
  const dataHoje = hojeStr();
  const eventosHoje = state.eventos.filter(e=>e.data===dataHoje);
  const proxEventos = state.eventos
    .filter(e=>e.data>=dataHoje && e.data!==dataHoje)
    .sort((a,b)=>a.data>b.data?1:-1)
    .slice(0,3);

  let msg = `🌅 <b>Bom dia, Lucas!</b>\n📅 ${hoje()}\n_Claudete na área!_ ☕\n\n`;
  msg += `💬 <b>Hábito do dia</b>\n${habito}\n\n`;

  msg += `📆 <b>Agenda de hoje</b>\n`;
  if (!eventosHoje.length) msg += "Nenhum evento hoje.\n";
  else eventosHoje.forEach(e => {
    msg += `• <b>${e.titulo}</b>${e.hora?" — "+e.hora:" — dia todo"}\n`;
    if (e.link) msg += `  🔗 ${e.link}\n`;
  });

  if (proxEventos.length) {
    msg += `\n📌 <b>Próximos compromissos</b>\n`;
    proxEventos.forEach(e => {
      const d = e.data.split("-");
      msg += `• ${e.titulo} — ${d[2]}/${d[1]}${e.hora?" às "+e.hora:""}\n`;
    });
  }

  msg += `\n✅ <b>Tarefas pendentes (${pendentes.length})</b>\n`;
  if (!pendentes.length) msg += "Tudo em dia!\n";
  else {
    const alta = pendentes.filter(t=>t.prio==="alta");
    const media = pendentes.filter(t=>t.prio==="media");
    const baixa = pendentes.filter(t=>t.prio==="baixa");
    if (alta.length) { msg += `\n🔴 <b>Alta prioridade</b>\n`; alta.forEach(t => msg += `• ${t.nome}${t.prazo?" — "+t.prazo:""}\n`); }
    if (media.length) { msg += `\n🟡 <b>Média prioridade</b>\n`; media.slice(0,3).forEach(t => msg += `• ${t.nome}${t.prazo?" — "+t.prazo:""}\n`); }
    if (baixa.length) { msg += `\n🟢 <b>Baixa prioridade</b>\n`; baixa.slice(0,2).forEach(t => msg += `• ${t.nome}\n`); }
  }

  if (state.metas.length) {
    msg += `\n🎯 <b>Metas</b>\n`;
    state.metas.slice(0,3).forEach(m => {
      const pct = m.alvo>0?Math.round(m.atual/m.alvo*100):0;
      const bar = "█".repeat(Math.floor(pct/10))+"░".repeat(10-Math.floor(pct/10));
      msg += `• ${m.nome}: ${bar} ${pct}%\n`;
    });
  }

  // Verifica compromissos atrasados
  const atrasados = state.eventos.filter(e => e.data < dataHoje && !e.concluido);
  if (atrasados.length) {
    msg += `\n⚠️ <b>Compromissos não realizados (${atrasados.length})</b>\n`;
    atrasados.slice(0,3).forEach(e => {
      const d = e.data.split("-");
      msg += `• ${e.titulo} — ${d[2]}/${d[1]}${e.hora?" às "+e.hora:""}\n`;
    });
    msg += `Quer reagendar ou marcar como feitos?\n`;
  }

  if (_emailsInformativos.length) {
    msg += `\n📧 <b>E-mails informativos (${_emailsInformativos.length})</b>\n`;
    _emailsInformativos.slice(0,5).forEach(e => {
      msg += `• <b>${e.from.split("<")[0].trim()}</b> — ${e.subject}\n`;
    });
    _emailsInformativos = [];
  }

  msg += `\n🔗 <a href="https://secretaria-virtual-kz3e.onrender.com">Abrir painel</a>`;
  await sendTelegram(msg);

  // Notícias separadas com mais detalhes
  const noticias = await fetchNews();
  await sendTelegram(`📰 <b>Destaques de hoje</b>\n\n${noticias}`);
}

async function briefingNoite() {
  await loadFromSupabase();

  const dataHoje = hojeStr();
  const txHoje = state.transacoes.filter(t=>t.data===dataHoje);
  const concluidas = state.tarefas.filter(t=>t.done);
  const pendentes = state.tarefas.filter(t=>!t.done);

  let msg = `🌙 <b>Boa noite, Lucas!</b>\n📅 ${hoje()}\n\n`;

  if (txHoje.length) {
    let rec = 0, desp = 0;
    txHoje.forEach(t => { if(t.tipo==="receita") rec+=t.valor; else desp+=t.valor; });
    msg += `💰 <b>Movimentações de hoje</b>\n`;
    txHoje.forEach(t => {
      msg += `• ${t.tipo==="receita"?"+":"-"}${fmt(t.valor)} — ${t.desc||t.descricao}\n`;
    });
    if (rec>0 || desp>0) msg += `Saldo do dia: ${fmt(rec-desp)}\n`;
    msg += "\n";
  } else {
    msg += `💰 <b>Finanças</b>\nNenhuma movimentação hoje.\n\n`;
  }

  msg += `✅ <b>Tarefas</b>\n`;
  msg += `${concluidas.length} concluída(s) hoje\n`;
  if (pendentes.length) {
    msg += `${pendentes.length} ainda pendente(s):\n`;
    pendentes.slice(0,5).forEach(t => {
      const p = t.prio==="alta"?"🔴":t.prio==="baixa"?"🟢":"🟡";
      msg += `${p} ${t.nome}\n`;
    });
  }
  // Compromissos do dia não concluídos
  const naoFeitos = state.eventos.filter(e => e.data === dataHoje && !e.concluido && !e.diaTodo);
  if (naoFeitos.length) {
    msg += `\n📋 <b>Compromissos de hoje sem confirmação (${naoFeitos.length}):</b>\n`;
    naoFeitos.forEach(e => {
      msg += `• <b>${e.titulo}</b>${e.hora?" às "+e.hora:""}\n`;
    });
    msg += `\nForam realizados? Me diga quais marcar como feito ou reagendar! 😊\n`;
  }

  msg += `\n🔗 <a href="https://secretaria-virtual-kz3e.onrender.com">Abrir painel</a>`;
  await sendTelegram(msg);

  const noticias = await fetchNews();
  await sendTelegram(`📰 <b>Notícias das últimas horas</b>\n\n${noticias}`);
}

let _lembretesEnviados = new Set();

function checkBriefings() {
  const now = new Date();
  const hora = now.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour:"2-digit", minute:"2-digit" });
  const dataHoje = hojeStr();

  // Briefings diários
  if (hora === "07:00" && ultimoManha !== dataHoje) { ultimoManha = dataHoje; briefingManha(); }
  if (hora === "19:00" && ultimoNoite !== dataHoje) { ultimoNoite = dataHoje; briefingNoite(); }

  // Lembretes 15 min antes dos eventos
  const nowMin = now.toLocaleTimeString("pt-BR", {timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit"}).split(":").reduce((h,m)=>parseInt(h)*60+parseInt(m));
  state.eventos.forEach(ev => {
    if (!ev.hora || ev.data !== dataHoje) return;
    const [h, m] = ev.hora.split(":").map(Number);
    const evMin = h * 60 + m;
    const diff = evMin - nowMin;
    if (diff >= 14 && diff <= 16) {
      const key = ev.id + "-" + dataHoje;
      if (!_lembretesEnviados.has(key)) {
        _lembretesEnviados.add(key);
        sendTelegram(`⏰ <b>Lembrete!</b>\n\nEm 15 minutos:\n📅 <b>${ev.titulo}</b> às ${ev.hora}${ev.link?"\n🔗 "+ev.link:""}\n${ev.descricao||""}`);
      }
    }
  });
}

// ── POLLING ──
async function pollUpdates() {
  try {
    const updates = await getUpdates(state.lastUpdate);
    if (updates.ok && updates.result.length > 0) {
      for (const update of updates.result) {
        state.lastUpdate = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text) continue;
        // Aceita APENAS mensagens do chat do Lucas
        if (String(msg.chat?.id) !== CHAT_ID) continue;
        // Ignora bots
        if (msg.from?.is_bot) continue;
        // Ignora forwards de canais spam
        if (msg.forward_from_chat) continue;
        if (msg.forward_from) continue;
        // Ignora texto com links de spam conhecidos
        const spamPatterns = ['t.me/A_ToolsX', 't.me/A-ToolsX', 'A_TOOLS', 'A-TOOLS', 'join our channel'];
        if (spamPatterns.some(p => msg.text.toLowerCase().includes(p.toLowerCase()))) continue;
        await processMessage(msg.text);
      }
    }
  } catch(e) { console.error("Poll error:", e); }
  setTimeout(pollUpdates, 2000);
}

// ── SERVIDOR HTTP ──
const server = http.createServer(async (req, res) => {
  const CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, apikey"
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  const url = req.url.split("?")[0];

  // ── GET /api/configuracoes ──
  if (req.method === "GET" && url === "/api/configuracoes") {
    const r = await sbRequest("GET", "configuracoes", null, "?chave=eq.cfg&select=valor");
    const valor = r.data?.[0]?.valor;
    res.writeHead(200, CORS);
    return res.end(JSON.stringify({ ok: true, valor: valor || null }));
  }

  // ── POST /api/configuracoes ──
  if (req.method === "POST" && url === "/api/configuracoes") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      try {
        const { valor } = JSON.parse(body);
        // Tenta PATCH primeiro
        const patch = await sbRequest("PATCH", "configuracoes", { valor }, "?chave=eq.cfg");
        if (!patch.data || patch.status === 404) {
          await sbRequest("POST", "configuracoes", { chave: "cfg", valor });
        }
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  // ── GET /api/noticias ──
  if (req.method === "GET" && url.startsWith("/api/noticias")) {
    res.writeHead(200, CORS);
    // Retorna imediatamente e busca em background
    const noticias = await fetchNews();
    return res.end(JSON.stringify({ ok: true, texto: noticias }));
  }

  // ── GET /api/state — retorna tudo ──
  if (req.method === "GET" && url === "/api/state") {
    // Busca habitos com IDs do Supabase
    const habitosComId = await sbGet("habitos");
    res.writeHead(200, CORS);
    return res.end(JSON.stringify({
      transacoes: state.transacoes,
      tarefas: state.tarefas,
      eventos: state.eventos,
      metas: state.metas,
      habitos: habitosComId // array de {id, texto}
    }));
  }

  // ── POST /api/transacao ──
  if (req.method === "POST" && url === "/api/transacao") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        data.id = Date.now();
        await saveTransacao(data);
        state.transacoes.push(data);
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, data }));
      } catch(e) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }

  // ── PUT /api/transacao/:id ──
  if (req.method === "PUT" && url.startsWith("/api/transacao/")) {
    const id = parseInt(url.split("/")[3]);
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        const t = state.transacoes.find(t => t.id === id);
        if (t) Object.assign(t, data);
        await sbUpdate("transacoes", id, {
          tipo: data.tipo, valor: data.valor,
          descricao: data.desc||data.descricao||'',
          cat: data.cat, conta: data.conta||'',
          data: data.data, data_pgto: data.dataPgto||data.data_pgto||data.data
        });
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }

  // ── DELETE /api/transacao/:id ──
  if (req.method === "DELETE" && url.startsWith("/api/transacao/")) {
    const id = parseInt(url.split("/")[3]);
    await sbDelete("transacoes", id);
    state.transacoes = state.transacoes.filter(t => t.id !== id);
    res.writeHead(200, CORS);
    return res.end(JSON.stringify({ ok: true }));
  }

  // ── POST /api/evento ──
  if (req.method === "POST" && url === "/api/evento") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        data.id = Date.now();
        await saveEvento(data);
        state.eventos.push(data);
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, data }));
      } catch(e) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }

  // ── PUT /api/evento/:id ──
  if (req.method === "PUT" && url.startsWith("/api/evento/")) {
    const id = parseInt(url.split("/")[3]);
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        const e = state.eventos.find(e => e.id === id);
        if (e) {
          Object.assign(e, data);
          await sbUpdate("eventos", id, {
            titulo: e.titulo, data: e.data, hora: e.hora||"",
            tipo: e.tipo||"Trabalho", link: e.link||"",
            concluido: e.concluido||false
          });
        }
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }

  // ── DELETE /api/evento/:id ──
  if (req.method === "DELETE" && url.startsWith("/api/evento/")) {
    const id = parseInt(url.split("/")[3]);
    await sbDelete("eventos", id);
    state.eventos = state.eventos.filter(e => e.id !== id);
    res.writeHead(200, CORS);
    return res.end(JSON.stringify({ ok: true }));
  }

  // ── POST /api/tarefa ──
  if (req.method === "POST" && url === "/api/tarefa") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        data.id = Date.now();
        data.done = false;
        await saveTarefa(data);
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
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        const t = state.tarefas.find(t => t.id === id);
        if (t) { Object.assign(t, data); await sbUpdate("tarefas", id, data); }
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }

  // ── DELETE /api/tarefa/:id ──
  if (req.method === "DELETE" && url.startsWith("/api/tarefa/")) {
    const id = parseInt(url.split("/")[3]);
    await sbDelete("tarefas", id);
    state.tarefas = state.tarefas.filter(t => t.id !== id);
    res.writeHead(200, CORS);
    return res.end(JSON.stringify({ ok: true }));
  }

  // ── POST /api/meta ──
  if (req.method === "POST" && url === "/api/meta") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        data.id = Date.now();
        await saveMeta(data);
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
    req.on("end", async () => {
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
    await sbDelete("metas", id);
    state.metas = state.metas.filter(m => m.id !== id);
    res.writeHead(200, CORS);
    return res.end(JSON.stringify({ ok: true }));
  }

  // ── POST /api/habito ──
  if (req.method === "POST" && url === "/api/habito") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      try {
        const { texto } = JSON.parse(body);
        if (texto) {
          const r = await sbInsert("habitos", { texto });
          state.habitos.push(texto);
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, id: r.id }));
        } else {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false }));
        }
      } catch(e) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }

  // ── DELETE /api/habito/:id ──
  if (req.method === "DELETE" && url.startsWith("/api/habito/")) {
    const id = parseInt(url.split("/")[3]);
    await sbDelete("habitos", id);
    // Reload habitos from Supabase
    const hb = await sbGet("habitos");
    state.habitos = hb.map(h => h.texto);
    res.writeHead(200, CORS);
    return res.end(JSON.stringify({ ok: true }));
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

  loadFromSupabase();
  pollUpdates();
  setInterval(checkBriefings, 60000);
  setInterval(loadFromSupabase, 300000); // re-sync every 5min
  // Verifica e-mails a cada 5 minutos
  setTimeout(() => {
    buscarEmailsNovos();
    setInterval(buscarEmailsNovos, 5 * 60 * 1000);
  }, 10000); // aguarda 10s após iniciar

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
