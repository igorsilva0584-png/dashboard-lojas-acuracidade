const DATA_PATH = './data/';
const BASE_FILE = 'lojas_acuracidade_mensal.csv';

const state = {
  dados: [],
  atual: null,
  anterior: null,
  uf: 'TODAS',
  busca: '',
  ranking: 'estoque'
};

async function carregarCSV(nomeArquivo) {
  const response = await fetch(DATA_PATH + nomeArquivo + '?v=' + Date.now());

  if (!response.ok) {
    throw new Error(`Falha ao carregar ${nomeArquivo}: ${response.status}`);
  }

  const text = await response.text();
  return parseCSV(text, ';');
}

function limparTexto(valor) {
  return String(valor ?? '')
    .replace(/^\uFEFF/, '')
    .trim();
}

function parseNumber(valor) {
  const original = limparTexto(valor);

  if (!original) return 0;

  const temPercentual = original.includes('%');

  let texto = original
    .replace('%', '')
    .replace(/\s/g, '');

  /*
    Regras:
    - "18,63%" vira 0.1863
    - "0,1863" vira 0.1863
    - "0.1863" continua 0.1863
    - "1.234,56" vira 1234.56
    - "1234" continua 1234
  */
  if (texto.includes(',') && texto.includes('.')) {
    texto = texto.replace(/\./g, '').replace(',', '.');
  } else if (texto.includes(',')) {
    texto = texto.replace(',', '.');
  }

  const numero = Number(texto);

  if (!Number.isFinite(numero)) return 0;

  return temPercentual ? numero / 100 : numero;
}

function parseCSV(texto, delimitador = ';') {
  const limpo = String(texto ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  if (!limpo) return [];

  const linhas = limpo.split('\n');
  const cabecalhos = linhas.shift().split(delimitador).map(limparTexto);

  return linhas
    .filter(linha => linha.trim() !== '')
    .map(linha => {
      const colunas = linha.split(delimitador);

      return Object.fromEntries(
        cabecalhos.map((cabecalho, i) => [
          cabecalho,
          limparTexto(colunas[i])
        ])
      );
    });
}

function normalizar(row) {
  return {
    periodo: limparTexto(row.periodo),
    ordem_mes: parseNumber(row.ordem_mes),
    armazem: limparTexto(row.armazem),
    uf: limparTexto(row.uf),
    estoque_inicial_loja: parseNumber(row.estoque_inicial_loja),
    estoque_loja: parseNumber(row.estoque_loja),
    devol_cd: parseNumber(row.devol_cd),
    acuracia_estoque: parseNumber(row.acuracia_estoque),
    prioridade_estoque: 'Baixa'
  };
}

function formatInt(numero) {
  return Math.round(numero || 0).toLocaleString('pt-BR');
}

function formatPct(numero) {
  return (Number(numero || 0) * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }) + '%';
}

function formatPP(numero) {
  const sinal = numero > 0 ? '+' : '';

  return sinal + (Number(numero || 0) * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }) + ' p.p.';
}

function deltaTxt(valor, tipo = 'num') {
  const sinal = valor > 0 ? '+' : '';

  if (tipo === 'pct') {
    return formatPP(valor);
  }

  return sinal + formatInt(valor);
}

function setText(id, text) {
  const elemento = document.getElementById(id);

  if (!elemento) {
    console.warn(`Elemento não encontrado no HTML: #${id}`);
    return;
  }

  elemento.textContent = text;
}

function soma(dados, campo) {
  return dados.reduce((acc, item) => acc + (item[campo] || 0), 0);
}

function getPeriodo(periodo) {
  return state.dados.filter(item => item.periodo === periodo);
}

function totals(dados) {
  const inicial = soma(dados, 'estoque_inicial_loja');
  const estoque = soma(dados, 'estoque_loja');
  const devol = soma(dados, 'devol_cd');

  return {
    inicial,
    estoque,
    devol,
    acuracia: inicial > 0 ? devol / inicial : 0,
    semDevolucao: dados.filter(item => item.estoque_loja > 0 && item.devol_cd === 0).length
  };
}

