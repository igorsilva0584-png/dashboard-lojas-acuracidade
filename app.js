const DATA_PATH = './data/';
const BASE_FILE = 'lojas_acuracidade_mensal.csv';

const state = {
  dados: [], atual: null, anterior: null, uf: 'TODAS', busca: '', ranking: 'estoque',
  tabelaSort: { campo: 'estoque_loja', direcao: 'desc' }
};

const TABLE_SORT_CONFIG = {
  3: { campo: 'estoque_inicial_loja', defaultDir: 'desc', label: 'Estoque inicial' },
  4: { campo: 'deltaInicial', defaultDir: 'desc', label: 'Δ Inicial' },
  5: { campo: 'estoque_loja', defaultDir: 'desc', label: 'Estoque loja' },
  6: { campo: 'deltaEstoque', defaultDir: 'desc', label: 'Δ Estoque' },
  7: { campo: 'devol_cd', defaultDir: 'desc', label: 'Devol. CD' },
  8: { campo: 'deltaDevol', defaultDir: 'asc', label: 'Δ Devol.' },
  9: { campo: 'acuracia_estoque', defaultDir: 'asc', label: 'Acurácia' },
  10: { campo: 'deltaAcuracia', defaultDir: 'asc', label: 'Δ p.p.' }
};

async function carregarCSV(nomeArquivo) {
  const response = await fetch(DATA_PATH + nomeArquivo + '?v=' + Date.now());
  if (!response.ok) throw new Error(`Falha ao carregar ${nomeArquivo}: ${response.status}`);
  return parseCSV(await response.text(), ';');
}

function limparTexto(valor) { return String(valor ?? '').replace(/^\uFEFF/, '').trim(); }

function parseNumber(valor) {
  const original = limparTexto(valor);
  if (!original) return 0;
  const temPercentual = original.includes('%');
  let texto = original.replace('%', '').replace(/\s/g, '');
  if (texto.includes(',') && texto.includes('.')) texto = texto.replace(/\./g, '').replace(',', '.');
  else if (texto.includes(',')) texto = texto.replace(',', '.');
  const numero = Number(texto);
  if (!Number.isFinite(numero)) return 0;
  return temPercentual ? numero / 100 : numero;
}

function parseCSV(texto, delimitador = ';') {
  const limpo = String(texto ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!limpo) return [];
  const linhas = limpo.split('\n');
  const cabecalhos = linhas.shift().split(delimitador).map(limparTexto);
  return linhas.filter(linha => linha.trim() !== '').map(linha => {
    const colunas = linha.split(delimitador);
    return Object.fromEntries(cabecalhos.map((cabecalho, i) => [cabecalho, limparTexto(colunas[i])]));
  });
}

function normalizar(row) {
  return {
    periodo: limparTexto(row.periodo), ordem_mes: parseNumber(row.ordem_mes),
    armazem: limparTexto(row.armazem), uf: limparTexto(row.uf),
    estoque_inicial_loja: parseNumber(row.estoque_inicial_loja), estoque_loja: parseNumber(row.estoque_loja),
    devol_cd: parseNumber(row.devol_cd), acuracia_estoque: parseNumber(row.acuracia_estoque),
    prioridade_estoque: 'Baixa'
  };
}

