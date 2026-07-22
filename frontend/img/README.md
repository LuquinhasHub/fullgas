# Imagens do frontend

| Arquivo | Uso |
|---|---|
| `logo-fullgas.png` | Logo completo (asa + palavra FULLGAS), 1284x1811 RGBA. Cópia de `docs/referencias/LOGO_FULLGAS_A.png`. |
| `favicon.png` | Ícone do site (aba do navegador, favoritos, atalho no celular), 256x256. |

## Como o favicon foi feito

Gerado a partir do `logo-fullgas.png`: só a **asa** (o logo inteiro vira um
borrão ilegível em 16px), pintada de **preto** sobre um quadrado **amarelo
#E5B100** de cantos arredondados.

O fundo amarelo não é enfeite: a asa preta sozinha some na aba escura do Chrome,
que é cinza-escuro. Com o quadrado, o ícone fica nítido nos dois temas.

Para regerar (ex.: se o logo mudar), o script fica no histórico da sessão —
o essencial é: recortar o primeiro bloco vertical de conteúdo do PNG (a asa),
centralizar num quadrado com ~6% de respiro, reduzir para 256x256 por média de
área e compor sobre o fundo arredondado.

Trocar o ícone é só substituir `favicon.png` (256x256, PNG) e subir o `?v=` nos
`<link rel="icon">` das páginas HTML.
