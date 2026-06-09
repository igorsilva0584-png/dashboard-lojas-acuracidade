const DATA_PATH = './data/';
const BASE_FILE = 'lojas_acuracidade_mensal.csv';
const state = { dados: [], atual: null, anterior: null, uf: 'TODAS', busca: '', ranking: 'estoque' };

async function carregarCSV(nomeArquivo) {
  const response = await fetch(DATA_PATH + nomeArquivo + '?v=' + Date.now());
  if (!response.ok) throw new Error(`Falha ao carregar ${nomeArquivo}: ${response.status}`);
  const text = await response.text();
  return parseCSV(text, ';');
}
function limparTexto(valor) { return String(valor ?? '').replace(/^\uFEFF/, '').trim(); }
function parseNumber(valor) {
  const texto = limparTexto(valor).replace('%','').replace(/\s/g,'').replace(/\./g,'').replace(',', '.');
  const numero = Number(texto); return Number.isFinite(numero) ? numero : 0;
}
function parseCSV(texto, delimitador = ';') {
  const limpo = String(texto ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!limpo) return [];
  const linhas = limpo.split('\n');
  const cabecalhos = linhas.shift().split(delimitador).map(limparTexto);
  return linhas.filter(l => l.trim() !== '').map(linha => {
    const colunas = linha.split(delimitador);
    return Object.fromEntries(cabecalhos.map((c, i) => [c, limparTexto(colunas[i])]));
  });
}
function normalizar(row) {
  return {
    periodo: limparTexto(row.periodo), ordem_mes: parseNumber(row.ordem_mes), armazem: limparTexto(row.armazem), uf: limparTexto(row.uf),
    estoque_inicial_loja: parseNumber(row.estoque_inicial_loja), estoque_loja: parseNumber(row.estoque_loja), devol_cd: parseNumber(row.devol_cd),
    acuracia_estoque: parseNumber(row.acuracia_estoque)
  };
}
function formatInt(n){return Math.round(n||0).toLocaleString('pt-BR')}
function formatPct(n){return (Number(n||0)*100).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'}
function formatPP(n){const sinal=n>0?'+':'';return sinal+(Number(n||0)*100).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+' p.p.'}
function deltaTxt(valor, tipo='num'){const sinal=valor>0?'+':'';return tipo==='pct'?formatPP(valor):sinal+formatInt(valor)}
function setText(id, text){document.getElementById(id).textContent=text}
function soma(dados,campo){return dados.reduce((a,d)=>a+(d[campo]||0),0)}
function getPeriodo(periodo){return state.dados.filter(d=>d.periodo===periodo)}
function totals(dados){const inicial=soma(dados,'estoque_inicial_loja'), estoque=soma(dados,'estoque_loja'), devol=soma(dados,'devol_cd'); return {inicial, estoque, devol, acuracia: inicial?devol/inicial:0, semDevolucao: dados.filter(d=>d.estoque_loja>0&&d.devol_cd===0).length}}
function atualFiltrado(){return getPeriodo(state.atual).filter(d=>(state.uf==='TODAS'||d.uf===state.uf)&&(!state.busca||d.armazem.toLocaleLowerCase('pt-BR').includes(state.busca.toLocaleLowerCase('pt-BR'))))}
function anteriorMap(){return new Map(getPeriodo(state.anterior).map(d=>[d.armazem,d]))}
function clsDelta(valor, invert=false){if(Math.abs(valor)<0.00001)return 'delta-neutral'; const good=invert?valor<0:valor>0; return good?'delta-good':'delta-bad'}
function prioridade(d){if(d.estoque_loja>=100 || d.acuracia_estoque<=0.10) return 'Crítica'; if(d.estoque_loja>=50 || d.acuracia_estoque<=0.35) return 'Alta'; if(d.estoque_loja>=10 || d.acuracia_estoque<=0.70) return 'Média'; return 'Baixa'}
function escapeHTML(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

function renderDashboard(){
  const atual = atualFiltrado(); const anteriorTodos = getPeriodo(state.anterior); const anterior = anteriorTodos.filter(d=>state.uf==='TODAS'||d.uf===state.uf);
  const tA=totals(atual), tP=totals(anterior);
  setText('kpiInicial', formatInt(tA.inicial)); setDelta('deltaInicial', tA.inicial-tP.inicial, 'num', true, 'vs mês anterior');
  setText('kpiEstoque', formatInt(tA.estoque)); setDelta('deltaEstoque', tA.estoque-tP.estoque, 'num', false, 'vs mês anterior');
  setText('kpiDevol', formatInt(tA.devol)); setDelta('deltaDevol', tA.devol-tP.devol, 'num', true, 'vs mês anterior');
  setText('kpiAcuracia', formatPct(tA.acuracia)); setDelta('deltaAcuracia', tA.acuracia-tP.acuracia, 'pct', true, 'vs mês anterior');
  setText('kpiSemDevolucao', formatInt(tA.semDevolucao));
  setText('donutPendente', formatPct(tA.inicial? tA.estoque/tA.inicial:0));
  renderRanking(atual); renderDonut(tA); renderMiniComparativo(tA,tP); renderTabela(atual); renderLeitura(atual,tA,tP);
}
function setDelta(id, valor, tipo, quantoMaiorMelhor, sufixo){const el=document.getElementById(id); el.textContent=`${deltaTxt(valor,tipo)} ${sufixo}`; el.className='kpi-desc '+clsDelta(valor,!quantoMaiorMelhor)}
function renderRanking(dados){
  const container=document.getElementById('rankingBars'); const mapAnt=anteriorMap();
  const ordenados=[...dados].sort((a,b)=> state.ranking==='estoque' ? b.estoque_loja-a.estoque_loja : a.acuracia_estoque-b.acuracia_estoque).slice(0,10);
  const max=Math.max(...ordenados.map(d=>state.ranking==='estoque'?d.estoque_loja:(1-d.acuracia_estoque)),1);
  setText('tituloRanking', state.ranking==='estoque'?'Maiores estoques em loja':'Menor acurácia de estoque');
  if(!ordenados.length){container.innerHTML='<div class="empty-state">Nenhum registro encontrado.</div>';return}
  container.innerHTML=ordenados.map((d,i)=>{const ant=mapAnt.get(d.armazem)||{}; const deltaEst=d.estoque_loja-(ant.estoque_loja||0); const deltaAcu=d.acuracia_estoque-(ant.acuracia_estoque||0); const valor=state.ranking==='estoque'?d.estoque_loja:(1-d.acuracia_estoque); return `<div class="rank-row"><div class="rank-pos">${i+1}</div><div><div class="rank-name"><span>${escapeHTML(d.armazem)}</span><span class="rank-meta">${escapeHTML(d.uf)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(3,(valor/max)*100)}%"></div></div><div class="rank-meta">Estoque: ${formatInt(d.estoque_loja)} <span class="${clsDelta(deltaEst,true)}">(${deltaTxt(deltaEst)})</span> · Acurácia: ${formatPct(d.acuracia_estoque)} <span class="${clsDelta(deltaAcu,false)}">(${formatPP(deltaAcu)})</span></div></div><div class="rank-score">${state.ranking==='estoque'?formatInt(d.estoque_loja):formatPct(d.acuracia_estoque)}</div></div>`}).join('');
}
function renderDonut(t){const total=Math.max(t.estoque+t.devol,1); const p=(t.devol/total)*100; document.getElementById('donutChart').style.background=`conic-gradient(var(--green) 0 ${p}%, var(--red) ${p}% 100%)`; document.getElementById('legendList').innerHTML=`<div class="legend-item"><span><i class="dot" style="background:var(--green)"></i>Devolvido ao CD</span><b>${formatInt(t.devol)}</b></div><div class="legend-item"><span><i class="dot" style="background:var(--red)"></i>Estoque em loja</span><b>${formatInt(t.estoque)}</b></div>`}
function renderMiniComparativo(a,p){const itens=[['Estoque inicial',a.inicial,p.inicial,'num',true],['Estoque loja',a.estoque,p.estoque,'num',false],['Devolvido CD',a.devol,p.devol,'num',true],['Acurácia',a.acuracia,p.acuracia,'pct',true]]; document.getElementById('miniComparativo').innerHTML=itens.map(([label,va,vp,tipo,maior])=>{const delta=va-vp;return `<div class="mini-card"><span>${label}</span><strong>${tipo==='pct'?formatPct(va):formatInt(va)}</strong><small class="${clsDelta(delta,!maior)}">${deltaTxt(delta,tipo)} vs ${state.anterior}</small></div>`}).join('')}
function renderTabela(dados){const tbody=document.getElementById('tabelaLojas'); const mapAnt=anteriorMap(); const ordenados=[...dados].sort((a,b)=>b.estoque_loja-a.estoque_loja || a.acuracia_estoque-b.acuracia_estoque); tbody.innerHTML=ordenados.map(d=>{const ant=mapAnt.get(d.armazem)||{}; const di=d.estoque_inicial_loja-(ant.estoque_inicial_loja||0), de=d.estoque_loja-(ant.estoque_loja||0), dd=d.devol_cd-(ant.devol_cd||0), da=d.acuracia_estoque-(ant.acuracia_estoque||0); const p=prioridade(d), c=p.toLowerCase().replace('í','i'); return `<tr><td><span class="badge ${c}">${p}</span></td><td>${escapeHTML(d.armazem)}</td><td>${escapeHTML(d.uf)}</td><td class="num">${formatInt(d.estoque_inicial_loja)}</td><td class="num ${clsDelta(di,true)}">${deltaTxt(di)}</td><td class="num">${formatInt(d.estoque_loja)}</td><td class="num ${clsDelta(de,true)}">${deltaTxt(de)}</td><td class="num">${formatInt(d.devol_cd)}</td><td class="num ${clsDelta(dd,false)}">${deltaTxt(dd)}</td><td class="num">${formatPct(d.acuracia_estoque)}</td><td class="num ${clsDelta(da,false)}">${formatPP(da)}</td></tr>`}).join('')||'<tr><td colspan="11">Nenhum registro encontrado.</td></tr>'}
function renderLeitura(dados,a,p){const topEst=[...dados].sort((x,y)=>y.estoque_loja-x.estoque_loja)[0]; const piorAcu=[...dados].filter(d=>d.estoque_inicial_loja>0).sort((x,y)=>x.acuracia_estoque-y.acuracia_estoque)[0]; const deltaEst=a.estoque-p.estoque, deltaAcu=a.acuracia-p.acuracia; const bullets=[]; if(topEst) bullets.push(`<span class="bullet-tag">Estoque</span><b>${escapeHTML(topEst.armazem)}</b> concentra o maior estoque em loja no cenário atual, com <b>${formatInt(topEst.estoque_loja)}</b> equipamentos.`); if(piorAcu) bullets.push(`<span class="bullet-tag">Acurácia</span><b>${escapeHTML(piorAcu.armazem)}</b> está entre os principais pontos de atenção por acurácia de <b>${formatPct(piorAcu.acuracia_estoque)}</b>.`); bullets.push(`<span class="bullet-tag">Comparativo</span>O estoque em loja variou <b class="${clsDelta(deltaEst,true)}">${deltaTxt(deltaEst)}</b> versus ${state.anterior}; a acurácia variou <b class="${clsDelta(deltaAcu,false)}">${formatPP(deltaAcu)}</b>.`); bullets.push(`<span class="bullet-tag">Prioridade</span>Atuar primeiro nas lojas com alto estoque atual e baixa acurácia, pois indicam volume sistêmico sem confirmação/devolução ao CD.`); document.getElementById('bulletsExecutivos').innerHTML=bullets.map(b=>`<li>${b}</li>`).join('')}
function popularFiltros(){const select=document.getElementById('filtroUf'); const ufs=[...new Set(state.dados.map(d=>d.uf).filter(Boolean))].sort(); select.innerHTML='<option value="TODAS">Todas as UFs</option>'+ufs.map(uf=>`<option value="${escapeHTML(uf)}">${escapeHTML(uf)}</option>`).join('')}
async function iniciarDashboard(){try{state.dados=(await carregarCSV(BASE_FILE)).map(normalizar).filter(d=>d.armazem); const periodos=[...new Set(state.dados.map(d=>d.periodo))].sort((a,b)=>Math.max(...state.dados.filter(d=>d.periodo===a).map(d=>d.ordem_mes))-Math.max(...state.dados.filter(d=>d.periodo===b).map(d=>d.ordem_mes))); state.anterior=periodos[periodos.length-2]; state.atual=periodos[periodos.length-1]; setText('periodoAtual',state.atual); setText('periodoAnterior','Comparativo: '+state.anterior); popularFiltros(); document.getElementById('filtroUf').addEventListener('change',e=>{state.uf=e.target.value;renderDashboard()}); document.getElementById('buscaLoja').addEventListener('input',e=>{state.busca=e.target.value;renderDashboard()}); document.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');state.ranking=btn.dataset.ranking;renderDashboard()})); renderDashboard()}catch(e){console.error(e); document.getElementById('rankingBars').innerHTML=`<div class="empty-state">Erro ao carregar data/${BASE_FILE}. Verifique arquivo, UTF-8 e delimitador ;.</div>`}}
iniciarDashboard();