function formatInt(numero) { return Math.round(numero || 0).toLocaleString('pt-BR'); }
function formatPct(numero) { return (Number(numero || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'; }
function formatPP(numero) { const sinal = numero > 0 ? '+' : ''; return sinal + (Number(numero || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' p.p.'; }
function deltaTxt(valor, tipo = 'num') { const sinal = valor > 0 ? '+' : ''; return tipo === 'pct' ? formatPP(valor) : sinal + formatInt(valor); }
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; else console.warn(`Elemento não encontrado no HTML: #${id}`); }
function soma(dados, campo) { return dados.reduce((acc, item) => acc + (item[campo] || 0), 0); }
function getPeriodo(periodo) { return state.dados.filter(item => item.periodo === periodo); }
function anteriorMap() { return new Map(getPeriodo(state.anterior).map(item => [item.armazem, item])); }

function totals(dados) {
  const inicial = soma(dados, 'estoque_inicial_loja');
  const estoque = soma(dados, 'estoque_loja');
  const devol = soma(dados, 'devol_cd');
  return { inicial, estoque, devol, acuracia: inicial > 0 ? devol / inicial : 0, semDevolucao: dados.filter(item => item.estoque_loja > 0 && item.devol_cd === 0).length };
}

function atualFiltrado() {
  const busca = state.busca.toLocaleLowerCase('pt-BR');
  return getPeriodo(state.atual).filter(item => (state.uf === 'TODAS' || item.uf === state.uf) && (!busca || item.armazem.toLocaleLowerCase('pt-BR').includes(busca)));
}

function anteriorFiltrado() { return getPeriodo(state.anterior).filter(item => state.uf === 'TODAS' || item.uf === state.uf); }
function clsDelta(valor, invert = false) { if (Math.abs(valor) < 0.00001) return 'delta-neutral'; return (invert ? valor < 0 : valor > 0) ? 'delta-good' : 'delta-bad'; }
function escapeHTML(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }

function ordenarPorEstoqueAcuraciaNome(a, b) {
  if (b.estoque_loja !== a.estoque_loja) return b.estoque_loja - a.estoque_loja;
  if (a.acuracia_estoque !== b.acuracia_estoque) return a.acuracia_estoque - b.acuracia_estoque;
  return a.armazem.localeCompare(b.armazem, 'pt-BR');
}

function calcularPrioridadesPorQuartilEstoque() {
  const dadosAtual = getPeriodo(state.atual);
  dadosAtual.forEach(item => item.prioridade_estoque = 'Baixa');
  const comEstoque = dadosAtual.filter(item => item.estoque_loja > 0).sort(ordenarPorEstoqueAcuraciaNome);
  const total = comEstoque.length;
  if (!total) return;
  comEstoque.forEach((item, index) => {
    const posicaoPercentual = (index + 1) / total;
    if (posicaoPercentual <= 0.25) item.prioridade_estoque = 'Crítica';
    else if (posicaoPercentual <= 0.50) item.prioridade_estoque = 'Alta';
    else if (posicaoPercentual <= 0.75) item.prioridade_estoque = 'Média';
    else item.prioridade_estoque = 'Baixa';
  });
}
function prioridade(item) { return item.prioridade_estoque || 'Baixa'; }

function renderDashboard() {
  const atual = atualFiltrado();
  const anterior = anteriorFiltrado();
  const totalAtual = totals(atual);
  const totalAnterior = totals(anterior);
  setText('kpiInicial', formatInt(totalAtual.inicial));
  setDelta('deltaInicial', totalAtual.inicial - totalAnterior.inicial, 'num', true, 'vs mês anterior');
  setText('kpiEstoque', formatInt(totalAtual.estoque));
  setDelta('deltaEstoque', totalAtual.estoque - totalAnterior.estoque, 'num', false, 'vs mês anterior');
  setText('kpiDevol', formatInt(totalAtual.devol));
  setDelta('deltaDevol', totalAtual.devol - totalAnterior.devol, 'num', true, 'vs mês anterior');
  setText('kpiAcuracia', formatPct(totalAtual.acuracia));
  setDelta('deltaAcuracia', totalAtual.acuracia - totalAnterior.acuracia, 'pct', true, 'vs mês anterior');
  setText('kpiSemDevolucao', formatInt(totalAtual.semDevolucao));
  setText('donutPendente', formatPct(totalAtual.inicial > 0 ? totalAtual.estoque / totalAtual.inicial : 0));
  renderRanking(atual);
  renderDonut(totalAtual);
  renderMiniComparativo(totalAtual, totalAnterior);
  renderTabela(atual);
  renderLeitura(atual, totalAtual, totalAnterior);
}

function setDelta(id, valor, tipo, quantoMaiorMelhor, sufixo) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = `${deltaTxt(valor, tipo)} ${sufixo}`;
  el.className = 'kpi-desc ' + clsDelta(valor, !quantoMaiorMelhor);
}

function renderRanking(dados) {
  const container = document.getElementById('rankingBars');
  if (!container) return;
  const mapAnt = anteriorMap();
  const ordenados = [...dados].sort((a, b) => {
    if (state.ranking === 'estoque') return ordenarPorEstoqueAcuraciaNome(a, b);
    if (a.acuracia_estoque !== b.acuracia_estoque) return a.acuracia_estoque - b.acuracia_estoque;
    return ordenarPorEstoqueAcuraciaNome(a, b);
  });
  const max = Math.max(...ordenados.map(item => state.ranking === 'estoque' ? item.estoque_loja : 1 - item.acuracia_estoque), 1);
  setText('tituloRanking', state.ranking === 'estoque' ? 'Maiores estoques em loja' : 'Menor acurácia de estoque');
  if (!ordenados.length) { container.innerHTML = '<div class="empty-state">Nenhum registro encontrado.</div>'; return; }
  container.innerHTML = ordenados.map((item, index) => {
    const ant = mapAnt.get(item.armazem) || {};
    const deltaEstoque = item.estoque_loja - (ant.estoque_loja || 0);
    const deltaDevolvido = item.devol_cd - (ant.devol_cd || 0);
    const deltaAcuracia = item.acuracia_estoque - (ant.acuracia_estoque || 0);
    const valorBarra = state.ranking === 'estoque' ? item.estoque_loja : 1 - item.acuracia_estoque;
    return `
      <div class="rank-row">
        <div class="rank-pos">${index + 1}</div>
        <div>
          <div class="rank-name"><span>${escapeHTML(item.armazem)}</span><span class="rank-meta">${escapeHTML(item.uf)}</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, (valorBarra / max) * 100)}%"></div></div>
          <div class="rank-meta">Estoque: ${formatInt(item.estoque_loja)} <span class="${clsDelta(deltaEstoque, true)}">(${deltaTxt(deltaEstoque)})</span> · Devolvido CD: ${formatInt(item.devol_cd)} <span class="${clsDelta(deltaDevolvido, false)}">(${deltaTxt(deltaDevolvido)})</span> · Acurácia: ${formatPct(item.acuracia_estoque)} <span class="${clsDelta(deltaAcuracia, false)}">(${formatPP(deltaAcuracia)})</span></div>
        </div>
        <div class="rank-score">${state.ranking === 'estoque' ? formatInt(item.estoque_loja) : formatPct(item.acuracia_estoque)}</div>
      </div>`;
  }).join('');
}

function renderDonut(totalAtual) {
  const donut = document.getElementById('donutChart');
  const legenda = document.getElementById('legendList');
  if (!donut || !legenda) return;
  const total = Math.max(totalAtual.estoque + totalAtual.devol, 1);
  const p = (totalAtual.devol / total) * 100;
  donut.style.background = `conic-gradient(var(--green) 0 ${p}%, var(--red) ${p}% 100%)`;
  legenda.innerHTML = `<div class="legend-item"><span><i class="dot" style="background:var(--green)"></i>Devolvido ao CD</span><b>${formatInt(totalAtual.devol)}</b></div><div class="legend-item"><span><i class="dot" style="background:var(--red)"></i>Estoque em loja</span><b>${formatInt(totalAtual.estoque)}</b></div>`;
}

function renderMiniComparativo(atual, anterior) {
  const container = document.getElementById('miniComparativo');
  if (!container) return;
  setText('tituloComparativo', `${state.anterior} x ${state.atual}`);
  const itens = [['Estoque inicial', atual.inicial, anterior.inicial, 'num', true], ['Estoque loja', atual.estoque, anterior.estoque, 'num', false], ['Devolvido CD', atual.devol, anterior.devol, 'num', true], ['Acurácia', atual.acuracia, anterior.acuracia, 'pct', true]];
  container.innerHTML = itens.map(([label, va, vp, tipo, maior]) => {
    const delta = va - vp;
    return `<div class="mini-card"><span>${label}</span><strong>${tipo === 'pct' ? formatPct(va) : formatInt(va)}</strong><small class="${clsDelta(delta, !maior)}">${deltaTxt(delta, tipo)} vs ${state.anterior}</small></div>`;
  }).join('');
}

function enriquecerComDeltas(dados) {
  const mapAnt = anteriorMap();
  return dados.map(item => {
    const ant = mapAnt.get(item.armazem) || {};
    return { ...item, deltaInicial: item.estoque_inicial_loja - (ant.estoque_inicial_loja || 0), deltaEstoque: item.estoque_loja - (ant.estoque_loja || 0), deltaDevol: item.devol_cd - (ant.devol_cd || 0), deltaAcuracia: item.acuracia_estoque - (ant.acuracia_estoque || 0) };
  });
}

function ordenarTabela(dados) {
  const config = state.tabelaSort;
  const direcao = config.direcao === 'asc' ? 1 : -1;
  return [...dados].sort((a, b) => {
    const va = Number(a[config.campo] ?? 0);
    const vb = Number(b[config.campo] ?? 0);
    if (va !== vb) return (va - vb) * direcao;
    return ordenarPorEstoqueAcuraciaNome(a, b);
  });
}

function atualizarIndicadoresOrdenacaoTabela() {
  const ths = document.querySelectorAll('#detalhe table thead th');
  ths.forEach((th, index) => {
    const config = TABLE_SORT_CONFIG[index];
    if (!config) return;
    th.classList.remove('sort-asc', 'sort-desc');
    th.setAttribute('aria-sort', 'none');
    if (state.tabelaSort.campo === config.campo) {
      const classe = state.tabelaSort.direcao === 'asc' ? 'sort-asc' : 'sort-desc';
      const aria = state.tabelaSort.direcao === 'asc' ? 'ascending' : 'descending';
      th.classList.add(classe);
      th.setAttribute('aria-sort', aria);
    }
  });
}

function configurarOrdenacaoTabela() {
  const ths = document.querySelectorAll('#detalhe table thead th');
  ths.forEach((th, index) => {
    const config = TABLE_SORT_CONFIG[index];
    if (!config) return;
    th.classList.add('sortable-th');
    th.title = `Clique para ordenar por ${config.label}`;
    th.setAttribute('role', 'button');
    th.setAttribute('tabindex', '0');
    const aplicarOrdenacao = () => {
      const mesmoCampo = state.tabelaSort.campo === config.campo;
      state.tabelaSort = { campo: config.campo, direcao: mesmoCampo ? (state.tabelaSort.direcao === 'asc' ? 'desc' : 'asc') : config.defaultDir };
      renderDashboard();
    };
    th.addEventListener('click', aplicarOrdenacao);
    th.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); aplicarOrdenacao(); }
    });
  });
  atualizarIndicadoresOrdenacaoTabela();
}