function atualFiltrado() {
  const busca = state.busca.toLocaleLowerCase('pt-BR');

  return getPeriodo(state.atual).filter(item => {
    const passaUF = state.uf === 'TODAS' || item.uf === state.uf;
    const passaBusca = !busca || item.armazem.toLocaleLowerCase('pt-BR').includes(busca);

    return passaUF && passaBusca;
  });
}

function anteriorFiltrado() {
  return getPeriodo(state.anterior).filter(item => {
    return state.uf === 'TODAS' || item.uf === state.uf;
  });
}

function anteriorMap() {
  return new Map(
    getPeriodo(state.anterior).map(item => [item.armazem, item])
  );
}

function clsDelta(valor, invert = false) {
  if (Math.abs(valor) < 0.00001) return 'delta-neutral';

  const positivo = invert ? valor < 0 : valor > 0;

  return positivo ? 'delta-good' : 'delta-bad';
}

/*
  Regra oficial da PRIORIDADE:
  - Base: mês atual completo, sem depender do filtro de UF ou busca.
  - Critério: somente estoque_loja atual.
  - estoque_loja = 0 => Baixa automática.
  - Lojas com estoque_loja > 0 entram no quartil por posição percentual.
  - Ordenação: estoque_loja desc, estoque_inicial_loja desc, armazem A-Z.
  - Até 25% => Crítica; até 50% => Alta; até 75% => Média; acima de 75% => Baixa.
*/
function calcularPrioridadesPorQuartilEstoque() {
  const dadosAtual = getPeriodo(state.atual);

  dadosAtual.forEach(item => {
    item.prioridade_estoque = 'Baixa';
  });

  const comEstoque = dadosAtual
    .filter(item => item.estoque_loja > 0)
    .sort((a, b) => {
      if (b.estoque_loja !== a.estoque_loja) {
        return b.estoque_loja - a.estoque_loja;
      }

      if (b.estoque_inicial_loja !== a.estoque_inicial_loja) {
        return b.estoque_inicial_loja - a.estoque_inicial_loja;
      }

      return a.armazem.localeCompare(b.armazem, 'pt-BR');
    });

  const total = comEstoque.length;

  if (total === 0) return;

  comEstoque.forEach((item, index) => {
    const posicaoPercentual = (index + 1) / total;

    if (posicaoPercentual <= 0.25) {
      item.prioridade_estoque = 'Crítica';
    } else if (posicaoPercentual <= 0.50) {
      item.prioridade_estoque = 'Alta';
    } else if (posicaoPercentual <= 0.75) {
      item.prioridade_estoque = 'Média';
    } else {
      item.prioridade_estoque = 'Baixa';
    }
  });
}

function prioridade(item) {
  return item.prioridade_estoque || 'Baixa';
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>'"]/g, caractere => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[caractere]));
}

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

  setText(
    'donutPendente',
    formatPct(totalAtual.inicial > 0 ? totalAtual.estoque / totalAtual.inicial : 0)
  );

  renderRanking(atual);
  renderDonut(totalAtual);
  renderMiniComparativo(totalAtual, totalAnterior);
  renderTabela(atual);
  renderLeitura(atual, totalAtual, totalAnterior);
}

function setDelta(id, valor, tipo, quantoMaiorMelhor, sufixo) {
  const elemento = document.getElementById(id);

  if (!elemento) {
    console.warn(`Elemento não encontrado no HTML: #${id}`);
    return;
  }

  elemento.textContent = `${deltaTxt(valor, tipo)} ${sufixo}`;
  elemento.className = 'kpi-desc ' + clsDelta(valor, !quantoMaiorMelhor);
}

