# Guia de Git — do zero, para este projeto

Você nunca usou Git? Sem problema. Este guia cobre só o que importa para manter
e expandir o Fullgas, na ordem em que você vai precisar.

## O que é Git (em uma frase)

Git tira "fotos" (commits) do seu código ao longo do tempo. Você pode voltar a
qualquer foto, ver o que mudou, e experimentar mudanças sem medo de quebrar o
que funciona. O GitHub é onde essas fotos ficam guardadas na nuvem.

## Configuração inicial (uma vez só)

Abra o terminal na pasta do projeto e rode, trocando pelos seus dados:

```bash
git config --global user.name "Seu Nome"
git config --global user.email "seu-email@exemplo.com"
```

## Passo 1 — Transformar a pasta em um repositório

Dentro da pasta `fullgas-monorepo`:

```bash
git init
git add .
git commit -m "Primeiro commit: portal, API e banco do Fullgas"
```

O que cada linha faz:
- `git init` — começa a rastrear esta pasta.
- `git add .` — seleciona todos os arquivos para a próxima foto (o `.gitignore`
  garante que senhas e `node_modules` fiquem de fora).
- `git commit -m "..."` — tira a foto, com uma mensagem descrevendo-a.

## Passo 2 — Enviar para o GitHub

1. No GitHub, clique em **New repository**, dê o nome `fullgas` e **não**
   marque nenhuma opção de inicialização (README, .gitignore) — você já tem tudo.
2. O GitHub mostra uns comandos. Use os da seção "push an existing repository":

```bash
git remote add origin https://github.com/SEU-USUARIO/fullgas.git
git branch -M main
git push -u origin main
```

Pronto: seu código está na nuvem. Atualize a página do GitHub e veja os arquivos.

## O ciclo do dia a dia

Toda vez que você mexer no projeto e quiser salvar:

```bash
git add .
git commit -m "Descreva o que você mudou"
git push
```

Escreva mensagens úteis: "Adiciona upload de foto na reivindicação" é melhor
que "mudanças". O futuro-você agradece.

## Branches — experimentar sem medo (o pulo do gato para expandir)

Quando for fazer uma mudança grande (como a reivindicação com fotos), crie um
**branch**: uma linha do tempo paralela onde você mexe à vontade sem tocar no
código que está no ar.

```bash
git checkout -b reivindicacao-fotos   # cria e entra no branch novo
# ... você trabalha, faz commits normalmente ...
git push -u origin reivindicacao-fotos
```

Quando a mudança estiver pronta e testada, você a "funde" de volta no `main`.
A forma recomendada é abrir um **Pull Request** no GitHub (botão que aparece
após o push) — ele mostra tudo que mudou antes de juntar, e serve de registro.
Se preferir pela linha de comando:

```bash
git checkout main
git merge reivindicacao-fotos
git push
```

Por que isso importa para você: o `main` é o que vai estar publicado (o Render
republica sozinho a cada push no `main`). Mantendo experimentos em branches,
o site no ar nunca quebra por causa de um teste pela metade.

## Comandos de socorro

```bash
git status                 # o que mudou desde o último commit?
git log --oneline          # histórico de commits (aperte q para sair)
git diff                   # mostra exatamente o que você alterou
git checkout -- arquivo    # desfaz mudanças não commitadas em um arquivo
```

## Regras de ouro

1. **Nunca** commite o arquivo `.env` (o `.gitignore` já bloqueia — confie nele,
   e confira com `git status` que ele não aparece).
2. Commits pequenos e frequentes são melhores que um commit gigante por semana.
3. Antes de uma mudança grande, crie um branch.
4. Se o `git push` reclamar que o remoto tem mudanças que você não tem, rode
   `git pull` primeiro, resolva o que aparecer, e tente o push de novo.