function renderTabela(dados) {
  const tbody = document.getElementById('tabelaLojas');
  if (!tbody) return;
  const ordenados = ordenarTabela(enriquecerComDeltas(dados));
  if (!ordenados.length) { tbody.innerHTML = '<tr><td colspan="11">Nenhum registro encontrado.</td></tr>'; atualizarIndicadoresOrdenacaoTabela(); return; }
  tbody.innerHTML = ordenados.map(item => {
    const prior = prioridade(item);
    const classePrioridade = prior.toLowerCase().replace('í', 'i');
    return `
      <tr>
        <td><span class="badge ${classePrioridade}">${prior}</span></td><td>${escapeHTML(item.armazem)}</td><td>${escapeHTML(item.uf)}</td>
        <td class="num">${formatInt(item.estoque_inicial_loja)}</td><td class="num ${clsDelta(item.deltaInicial, true)}">${deltaTxt(item.deltaInicial)}</td>
        <td class="num">${formatInt(item.estoque_loja)}</td><td class="num ${clsDelta(item.deltaEstoque, true)}">${deltaTxt(item.deltaEstoque)}</td>
        <td class="num">${formatInt(item.devol_cd)}</td><td class="num ${clsDelta(item.deltaDevol, false)}">${deltaTxt(item.deltaDevol)}</td>
        <td class="num">${formatPct(item.acuracia_estoque)}</td><td class="num ${clsDelta(item.deltaAcuracia, false)}">${formatPP(item.deltaAcuracia)}</td>
      </tr>`;
  }).join('');
  atualizarIndicadoresOrdenacaoTabela();
}