function renderRanking(dados) {
  const container = document.getElementById('rankingBars');

  if (!container) {
    console.warn('Elemento não encontrado no HTML: #rankingBars');
    return;
  }

  const mapAnt = anteriorMap();

  const ordenados = [...dados]
    .sort((a, b) => {
      if (state.ranking === 'estoque') {
        if (b.estoque_loja !== a.estoque_loja) {
          return b.estoque_loja - a.estoque_loja;
        }

        if (b.estoque_inicial_loja !== a.estoque_inicial_loja) {
          return b.estoque_inicial_loja - a.estoque_inicial_loja;
        }

        return a.armazem.localeCompare(b.armazem, 'pt-BR');
      }

      return a.acuracia_estoque - b.acuracia_estoque;
    })
    .slice(0, 10);

  const max = Math.max(
    ...ordenados.map(item => {
      return state.ranking === 'estoque'
        ? item.estoque_loja
        : 1 - item.acuracia_estoque;
    }),
    1
  );

  setText(
    'tituloRanking',
    state.ranking === 'estoque'
      ? 'Maiores estoques em loja'
      : 'Menor acurácia de estoque'
  );

  if (!ordenados.length) {
    container.innerHTML = '<div class="empty-state">Nenhum registro encontrado.</div>';
    return;
  }

  container.innerHTML = ordenados.map((item, index) => {
    const anterior = mapAnt.get(item.armazem) || {};

    const deltaEstoque = item.estoque_loja - (anterior.estoque_loja || 0);
    const deltaDevolvido = item.devol_cd - (anterior.devol_cd || 0);
    const deltaAcuracia = item.acuracia_estoque - (anterior.acuracia_estoque || 0);

    const valorBarra = state.ranking === 'estoque'
      ? item.estoque_loja
      : 1 - item.acuracia_estoque;

    return `
      <div class="rank-row">
        <div class="rank-pos">${index + 1}</div>

        <div>
          <div class="rank-name">
            <span>${escapeHTML(item.armazem)}</span>
            <span class="rank-meta">${escapeHTML(item.uf)}</span>
          </div>

          <div class="bar-track">
            <div class="bar-fill" style="width:${Math.max(3, (valorBarra / max) * 100)}%"></div>
          </div>

          <div class="rank-meta">
            Estoque: ${formatInt(item.estoque_loja)}
            <span class="${clsDelta(deltaEstoque, true)}">(${deltaTxt(deltaEstoque)})</span>
            · Devolvido CD: ${formatInt(item.devol_cd)}
            <span class="${clsDelta(deltaDevolvido, false)}">(${deltaTxt(deltaDevolvido)})</span>
            · Acurácia: ${formatPct(item.acuracia_estoque)}
            <span class="${clsDelta(deltaAcuracia, false)}">(${formatPP(deltaAcuracia)})</span>
          </div>
        </div>

        <div class="rank-score">
          ${state.ranking === 'estoque' ? formatInt(item.estoque_loja) : formatPct(item.acuracia_estoque)}
        </div>
      </div>
    `;
  }).join('');
}

function renderDonut(totalAtual) {
  const donut = document.getElementById('donutChart');
  const legenda = document.getElementById('legendList');

  if (!donut || !legenda) {
    console.warn('Elemento de donut ou legenda não encontrado no HTML.');
    return;
  }

  const total = Math.max(totalAtual.estoque + totalAtual.devol, 1);
  const percentualDevolvido = (totalAtual.devol / total) * 100;

  donut.style.background = `
    conic-gradient(
      var(--green) 0 ${percentualDevolvido}%,
      var(--red) ${percentualDevolvido}% 100%
    )
  `;

  legenda.innerHTML = `
    <div class="legend-item">
      <span><i class="dot" style="background:var(--green)"></i>Devolvido ao CD</span>
      <b>${formatInt(totalAtual.devol)}</b>
    </div>

    <div class="legend-item">
      <span><i class="dot" style="background:var(--red)"></i>Estoque em loja</span>
      <b>${formatInt(totalAtual.estoque)}</b>
    </div>
  `;
}

