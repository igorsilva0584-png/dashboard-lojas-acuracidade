# Dashboard Lojas | Acuracidade de Estoque

Dashboard web estático para GitHub Pages com comparação mensal **ABR/2026 x MAI/2026**.

## Arquivos

```text
index.html
style.css
app.js
assets/logo-empresa.png
data/lojas_acuracidade_mensal.csv
```

## CSV principal

Arquivo: `data/lojas_acuracidade_mensal.csv`

Cabeçalhos:

```text
periodo;ordem_mes;armazem;uf;estoque_inicial_loja;estoque_loja;devol_cd;acuracia_estoque
```

## Regras da visão

- Mês atual: maior `ordem_mes` no CSV.
- Mês anterior: segundo maior `ordem_mes` no CSV.
- Ranking 1: maior `estoque_loja` no mês atual.
- Ranking 2: menor `acuracia_estoque` no mês atual.
- Comparativo: variação do mês atual contra mês anterior.

## Sanity check da base enviada

- Linhas MAI/2026: 61
- Linhas ABR/2026: 60
- Lojas únicas: 61
- MAI/2026: estoque inicial 2357, estoque loja 1506, devolvido CD 851, acurácia consolidada 36.1052%
- ABR/2026: estoque inicial 2435, estoque loja 1426, devolvido CD 1009, acurácia consolidada 41.4374%

## Publicação GitHub Pages

1. Subir todos os arquivos na raiz do repositório.
2. Acessar **Settings > Pages**.
3. Selecionar **Deploy from a branch**.
4. Branch: `main`.
5. Folder: `/root`.
6. Salvar e aguardar a URL.