function renderLeitura(dados, atual, anterior) {
  const lista = document.getElementById('bulletsExecutivos');
  if (!lista) return;
  const topEstoque = [...dados].sort(ordenarPorEstoqueAcuraciaNome)[0];
  const deltaEstoque = atual.estoque - anterior.estoque;
  const deltaAcuracia = atual.acuracia - anterior.acuracia;
  const bullets = [];
  if (topEstoque) bullets.push(`<span class="bullet-tag">Estoque</span><b>${escapeHTML(topEstoque.armazem)}</b> concentra o maior estoque em loja no cenário atual, com <b>${formatInt(topEstoque.estoque_loja)}</b> equipamentos.`);

  const criticasMenorAcuracia = [...dados]
    .filter(item => prioridade(item) === 'Crítica' && item.estoque_loja > 0)
    .sort((a, b) => (a.acuracia_estoque - b.acuracia_estoque) || (b.estoque_loja - a.estoque_loja) || a.armazem.localeCompare(b.armazem, 'pt-BR'))
    .slice(0, 5);

  if (criticasMenorAcuracia.length) {
    const listaTop5 = criticasMenorAcuracia.map(item => `<b>${escapeHTML(item.armazem)}</b> ${formatPct(item.acuracia_estoque)} / estoque ${formatInt(item.estoque_loja)}`).join('; ');
    bullets.push(`<span class="bullet-tag">Acurácia</span>Top 5 lojas críticas com menor acurácia: ${listaTop5}.`);
  } else {
    bullets.push(`<span class="bullet-tag">Acurácia</span>Não há lojas com prioridade crítica e estoque em loja maior que zero no cenário atual.`);
  }

  bullets.push(`<span class="bullet-tag">Comparativo</span>O estoque em loja variou <b class="${clsDelta(deltaEstoque, true)}">${deltaTxt(deltaEstoque)}</b> versus ${state.anterior}; a acurácia variou <b class="${clsDelta(deltaAcuracia, false)}">${formatPP(deltaAcuracia)}</b>.`);

  const criticasSemDevolucao = [...dados]
    .filter(item => prioridade(item) === 'Crítica' && item.estoque_loja > 0 && item.devol_cd === 0)
    .sort(ordenarPorEstoqueAcuraciaNome);

  if (criticasSemDevolucao.length) {
    const topCriticasSemDevolucao = criticasSemDevolucao.slice(0, 5).map(item => `<b>${escapeHTML(item.armazem)}</b> estoque ${formatInt(item.estoque_loja)}`).join('; ');
    const complemento = criticasSemDevolucao.length > 5 ? ` Há mais ${formatInt(criticasSemDevolucao.length - 5)} loja(s) crítica(s) na mesma condição.` : '';
    bullets.push(`<span class="bullet-tag">Prioridade</span>Priorizar atuação nas lojas críticas sem devolução ao CD: ${topCriticasSemDevolucao}. Essas lojas concentram estoque atual e não registraram devolução no período.${complemento}`);
  } else {
    bullets.push(`<span class="bullet-tag">Prioridade</span>Não há lojas críticas com devolução zerada no cenário atual. Manter acompanhamento das lojas críticas com maior estoque e menor acurácia.`);
  }
  lista.innerHTML = bullets.map(item => `<li>${item}</li>`).join('');
}