function renderMiniComparativo(atual, anterior) {
  const container = document.getElementById('miniComparativo');

  if (!container) {
    console.warn('Elemento não encontrado no HTML: #miniComparativo');
    return;
  }

  setText('tituloComparativo', `${state.anterior} x ${state.atual}`);

  const itens = [
    ['Estoque inicial', atual.inicial, anterior.inicial, 'num', true],
    ['Estoque loja', atual.estoque, anterior.estoque, 'num', false],
    ['Devolvido CD', atual.devol, anterior.devol, 'num', true],
    ['Acurácia', atual.acuracia, anterior.acuracia, 'pct', true]
  ];

  container.innerHTML = itens.map(([label, valorAtual, valorAnterior, tipo, maiorMelhor]) => {
    const delta = valorAtual - valorAnterior;

    return `
      <div class="mini-card">
        <span>${label}</span>
        <strong>${tipo === 'pct' ? formatPct(valorAtual) : formatInt(valorAtual)}</strong>
        <small class="${clsDelta(delta, !maiorMelhor)}">
          ${deltaTxt(delta, tipo)} vs ${state.anterior}
        </small>
      </div>
    `;
  }).join('');
}

function renderTabela(dados) {
  const tbody = document.getElementById('tabelaLojas');

  if (!tbody) {
    console.warn('Elemento não encontrado no HTML: #tabelaLojas');
    return;
  }

  const mapAnt = anteriorMap();

  const ordenados = [...dados].sort((a, b) => {
    if (b.estoque_loja !== a.estoque_loja) {
      return b.estoque_loja - a.estoque_loja;
    }

    if (b.estoque_inicial_loja !== a.estoque_inicial_loja) {
      return b.estoque_inicial_loja - a.estoque_inicial_loja;
    }

    return a.armazem.localeCompare(b.armazem, 'pt-BR');
  });

  if (!ordenados.length) {
    tbody.innerHTML = '<tr><td colspan="11">Nenhum registro encontrado.</td></tr>';
    return;
  }

  tbody.innerHTML = ordenados.map(item => {
    const anterior = mapAnt.get(item.armazem) || {};

    const deltaInicial = item.estoque_inicial_loja - (anterior.estoque_inicial_loja || 0);
    const deltaEstoque = item.estoque_loja - (anterior.estoque_loja || 0);
    const deltaDevol = item.devol_cd - (anterior.devol_cd || 0);
    const deltaAcuracia = item.acuracia_estoque - (anterior.acuracia_estoque || 0);

    const prior = prioridade(item);
    const classePrioridade = prior
      .toLowerCase()
      .replace('í', 'i');

    return `
      <tr>
        <td><span class="badge ${classePrioridade}">${prior}</span></td>
        <td>${escapeHTML(item.armazem)}</td>
        <td>${escapeHTML(item.uf)}</td>

        <td class="num">${formatInt(item.estoque_inicial_loja)}</td>
        <td class="num ${clsDelta(deltaInicial, true)}">${deltaTxt(deltaInicial)}</td>

        <td class="num">${formatInt(item.estoque_loja)}</td>
        <td class="num ${clsDelta(deltaEstoque, true)}">${deltaTxt(deltaEstoque)}</td>

        <td class="num">${formatInt(item.devol_cd)}</td>
        <td class="num ${clsDelta(deltaDevol, false)}">${deltaTxt(deltaDevol)}</td>

        <td class="num">${formatPct(item.acuracia_estoque)}</td>
        <td class="num ${clsDelta(deltaAcuracia, false)}">${formatPP(deltaAcuracia)}</td>
      </tr>
    `;
  }).join('');
}