function popularFiltros() {
  const select = document.getElementById('filtroUf');
  if (!select) return;
  const ufs = [...new Set(state.dados.map(item => item.uf).filter(Boolean))].sort();
  select.innerHTML = '<option value="TODAS">Todas as UFs</option>' + ufs.map(uf => `<option value="${escapeHTML(uf)}">${escapeHTML(uf)}</option>`).join('');
}

function configurarEventos() {
  const filtroUf = document.getElementById('filtroUf');
  if (filtroUf) filtroUf.addEventListener('change', event => { state.uf = event.target.value; renderDashboard(); });
  const buscaLoja = document.getElementById('buscaLoja');
  if (buscaLoja) buscaLoja.addEventListener('input', event => { state.busca = event.target.value; renderDashboard(); });
  document.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      state.ranking = button.dataset.ranking;
      renderDashboard();
    });
  });
  configurarOrdenacaoTabela();
}

async function iniciarDashboard() {
  try {
    state.dados = (await carregarCSV(BASE_FILE)).map(normalizar).filter(item => item.armazem);
    if (!state.dados.length) throw new Error('CSV carregado, mas sem registros válidos.');
    const periodos = [...new Set(state.dados.map(item => item.periodo))].sort((a, b) => {
      const ordemA = Math.max(...state.dados.filter(item => item.periodo === a).map(item => item.ordem_mes));
      const ordemB = Math.max(...state.dados.filter(item => item.periodo === b).map(item => item.ordem_mes));
      return ordemA - ordemB;
    });
    state.anterior = periodos[periodos.length - 2];
    state.atual = periodos[periodos.length - 1];
    if (!state.atual || !state.anterior) throw new Error('É necessário ter pelo menos dois períodos no CSV para comparação.');
    setText('periodoAtual', state.atual);
    setText('periodoAnterior', 'Comparativo: ' + state.anterior);
    calcularPrioridadesPorQuartilEstoque();
    popularFiltros();
    configurarEventos();
    renderDashboard();
  } catch (erro) {
    console.error(erro);
    const ranking = document.getElementById('rankingBars');
    if (ranking) ranking.innerHTML = `<div class="empty-state">Erro ao carregar <b>data/${BASE_FILE}</b>. Verifique se o arquivo existe, está em UTF-8, usa delimitador ponto e vírgula e possui os cabeçalhos esperados.</div>`;
  }
}

iniciarDashboard();