function renderLeitura(dados, atual, anterior) {
  const lista = document.getElementById('bulletsExecutivos');

  if (!lista) {
    console.warn('Elemento não encontrado no HTML: #bulletsExecutivos');
    return;
  }

  const topEstoque = [...dados].sort((a, b) => b.estoque_loja - a.estoque_loja)[0];

  const piorAcuracia = [...dados]
    .filter(item => item.estoque_inicial_loja > 0)
    .sort((a, b) => a.acuracia_estoque - b.acuracia_estoque)[0];

  const deltaEstoque = atual.estoque - anterior.estoque;
  const deltaAcuracia = atual.acuracia - anterior.acuracia;

  const bullets = [];

  if (topEstoque) {
    bullets.push(`
      <span class="bullet-tag">Estoque</span>
      <b>${escapeHTML(topEstoque.armazem)}</b> concentra o maior estoque em loja no cenário atual,
      com <b>${formatInt(topEstoque.estoque_loja)}</b> equipamentos.
    `);
  }

  if (piorAcuracia) {
    bullets.push(`
      <span class="bullet-tag">Acurácia</span>
      <b>${escapeHTML(piorAcuracia.armazem)}</b> está entre os principais pontos de atenção por acurácia de
      <b>${formatPct(piorAcuracia.acuracia_estoque)}</b>.
    `);
  }

  bullets.push(`
    <span class="bullet-tag">Comparativo</span>
    O estoque em loja variou
    <b class="${clsDelta(deltaEstoque, true)}">${deltaTxt(deltaEstoque)}</b>
    versus ${state.anterior}; a acurácia variou
    <b class="${clsDelta(deltaAcuracia, false)}">${formatPP(deltaAcuracia)}</b>.
  `);

  bullets.push(`
    <span class="bullet-tag">Prioridade</span>
    A coluna prioridade usa quartis do estoque atual da base geral: as 25% lojas com maior estoque são Críticas,
    os próximos quartis são Alta, Média e Baixa. Lojas com estoque zerado são Baixa automaticamente.
  `);

  lista.innerHTML = bullets.map(item => `<li>${item}</li>`).join('');
}

function popularFiltros() {
  const select = document.getElementById('filtroUf');

  if (!select) {
    console.warn('Elemento não encontrado no HTML: #filtroUf');
    return;
  }

  const ufs = [...new Set(
    state.dados
      .map(item => item.uf)
      .filter(Boolean)
  )].sort();

  select.innerHTML = '<option value="TODAS">Todas as UFs</option>' +
    ufs.map(uf => `<option value="${escapeHTML(uf)}">${escapeHTML(uf)}</option>`).join('');
}

function configurarEventos() {
  const filtroUf = document.getElementById('filtroUf');

  if (filtroUf) {
    filtroUf.addEventListener('change', event => {
      state.uf = event.target.value;
      renderDashboard();
    });
  }

  const buscaLoja = document.getElementById('buscaLoja');

  if (buscaLoja) {
    buscaLoja.addEventListener('input', event => {
      state.busca = event.target.value;
      renderDashboard();
    });
  }

  document.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

      button.classList.add('active');
      state.ranking = button.dataset.ranking;

      renderDashboard();
    });
  });
}

async function iniciarDashboard() {
  try {
    const linhas = await carregarCSV(BASE_FILE);

    state.dados = linhas
      .map(normalizar)
      .filter(item => item.armazem);

    if (!state.dados.length) {
      throw new Error('CSV carregado, mas sem registros válidos.');
    }

    const periodos = [...new Set(state.dados.map(item => item.periodo))]
      .sort((periodoA, periodoB) => {
        const ordemA = Math.max(
          ...state.dados
            .filter(item => item.periodo === periodoA)
            .map(item => item.ordem_mes)
        );

        const ordemB = Math.max(
          ...state.dados
            .filter(item => item.periodo === periodoB)
            .map(item => item.ordem_mes)
        );

        return ordemA - ordemB;
      });

    state.anterior = periodos[periodos.length - 2];
    state.atual = periodos[periodos.length - 1];

    if (!state.atual || !state.anterior) {
      throw new Error('É necessário ter pelo menos dois períodos no CSV para comparação.');
    }

    setText('periodoAtual', state.atual);
    setText('periodoAnterior', 'Comparativo: ' + state.anterior);

    calcularPrioridadesPorQuartilEstoque();
    popularFiltros();
    configurarEventos();
    renderDashboard();

  } catch (erro) {
    console.error(erro);

    const ranking = document.getElementById('rankingBars');

    if (ranking) {
      ranking.innerHTML = `
        <div class="empty-state">
          Erro ao carregar <b>data/${BASE_FILE}</b>.
          Verifique se o arquivo existe, está em UTF-8, usa delimitador ponto e vírgula e possui os cabeçalhos esperados.
        </div>
      `;
    }
  }
}

iniciarDashboard();
