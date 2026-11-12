# PDF para Fluxograma

Aplicação local que transforma documentações (PDFs do Confluence, manuais, procedimentos) em fluxogramas Mermaid **com uma seleção**. Ela identifica atividades, decisões, caminhos de SIM e NÃO, retornos, início e fim.

## Como usar

1. **Instale o Node.js uma única vez** (versão LTS): https://nodejs.org/pt
2. Descompacte esta pasta em qualquer lugar.
3. Dê **dois cliques** em:
   - **Windows:** `INICIAR.bat`
   - **macOS:** `iniciar.command` (na 1ª vez: botão direito → Abrir)
   - **Linux:** `./iniciar.sh`
4. O navegador abre sozinho em `http://localhost:3210`. Escolha o **tipo de fluxograma** (**Automático**, que é o recomendado, ou Processo, Funcional ou Decisão) e clique em **Selecionar PDF e gerar**, ou arraste o arquivo para o cartão. O resto é automático.

> **No VS Code:** abra a pasta e pressione **F5** ("▶ Iniciar Fluxograma IA"), ou rode `npm start`.

Não há `npm install`: o projeto não tem dependências, e o Mermaid e o pdf.js já estão em `public/vendor`. Tudo funciona sem internet.

## Novidades da versão 4.0.6: lógica das decisões, contexto dos caminhos e validação semântica

**Decisões pelo significado, não pelas palavras** (`lib/semantics.js`, novo)
- Cada condição vira uma expressão normalizada (assunto, predicado, negação, estado). Em "Internet não funciona?" o
  **Sim é a falha** (vai para a correção) e o **Não é o sucesso**.
- Condições opostas sobre o mesmo assunto viram **uma** decisão: "aprovado/recusado", "a conexão voltar/o problema
  persistir", "ligar/ainda não ligar", "decide se aprova" + "Se aprovado…".
- Cada resposta é classificada (sucesso, falha, continuidade, repetição, encerramento) e ligada ao seu destino.
- Quando os dois resultados estão descritos, o processo segue pelo **sucesso**; a falha sem continuidade descrita
  termina em "Fim sem conclusão" (com aviso). Encaminhar para suporte/assistência encerra o procedimento.
- Frases de resultado ("o problema foi resolvido", "a conexão está normal e o atendimento é encerrado") não viram caixa:
  levam ao Fim. "Siga para a configuração inicial" vira uma seta até esse ponto do documento.
- "Reinicie o roteador" não volta mais para "Verificar luz do roteador" só por citar o roteador (repetir exige a mesma
  ação). "Repita até 3 vezes" + "Persistindo a falha…" = laço com limite e saída.

**Contexto dos caminhos**: a frase que anuncia alternativas ("de duas formas: portal ou e-mail") não vira ramo; uma
atividade de um só método depois da junção ("Retire o disco") fica só no caminho dele. Repetição em caminhos
alternativos não é aviso de duplicidade.

**Responsáveis**: instrução ao leitor ("Aguarde a resposta automática") nunca fica com o Sistema só por citar
tecnologia; "o sistema exibe o erro e o comprador corrige" vira dois blocos, cada um na sua raia.

**Textos** (`lib/textreview.js`, novo): palavras quebradas pela extração são unidas só com prova no documento; o resto
fica com borda tracejada laranja e aviso "Texto a revisar" com o trecho original. Frases como "Na aba X, ative…" não
são mais descartadas. "Clique em Salvar" + "Salve as alterações" viram um bloco.

**Validação semântica** (`lib/semcheck.js`, novo): as 14 verificações rodam sobre a estrutura intermediária (decisões,
respostas × destinos, sucesso/falha, contexto, responsáveis humano × sistema, descrições, duplicidade, continuidade,
ciclos, encerramentos, recomendações, condições sem tratamento, caminhos incompatíveis, fidelidade). A aba Análise
mostra também as **decisões interpretadas** (o que cada resposta significa e para onde vai).

**Testes**: 67 cenários (9 documentos genéricos novos `sem_*.txt`), incluindo zero cruzamentos e uma ponta do losango
por resposta.

## Novidades da versão 4.0.5: responsáveis, classificação do conteúdo e lógica do Funcional

**Quem faz cada atividade** (`lib/functional.js`, sem depender da IA)
- Responsáveis reconhecidos pelo sujeito da frase ("o síndico convoca…"), por frases de dever ("cabe ao conselho…",
  "é responsabilidade do RH…"), pela voz passiva ("é aprovado pelo gestor"), por seções ("Responsabilidades do
  cliente") e por plurais/femininos ("moradores", "administradora"). Agentes só viram raia quando aparecem em 2+ frases.
- Títulos e etapas nunca viram responsáveis. Sem responsável no texto → raia "Responsável não especificado" (nada é
  inventado); dá para renomear/mover atividades na aba Análise.

**Classificação do conteúdo** — cada trecho é classificado como obrigatória, opcional, condicional, decisão,
entrada/saída, recomendação, observação, pré-requisito, resultado ou explicativa.
- Recomendações, observações e proibições ("É recomendado…", "Importante:", "Não use…") viram **nota** do bloco, não etapa.
- Explicações ("A assembleia é uma reunião…", "costuma durar cerca de uma hora") não viram blocos.
- Atividades opcionais ("os moradores podem enviar sugestões", "se necessário, contrata auditoria") viram uma escolha
  `Deseja…?` / `Precisa…?` na raia de quem faz, com o "Não" seguindo o fluxo — nunca uma etapa obrigatória.
- Ramo com resultado negativo ("informa que a troca não é possível", "o pedido é recusado") termina em
  "Fim sem conclusão", em vez de seguir como se tivesse dado certo.

**Modelo intermediário validado antes de desenhar** (`lib/pipeline.js`): raias (entidades próprias), etapas
(`stage_id`) e atividades (`lane_id`, responsável, categoria, condições, dependências, conexões, origem no PDF).
14 verificações automáticas aparecem na aba Análise ("Validação do Funcional x/14"); as que falham viram avisos.

**Layout** (`public/swimlane.mjs`)
- Cores por raia (como na imagem de referência); losango que recebe atividade de outra raia é alcançado por cima.
- Saída lateral do losango para outra raia segue reta até a coluna do destino e desce (sem cruzar outras setas).
- Retorno dentro da raia sobe pelo lado livre quando o outro lado já recebe uma seta.
- Atividade que está "atrás" do outro ramo do losango desce uma linha: a seta passa por baixo, sem cruzar.
- Caminhos de raias diferentes terminam no **Fim da própria raia** (sem setas longas atravessando o diagrama).

**Testes**: `npm test` — 47 cenários, incluindo condomínio com recomendações/opcionais, seções de responsáveis,
validação das 14 regras e um teste de layout que exige zero cruzamentos e zero setas sobre blocos.

## Novidades da versão 4.0.4: Fluxograma Funcional de verdade (raias = responsáveis, etapas = faixas)

A 4.0.3 transformava o Funcional sem responsáveis numa coluna única com títulos de etapa: era um fluxograma vertical
simples, não um Funcional. Agora o Funcional sempre tem **raias de responsáveis**, com progressão de cima para baixo,
e as **etapas** do documento aparecem como agrupamento secundário. Processo e Decisão não mudaram.

**Como as raias são identificadas** (`lib/functional.js`, regra geral, sem depender do assunto):
1. **Responsável explícito:** "O gestor analisa…", "A equipe de vendas envia…", "Responsável: Financeiro", "Suporte: verifica…".
2. **Voz passiva com agente:** "…é aprovado pelo gestor" vai para a raia Gestor.
3. **Sistema:** "O aplicativo envia um código", "A instalação inicia automaticamente" vão para a raia do sistema (com o nome do equipamento/aplicativo mais citado, ou "Sistema").
4. **Decisão:** fica na raia de quem decide ("Se o gestor aprovar…" → Gestor). Se a condição fala de uma coisa ("Se o produto estiver no prazo, o atendente…"), fica com quem age na consequência.
5. **Oração relativa com outro responsável:** "devolve o pedido ao solicitante, que ajusta o pedido…" põe "Ajustar pedido" na raia do Solicitante.
6. **Frase sem sujeito:** herda o responsável atual.
7. **Documento que não diz quem executa** (só imperativo ou passiva sem agente): **nada é inventado**. As atividades ficam na raia "Responsável não especificado", a Análise avisa, e o usuário define os responsáveis.

**Etapas ≠ raias:** os títulos do PDF nunca viram raias. Cada etapa vira uma faixa horizontal que atravessa todas as raias, com o nome numa coluna à esquerda (`%% etapa: Título :: P1 P2…` no código). Etapas paralelas ou alternativas ficam na mesma faixa.

**Representação intermediária** (`functionalModel` em `lib/pipeline.js`, devolvida pela API em `functional`):
- `lanes`: as raias, definidas separadamente dos nós;
- `stages`: as etapas;
- `activities`: `{ id, label, type, lane, stage, deps, conditions, in, out, source }`, em que `source` é o trecho original do PDF;
- `handoffs`: as setas que transferem a responsabilidade.

**Layout** (`public/swimlane.mjs`):
- **Colunas e linhas:** raias lado a lado, cada uma com a largura das suas colunas; cada caminho mantém a sua coluna dentro da raia; ramos de losango para os lados; 3+ métodos com o ramo que passa para outra raia do lado dela.
- **Passagens de responsabilidade:** na raia vizinha, na mesma linha (seta reta); em raia distante, desce uma linha (desce, atravessa logo acima do destino e entra por cima).
- **Retornos entre raias:** escolhem entre três caminhos o primeiro que não passa por cima de blocos nem usa uma ponta ocupada.
- **Losango:** duas saídas para a mesma raia não saem pela mesma ponta.
- **Etapas:** cada uma começa abaixo de todas as atividades das etapas anteriores.

**Definir os responsáveis** (aba Análise, cartão "Responsáveis (raias)", em `public/functional.mjs`): renomear raias, mover atividades para outra raia ou criar uma raia nova. O código e o desenho são atualizados.

**Outros ajustes:**
- **Automático:** o Funcional só é escolhido com 2 ou mais responsáveis reais (ou atividades paralelas).
- **IA:** as raias que são etapas são redistribuídas para os responsáveis do documento (`lib/lanes.js`); o prompt pede raias de responsáveis e as linhas `%% etapa:`.
- **Textos:**
  - "O pedido é embalado e despachado" → "Embalar e despachar pedido";
  - "reabre a triagem" volta para "Fazer triagem";
  - "reabre" → "reabrir".

**Testes novos** (`tests/cenarios/func_*.txt` e `tests/cenarios.js`): as 10 estruturas pedidas.
1. Um responsável (`func_um_responsavel`).
2. Dois responsáveis (`func_dois_responsaveis`).
3. Vários departamentos (`atendimento`).
4. Transferências de responsabilidade (`empresa_reembolso`).
5. Aprovação e rejeição (`empresa_reembolso`).
6. Caminhos de retorno (`empresa_reembolso`).
7. Atividades paralelas (`paralelo_evento`).
8. Responsáveis não identificados (`func_sem_responsavel`).
9. Etapas e funções distintas (`func_etapas_funcoes`).
10. Processo extenso com várias raias (`func_extenso`).

Em todos os documentos de teste, a regra geral também é conferida: raia nunca é título do documento; cada caixa fica dentro da sua raia e da sua faixa; nenhuma seta sobe fora de um retorno.

## Versão 4.0.3 (substituída pela 4.0.4): Funcional vertical sem raias quando não há responsáveis

Mudanças só no **Funcional**. Processo e Decisão continuam iguais (os testes de interface conferem).

**Regra geral** (não depende do assunto do PDF):
- **O documento cita 2 ou mais responsáveis** (cliente, vendas, suporte, financeiro, gestor, sistema…): uma raia em coluna por responsável, com o fluxo de cima para baixo e as setas atravessando as raias na passagem de responsabilidade. É o mesmo de antes.
- **O documento não cita responsáveis** (ou cita só um): **nenhuma coluna é criada a partir de títulos**. O fluxo é vertical, numa coluna central:
  - Início em cima e Fim embaixo;
  - decisões com ramos para os lados e convergência logo abaixo;
  - cada etapa do PDF vira uma **faixa horizontal** com título à esquerda (o fluxo desce por dentro das faixas).
- **Etapas que acontecem lado a lado** ficam na mesma faixa, com os ramos lado a lado: preparos paralelos ("Preparo da massa" e "Preparo da cobertura") ou métodos alternativos que saem do mesmo losango ("Instalação por disco", "digital", "remota").
- **Documento sem etapas nem responsáveis:** fluxo vertical simples. As "Fase 1/Fase 2" inventadas foram removidas.

| Componente | O que mudou |
|---|---|
| `lib/heuristic.js` (`serializeLanes`) | Raias só com 2+ responsáveis; senão, etapas marcadas como faixas (`%% raias: etapas`); paralelas e alternativas na mesma faixa; sem fases inventadas |
| `lib/pipeline.js` (`markStageLanes`) | Código vindo da IA com raias que são títulos de etapas (não funções) recebe a marca de faixas: o desenho fica vertical mesmo assim |
| `lib/prompt.js` | Regras do Funcional para a IA: sentido TD, raias só para responsáveis reais, etapas em faixas, dicas dentro do bloco |
| `public/swimlane.mjs` | Modo vertical do Funcional: colunas estáveis por caminho (um ramo nunca pula para baixo de outro), losango com uma ponta por saída, setas que chegam ao mesmo bloco juntas numa linha só, retornos por um corredor lateral, faixas encostadas e da largura do quadro |
| `lib/validate.js` | A checagem de omissões considera as observações dentro dos blocos |

Fluxogramas salvos no histórico com raias de etapa são redesenhados no novo formato vertical ao serem abertos.

## Novidades da versão 4.0.2: correções do teste "Roblox pelo celular" (Funcional)

| Problema | Causa | Correção |
|---|---|---|
| A **Etapa 3** sumia: os passos dela iam para a Etapa 2 | O PDF quebra linhas pela largura da página; quando o último passo da Etapa 2 não terminava com ponto, a linha "Etapa 3: …" era colada nele como continuação | Linha "Etapa/Passo/Fase N" nunca é continuação da anterior (`lib/heuristic.js`, `parseDocument`) |
| "Importante: colocar idade real…", "Não usar nome real…", "Anotar senha…" viravam atividades | A fusão de dicas só valia para o Processo | No Funcional, dica/aviso vira observação dentro do bloco relacionado: data de nascimento, nome de usuário, senha |
| "Acessar loja de aplicativos" seguido de "Abrir loja de aplicativos" | A remoção de duplicados só comparava o texto exato | Passos seguidos com o mesmo objeto e verbo de navegação (acessar/abrir/entrar/ir até) viram um só (`lib/validate.js`) |
| "Informar gênero: Selecione estilo inicial do avatar" | O rótulo "Gênero:" com ação em maiúscula não era separado | Vira "Selecionar estilo inicial do avatar" (`lib/shorten.js`) |
| "Começar jogar" / "Comecer jogar" | "comece" virava "comecer", e o "a" antes do verbo era tratado como artigo | "Começar a jogar" |
| "…ou tocar no ícone" (ícone de quê?) | Corte em 7 palavras | Substantivos de interface (ícone, botão, opção, menu, aba…) mantêm o complemento: "tocar no ícone de lupa"; a 2ª ação depois de "ou/e" também vai para o infinitivo |
| "Verificar desenvolvedor é Roblox Corporation" | O "se" e o verbo eram retirados | "Verificar se desenvolvedor é Roblox Corporation" |
| Observação encostando nas pontas do bloco inclinado | O texto usava a largura toda do paralelogramo | O texto fica na parte reta do bloco (`public/visual-model.mjs`) |

Testes novos: `roblox_celular` (documento recriado a partir do fluxograma do teste) e `loja_redundante`.

## Novidades da versão 4.0.1: Fluxograma Funcional mais claro

Ajustes feitos só no que afeta o **Funcional (raias)**. Os outros tipos continuam como na 4.0.

| Problema | Causa | Correção |
|---|---|---|
| Ramos de "Qual instalação usar?" começavam no topo das colunas e as setas subiam e cruzavam a tela | Nas raias por etapa, todo passo vindo de outra coluna ia para a 1ª linha | Vindo de um losango (métodos alternativos), o ramo começa **na altura do losango**, e a seta segue reta para o lado (`public/swimlane.mjs`) |
| Saídas do losango sem rótulo ou com rótulos empilhados | Várias saídas pela mesma ponta | O rótulo vai para o trecho final de cada seta, junto do destino; a bifurcação passa **por cima** dos blocos, sem cruzar as linhas que descem nas raias |
| Fim no meio do diagrama, com setas longas atravessando raias | O Fim ficava na linha do último passo que chegava nele | Quando chegam caminhos de outras raias, o Fim vai para a **última linha** e os caminhos se juntam num tronco só |
| Setas que chegam ao mesmo bloco em linhas paralelas quase coladas | Cada passagem pelo corredor deslocava a próxima | Setas com o mesmo destino usam a **mesma linha** do corredor |
| Passagem de uma etapa para a outra entrava no mesmo ponto que o retorno ("Tela da BIOS aparece?" → Não) | As duas usavam a lateral do bloco | A passagem entra **por cima**; a lateral fica para os retornos |
| Retorno para outra raia passava por cima da linha do losango ("Corrigir" → "Analisar solicitação") | Retorno entrava por baixo do destino | Sai por cima, sobe por um corredor livre e entra pela lateral virada para a origem |
| "Corrigir solicitação" na raia do Gestor | Ações de um ramo ficavam todas com o responsável atual | "o colaborador é notificado e corrige…": notificar fica com quem age e corrigir vai para a raia do **Colaborador** (`lib/heuristic.js`) |
| "Inserir disco com etiqueta voltada…" voltava para "Inserir disco" | "voltada" era lido como "voltar" (retorno) | "voltada/voltado" não é mais retorno |
| "Console está conectado à internet?" Não → voltava para o passo anterior | Verificação com só o "Sim" descrito virava laço inventado | O Não segue para o próximo passo; "Certifique-se de que X" sem consequência vira o passo "Verificar X" |
| "Conectar monitor, teclado e cabo", "…com marcação", "…que não esteja" | Corte em 7 palavras no meio do complemento | O complemento curto é completado ("cabo de energia", "marcação do soquete"); a oração com "que" cortada sai inteira (`lib/shorten.js`) |
| Aviso "aparece 2 vezes" para "Responder ao cliente" de vendas e de suporte | A checagem ignorava a raia | Mesma atividade em raias diferentes não gera aviso (`lib/validate.js`) |
| Colunas difíceis de seguir | Todas as raias com o mesmo fundo | Raias com fundo alternado e faixa de cor no cabeçalho |

Testes novos em `tests/cenarios.js`: `instalar_ps5`, `empresa_reembolso`, `atendimento` e `textos`.

## Novidades da versão 4.0: gerador inteligente em camadas

### Arquitetura (as 5 camadas)

| Camada | Responsabilidade | Arquivos |
|---|---|---|
| 1. Extração | Lê o PDF no navegador (pdf.js), remove cabeçalhos e rodapés repetidos e separa seções, etapas e itens. | `public/app.js` (`extractPdfText`), `lib/heuristic.js` (`parseDocument`) |
| 2. Interpretação | Entende o processo: objetivo, etapas, atividades, decisões, validações, dependências, repetições, dúvidas. | `lib/interpret.js` + `lib/heuristic.js` (modo Regras) ou IA (`lib/ai.js` + `lib/prompt.js`) |
| 3. Representação | Modelo estruturado: nós tipados (início, fim, atividade, decisão, entrada/saída, dúvida), ligações e grupos. | `lib/model.js` |
| 4. Validação | Revisa e corrige o modelo antes de exibir, e lista o que não pôde ser corrigido. | `lib/validate.js`, `lib/pipeline.js` |
| 5. Renderização | Só desenha o código já validado: layout, setas ortogonais, editor e exportação. | `public/swimlane.mjs`, `public/visual-model.mjs`, `public/visual-editor.mjs` |

Tanto o código da IA quanto o do modo Regras passam pelas camadas 3 e 4, e o código Mermaid exibido é gerado a partir do modelo validado.

### Interpretação (camada 2)

- **Objetivo do processo:** linhas como "Objetivo:" e "Escopo:" são identificadas e saem do fluxo. O objetivo aparece na Análise.
- **Sequência operacional, e não a ordem dos parágrafos:**
  - dependências explícitas são respeitadas: "clique em Concluir **quando a gravação terminar**" vai para depois da gravação, e "**antes de** X, faça Y" vai para antes de X;
  - um passo de finalização ("Concluir", "Finalizar") que aparece antes de passos de configuração da mesma etapa vai para o fim dela;
  - toda reorganização é avisada na Análise, e nada é reordenado sem evidência no texto.
- **Decisões em losango** (se, caso, quando, senão, verifique se, confirme se, perguntas como "foi aprovado?" e "ocorreu algum erro?"), analisando o contexto:
  - condição e negação viram **uma** decisão com as duas saídas: "Confirme se há papel" + "Se não houver papel, coloque" e "Se o gestor aprovar…" + "Se o gestor reprovar…";
  - "Informe a chave. Se não tiver a chave, clique em…" vira "Tem chave do produto?", com Sim → informar e Não → clicar;
  - "Se sim, …" e "Se não, …" depois de uma pergunta viram os ramos dela;
  - várias condições sobre o mesmo assunto viram **uma decisão com várias saídas** rotuladas;
  - "quando" que só indica momento ("quando terminar") e "se necessário" **não** criam losango.
- **Caminhos de erro, retorno e repetição**, sempre com base no documento:
  - "Caso contrário, verifique a conexão e reinicie o computador" → Não → Verificar conexão → **volta** para "Ligar computador", sem criar um bloco repetido;
  - "Se o erro persistir após 3 tentativas, abra um chamado" → losango dentro do laço;
  - quando o próximo passo depende só do ramo Sim (por exemplo, "receber confirmação do **pagamento**"), o ramo Não termina em "Fim sem conclusão".
- **Informação ambígua ou incompleta:** nada é inventado.
  - Uma condição sem o caminho "Não" vira o bloco tracejado **"Caminho não descrito no documento"**.
  - "Talvez seja necessário… dependendo da versão" fica como passo marcado com dúvida ("Critério não definido: dependendo da versão").
  - Os dois casos aparecem como aviso.
- **Atividades em paralelo:** preparos independentes começam juntos e se encontram no passo que usa o resultado.

### Símbolos e texto

- **Símbolos:**
  - estádio para início e fim;
  - retângulo para atividade;
  - losango para decisão;
  - **paralelogramo para entrada ou saída de dados** (informar, digitar, preencher, registrar, imprimir, emitir relatório);
  - retângulo tracejado laranja para dúvida.
- **Textos de até 7 palavras** (antes eram 5), sem frases cortadas:
  - advérbios ("repetidamente") e quantidades ("de no mínimo 8 GB") saem antes de cortar a ação;
  - "Ligue o computador e pressione F12… **para abrir o menu de boot**" vira "Ligar computador e abrir menu de boot", e as teclas ficam como observação em itálico no próprio bloco.

### Layout automático (tipo "Automático", agora o padrão)

O gerador escolhe a estrutura pelo conteúdo do documento, sem impor 4 colunas a todo PDF:
- **raias**, quando há responsáveis ou departamentos, ou atividades em paralelo;
- **ramificado por etapas**, quando há 3 ou mais decisões reais ou o processo é extenso. Nesse layout, cada etapa vira um bloco com título e nenhuma pergunta é acrescentada;
- **vertical (Processo)**, nos demais casos.

O motivo da escolha aparece na Análise. Os tipos escolhidos à mão continuam funcionando como antes. Uma diferença: no tipo Decisão, as etapas do documento agora também aparecem como blocos com título.

### Validação antes de exibir (camada 4)

- **O que é verificado:**
  - início e fim (são criados se faltarem);
  - ligações quebradas, repetidas ou de um elemento para ele mesmo;
  - atividades desconectadas ou sem continuação;
  - decisões sem "?", com uma saída só ou com saídas sem rótulo;
  - passos duplicados em sequência;
  - laços sem saída ou sem condição;
  - caminhos que não chegam ao fim;
  - **instruções do documento sem bloco correspondente** (possível omissão);
  - no navegador, **caixas sobrepostas e setas passando por cima de caixas**.
- **Onde aparece:** o que é corrigido automaticamente fica listado no cartão **Validação do diagrama**, na aba Análise. Quando sobra um erro grave, uma faixa vermelha avisa no topo do resultado que o fluxograma precisa de revisão, para ele não ser apresentado como validado.

### Como testar

```
npm test                      (ou: node tests/run.js && node tests/cenarios.js)
```

`tests/cenarios/` traz 8 documentos com estruturas diferentes, e `tests/cenarios.js` confere a lógica e o desenho de cada um. `exemplos/formatar_windows.pdf` é o caso da formatação do Windows em PDF, para testar pela interface.

## Os 3 tipos de fluxograma

No topo do cartão de envio, escolha o padrão na caixa **Tipo de fluxograma** (Processo (Linear / Simples), Funcional (Swimlane / Raia) ou Tomada de Decisão) **antes** de enviar o PDF. A escolha fica memorizada. Ela vai para o motor (IA ou Regras), que adapta a forma de interpretar o documento, e o desenho final segue o gabarito de cada tipo:

| Tipo | Para quê | Como fica |
|---|---|---|
| **Processo** (linear) | Sequência direta de atividades, com início, meio e fim | **Um fluxo único e contínuo** de cima para baixo, do Início ao Fim, sem colunas, raias ou caixas de etapa. Só abre caminhos em **losangos de decisão** quando o documento traz uma condição real ("se…", "caso…"), com saídas **Não à esquerda e Sim à direita**. Guias longos são compactados: passos seguidos com o mesmo verbo viram um bloco só ("Conectar monitor, teclado e cabo"). |
| **Funcional** (raias / swimlane) | Mostrar **quem** faz cada etapa: área, departamento, cargo, sistema ou cliente | Uma **raia por responsável**, com o nome no cabeçalho: colunas na orientação vertical, faixas na horizontal. A passagem de uma área para outra aparece como seta de lado. |
| **Decisão** | Regras de negócio e triagens com perguntas Sim/Não | Árvore de losangos, **nunca uma lista linear**. Passos opcionais viram escolhas ("Deseja convidar amigos?"), validações viram conferências com volta para corrigir ("Conta confirmada?" → Não → Corrigir → tentar de novo) e cada etapa termina com "Passo N concluído?". Cada pergunta abre **Não à esquerda e Sim à direita** pelas pontas laterais. |

- **Etapas sem responsáveis (Funcional):** se o documento não citar responsáveis, cada raia é uma **etapa principal** ("Passo 1", "Passo 2"…), sempre começando pela primeira. Subseções (por exemplo "Telefone" dentro do Passo 3) e dicas entram na raia da sua etapa, e "Passo 1: Acesse o site." no meio do texto também abre a etapa. Todas as raias têm a mesma largura, e o cabeçalho cresce para caber o título inteiro.
- **Responsáveis (Funcional):** são reconhecidos no texto: "O cliente abre…", "A equipe de vendas analisa…", "Financeiro emite…", "Gerente: aprova…" e "(Responsável: X)". Se o documento não citar responsáveis, as raias são as seções do documento.
- **Distribuição por raias (Funcional):** cada bloco fica na raia da sua etapa ou responsável. O Início fica sempre na 1ª raia. Preparos paralelos (ex.: "Preparo da massa" e "Preparo da cobertura") começam juntos, cada um na sua raia logo após o Início, e se juntam ao fluxo no passo que usa o resultado ("Espalhar cobertura"). Repetições como "asse por mais 5 minutos" voltam ao passo de verificação. Quando a IA amontoa os passos numa raia só, o programa redistribui cada bloco na raia certa comparando com as etapas do documento e avisa em Análise.
- **Distribuição equilibrada (Funcional):** quando as raias são etapas ou fases (e não responsáveis), cada coluna começa no topo. Assim todas participam do diagrama inteiro, em vez de a 1ª coluna ocupar a metade de cima e as outras ficarem vazias. A passagem para a etapa seguinte sobe pelo corredor da coluna ao lado, sempre em 90°. Documentos sem responsáveis e sem etapas são divididos automaticamente em 2 a 4 fases equilibradas ("Fase 1: Acessar site…"), sem separar um losango dos seus ramos. Com responsáveis (Cliente, Vendas…), as raias continuam seguindo o tempo de cima para baixo.
- **Transições entre raias (Funcional):** as setas são sempre ortogonais. Elas saem pela lateral do bloco, cruzam a borda da raia em 90°, descem pelo corredor livre da raia de destino e entram pela lateral do bloco, sem atravessar textos. Retornos dentro da mesma raia sobem pelo canto livre e entram de lado. Se o caminho direto bater num bloco, a seta passa por uma faixa livre entre as linhas. Passagens que usam o mesmo corredor ficam lado a lado, sem se sobrepor, e losangos recebem a seta por cima.
- **Revisão de texto (todos os tipos):** antes de desenhar, cada bloco passa por uma revisão automática: verbo no infinitivo correto ("Fixe-a" → "Fixar", "Far verificação" → "Fazer verificação"), sem pronomes soltos, palavras repetidas ou cortadas e pontuação sobrando. Perguntas sempre terminam com "?".
- **Coesão do texto (Processo):** alternativas que vêm em sequência viram um passo só, em vez de dois passos obrigatórios. Por exemplo, "Abrir Google Play Store" seguido de "Abrir App Store" vira "Abrir loja de aplicativos". Quando os caminhos são diferentes de verdade, vira um losango. Passos repetidos em sequência também se juntam. Isso vale para o modo Regras e para o código da IA.
- **Regra universal 1, sem redundância (Processo, qualquer PDF):** passos seguidos que fazem a mesma coisa viram um só. Isso inclui verbos de navegação (acessar, abrir, entrar, ir até…) na mesma plataforma: "Acessar site do banco" seguido de "Entrar na plataforma" fica como um passo. O mesmo vale para sinônimos sobre o mesmo objeto (clicar/tocar, digitar/informar, verificar/conferir), repetições e alternativas como "Android ou iOS".
- **Regra universal 2, dicas dentro do bloco (Processo, qualquer PDF):** dicas, avisos e observações nunca viram bloco isolado. Isso vale para linhas como "Atenção:", "Dica:", "Importante:", "Nunca…", "Evite…" e "Anote…", e para os itens de seções como "Dicas de segurança", "Observações" e "Avisos". Elas entram como subtítulo em itálico no bloco de ação do mesmo assunto (a dica da senha vai no bloco da senha) ou, se nenhum tratar do assunto, no bloco anterior. São no máximo 2 por bloco; as que sobram vão para o bloco seguinte. Funciona no modo Regras e no código da IA.
- **Rótulos completos:** nenhum bloco termina cortado ("Não usar nome real nem" vira "Não usar nome real"), e campos de formulário viram ação ("Nome de usuário" vira "Informar nome de usuário", nunca "Nomar").
- **Título:** se o PDF não tiver título nos metadados, o fluxograma usa a primeira linha do documento em vez do nome do arquivo.
- **Edição e downloads:** o desenho de qualquer tipo pode ser editado no editor visual, e os downloads saem exatamente como aparecem na tela.
- **Orientação:** em ⚙️ → *Orientação*, escolha vertical ou horizontal; o desenho é refeito na hora.

## Telas

**Início:** área de envio do PDF e importação por link. O status do motor roda em segundo plano, sem avisos na tela: só um pontinho discreto na engrenagem ⚙️ (verde = IA ativa, cinza = modo Regras, vermelho = servidor desconectado). Passe o mouse para ver o nome.

**Histórico (☰, canto superior esquerdo):** o número no ícone indica quantos fluxogramas estão salvos. Na gaveta você pode:
- buscar por título ou conteúdo;
- 📌 **fixar** (os fixados ficam no topo);
- ✏️ **renomear**;
- 🗑️ **excluir** (com confirmação).

Tudo fica salvo no navegador.

**Resultado:**
- Nota de **Qualidade** (0 a 100) e o botão **Voltar ao Início**.
- Indicadores: **páginas lidas**, **elementos**, **decisões** e **modo usado** (Regras, Ollama, Claude ou OpenAI).
- Aba **HTML Final:** fluxograma renderizado com **barras de rolagem**. Para navegar, use a roda do mouse (com Shift, rola na horizontal) ou as barras. Para dar zoom, use os botões ou Ctrl + roda. ↻ ou dois cliques ajustam o desenho à tela.
- Aba **Código Mermaid:** editável, com validação e atualização ao vivo.
- Aba **Análise:** verificações de qualidade, lista das decisões com seus ramos e dados da geração.
- **Nível Resumido / Completo:** o Resumido agrupa sequências lineares de etapas, mantendo todas as decisões.
- **Baixar:** HTML final, SVG, PNG em alta resolução e `.mmd`.

Clique no título do resultado para renomeá-lo.

## Editor visual ✏️ (estilo draw.io)

Depois de gerar o fluxograma, clique em **Editar fluxograma**. O editor abre em tela cheia, já com o seu fluxograma carregado: mesmos blocos, cores, seções e ligações.

- **Barra de formas (esquerda):**
  - **Formas:** retângulo, arredondado, texto, título com parágrafo, elipse, quadrado, círculo, processo, losango, paralelogramo, hexágono, triângulo, cilindro, nuvem, documento, armazenamento interno, cubo, etapa, trapézio, fita, nota, cartão, balão, pessoa, atraso, dados armazenados, terminal e contêiner/seção.
  - **Linhas:** seta, linha, tracejada, pontilhada, dupla, grossa, em ângulo e curva.
  - **Arraste** uma forma para o desenho ou **clique** nela para adicionar no centro da tela.
- **Clique duplo:**
  - em um bloco, edita o texto ali mesmo (Enter confirma, Shift+Enter quebra linha, Esc cancela);
  - em uma seta, edita o rótulo (Sim/Não…);
  - em área vazia, cria um texto solto.
  - também dá para editar o bloco selecionado com **F2** ou **Enter**. Uma forma nova chega pronta para mover, ligar e redimensionar; o texto é escrito quando você quiser.
- **Mover e redimensionar:**
  - arraste o bloco para movê-lo; as 8 alças **ou as próprias bordas** do bloco selecionado mudam o tamanho;
  - tudo se encaixa na grade (segure **Alt** para mover livremente);
  - mover uma seção leva junto os blocos de dentro.
- **Ligar blocos:**
  - passe o mouse sobre um bloco e puxe uma das **bolinhas azuis** até outro bloco;
  - saindo de um losango, a seta já recebe o rótulo *Sim* e depois *Não*;
  - **clique** (sem arrastar) numa bolinha azul para criar o próximo bloco naquele lado, já ligado.
- **Linhas e setas livres (como no draw.io):**
  - **Indicadores:** passe o mouse sobre qualquer seta e os indicadores aparecem, sem precisar selecionar antes:
    - bolinhas nas pontas (azul = presa a um bloco; branca = solta);
    - puxadores em cada trecho;
    - nas linhas retas e curvas, pontos de dobra.
  - **Pontas soltas:** arraste uma ponta para qualquer lugar livre e ela **fica solta** ali, inclusive dentro de uma seção. Ela só se prende quando é solta sobre um bloco ou bem perto de uma âncora; o ponto verde mostra onde vai prender. Segure **Alt** para nunca prender.
  - **Formato da linha:**
    - nas setas em ângulo, arraste o puxador de um trecho para deslocá-lo; a linha vira "L", "Z" ou "U" e continua em 90°;
    - nas retas e curvas, arraste o ponto do meio para criar uma dobra (uma reta vira "L"), arraste uma dobra para movê-la, e um clique duplo nela a remove;
    - clique duplo num puxador de trecho, ou *botão direito → Rota automática da seta*, volta ao caminho automático.
  - **Mover a linha inteira:** arraste o corpo da linha. Se as pontas estiverem soltas, a linha toda se move; se estiverem presas, arrastar muda o formato do trecho.
  - Ao mover blocos selecionados juntos, as dobras das setas entre eles acompanham.
  - As setas em ângulo sem dobras manuais desviam sozinhas dos blocos.
- **Guias de alinhamento:** ao mover, linhas rosa aparecem e encaixam o bloco alinhado às bordas ou ao centro dos outros.
- **Botão direito:** menu com editar texto, recortar, copiar, colar, duplicar, excluir, trazer à frente, enviar para trás, desfazer, refazer e selecionar tudo. Na área vazia, adiciona texto, retângulo ou decisão no ponto clicado.
- **Selecionar e excluir:**
  - clique seleciona; Shift+clique ou arrastar na área vazia (laço) seleciona vários;
  - **Delete** exclui blocos e setas; ao excluir um bloco, as setas dele saem juntas.
- **Formatação (barra de cima):** cores de preenchimento, borda e texto, tamanho da letra, negrito, alinhamento, trazer à frente ou enviar para trás, duplicar. Nas setas: cor, contínua/tracejada/pontilhada, fina/grossa, ângulo/reta/curva e pontas.
- **Atalhos:** Ctrl+Z / Ctrl+Y desfaz/refaz (e devolve a seleção) · Ctrl+C / Ctrl+X / Ctrl+V / Ctrl+D copia/recorta/cola/duplica · Delete ou Backspace exclui · Ctrl+A seleciona tudo · setas do teclado movem (Shift = 10 px) · Espaço + arrastar move a tela · Ctrl + rolagem dá zoom · Ctrl+S salva.
- **Salvar Edições:**
  - o desenho fica guardado no histórico, inclusive depois de fechar o navegador;
  - a aba *HTML Final* passa a mostrar exatamente o que você desenhou;
  - **Baixar → PNG, SVG e HTML saem idênticos ao editor.** O código Mermaid e a Análise acompanham a estrutura (blocos, textos e ligações).
- **Voltar ao layout automático:** descarta o desenho manual. Isso também acontece se você editar o código Mermaid na aba *Código Mermaid*.

## Regras de qualidade do fluxograma

Valem para qualquer motor (IA ou Regras) e são **conferidas automaticamente** na aba Análise:

1. **Decisões reais em losango `{Pergunta?}`:** um losango só é criado quando o texto traz uma condição de verdade: "se", "caso", "quando", "verifique se", "certifique-se de que", "aprovado?", "sucesso/erro". A pergunta é a do documento (ex.: "Jogo já comprado?", "Há espaço suficiente no SSD?").
   - Nunca há losango vazio ou genérico ("Condição?", "Contrário?").
   - "Caso contrário" / "senão" vira o ramo **Não** da decisão anterior, e não uma pergunta nova.
2. **Ordem cronológica real:**
   - Etapas, fases e partes de um passo a passo ("Etapa 1: Preparação fora do gabinete", "Etapa 2: Instalação no gabinete") são feitas **uma depois da outra**, na ordem do documento: o último passo de uma etapa liga ao primeiro da seguinte.
   - Nunca vira um losango de escolha como "Qual etapa usar?", e o que é preparação vem sempre antes do que depende dela.
   - Só há bifurcação com condição real ("se sim / se não") ou com **alternativas explicitamente excludentes**: por exemplo, "Método 1 / Método 2", ou "Instalação por disco" **ou** "Instalação digital". Nesses casos, um losango de escolha abre um ramo por opção, lado a lado.
3. **Linhas limpas, sem emaranhado:**
   - As saídas Sim/Não saem pelas **pontas laterais** do losango, em rotas retas que desviam só dos blocos que estão no caminho (`public/route.mjs`).
   - Depois do desvio, os ramos **voltam ao fluxo principal** no passo seguinte: nada de setas subindo ou atravessando o desenho.
   - Em vez de "Corrigir pendência", o ramo Não traz a ação concreta (ex.: "Conectar console à internet").
4. **Uma ação por bloco (sem listas de tarefas):**
   - Cada caixa tem **uma única ação** curta e direta. Vários passos seguidos viram várias caixas pequenas ligadas em sequência, por exemplo: "Encaixar processador no soquete" → "Alinhar marcação do processador" → "Baixar trava do soquete".
   - Se a IA ainda devolver um bloco com lista ("- a - b - c"), o sistema o quebra automaticamente em passos encadeados (`lib/sanitize.js`).
   - Cada seção do documento vira um **bloco com título** (subgrafo), mantendo a sequência entre as seções.
   - A aba **Análise** tira pontos se aparecer bloco com lista ou escolha entre etapas.
5. **No máximo 5 palavras por linha**, no padrão "Verbo no infinitivo + objeto". Por exemplo, "O montador deve encaixar as quatro pernas nos cantos do tampo" vira "Encaixar quatro pernas nos cantos" (`lib/shorten.js`).
6. **Hierarquia limpa:** Início → passos → decisões → alternativas/exceções → Fim. **Início é o primeiro e Fim é o último elemento dentro do bloco principal**: com uma seção, ficam dentro dela; com várias, um bloco com o título do documento contém tudo. O que não é passo fica de fora: metadados do Confluence, visão geral, tabelas e observações.
7. **Espaçamento generoso** entre os blocos, e os textos nunca ficam cortados.

Para testar, use os PDFs em `exemplos/`: `montar_mesa.pdf` e `instalar_jogos_ps5.pdf`.

## Fluxogramas-modelo (`exemplos-modelo/`)

O app segue o formato de três fluxogramas de referência (as imagens originais estão em `exemplos-modelo/imagens/`):

| Modelo | O que ensina |
|---|---|
| 01 Atendimento na loja | Losangos na coluna central, Não à esquerda e Sim à direita, ramos terminando no Fim |
| 02 Recrutamento | Coluna central linear; reprovação vai para um bloco lateral que **volta pela lateral** ao passo de triagem |
| 03 Rotina do dia | Cada losango abre **dois blocos ao lado, na mesma altura**, que descem e entram juntos no próximo passo |

Os modelos são usados de duas formas:
- **No desenho (qualquer motor):** os ramos dos losangos ficam ao lado deles, na mesma altura, e voltam à coluna central. As linhas são retas (90°), os retornos sobem pela lateral e os espaços vazios são compactados.
- **Na IA:** os arquivos `.mmd` da pasta vão no prompt como exemplos de formato, com a instrução de **não copiar o conteúdo**. Para ensinar um novo formato, coloque outro `.mmd` na pasta e reinicie o app (veja `exemplos-modelo/LEIA-ME.txt`).

### Estilo visual (⚙️ → Aparência e preferências)
- **Clássico cinza** (padrão): como os modelos 1 e 3.
- **Azul corporativo:** como o modelo 2.
- **Moderno colorido:** verde, amarelo e vermelho.

O estilo vale na tela e em todos os downloads.

## Motores de análise (⚙️)

A janela ⚙️ mostra **só os campos do provedor escolhido** (Automático, Ollama, Claude, OpenAI ou Regras), com indicadores curtos de status: chave informada, conectado, não encontrado. Em **Automático**, aparece um resumo de cada motor. Os botões *Cancelar* e *Salvar* ficam sempre fixos no rodapé. Avisos de geração (por exemplo, quando a IA falha e o modo Regras assume) não aparecem mais flutuando na tela: ficam em **Análise → Sobre o documento → Observação**.

No modo **Automático**, o app escolhe nesta ordem:

| Ordem | Motor | Quando é usado | Privacidade |
|---|---|---|---|
| 1 | **Claude** | Chave da Anthropic configurada | Texto enviado à API |
| 2 | **OpenAI / compatível** | Chave configurada | Depende do serviço |
| 3 | **Ollama** | Ollama rodando com um modelo baixado | **100% local** |
| 4 | **Regras** | Nenhum dos anteriores | **100% local** |

Para usar IA 100% local:
1. Instale o Ollama em https://ollama.com.
2. Rode `ollama pull llama3.1`.

Em ⚙️ → Provedor "Ollama", o indicador mostra "Conectado · N modelos" (ou "Sem modelos" / "Não encontrado"); o botão **Testar conexão** confere a URL antes de salvar.

As chaves ficam somente neste computador, no arquivo `config.json`.

## Garantia de resultado

1. O texto do PDF é lido no navegador, e cabeçalhos e rodapés repetidos são removidos.
2. O motor gera o fluxograma com regras rígidas: decisões em losango `{Pergunta?}`, saídas `-->|Sim|` / `-->|Não|` e desvios pelas laterais.
3. O código é limpo e validado com o Mermaid. Se houver erro, a IA o corrige sozinha (até 2 tentativas). Se ainda assim falhar, o **modo Regras** assume, então sempre sai um fluxograma.

## Limitações conhecidas (versão 4.0)

- **Modo Regras:** a interpretação funciona com regras de linguagem, sem IA. Ela entende bem procedimentos escritos em passos, condições ("se", "caso", "verifique se") e repetições, mas texto muito livre (parágrafos longos sem passos) gera fluxos mais simples. Com uma IA conectada, o resultado passa pelas mesmas validações.
- **Ordem:** só é reorganizada com evidência no texto ("quando", "após", "antes de", ou um passo de conclusão no meio da configuração). Inversões sem nenhuma pista não são detectadas.
- **Contradições:** o gerador não identifica contradições entre trechos distantes do documento. Ele marca como dúvida apenas condições sem consequência e instruções vagas.
- **Retornos deduzidos:** quando o documento não diz o que fazer se uma verificação falhar, o caminho "Não" volta para o passo verificado (refazer). Isso é sempre avisado na Análise.
- **Conectores de página:** documentos muito extensos geram um diagrama longo (as etapas aparecem em blocos com título), mas não são divididos em várias páginas com conectores.
- **Cruzamentos de setas:** a validação visual reconhece sobreposição de caixas e setas sobre caixas, mas cruzamentos entre duas setas ainda podem acontecer em fluxos com muitos retornos.
- **Arquivos sem texto:** PDFs escaneados (imagem) continuam sem suporte, porque não há OCR.

## Problemas comuns

- **"Não encontrei texto":** o PDF é uma imagem escaneada. Exporte novamente do Confluence (Exportar → PDF).
- **Link do Confluence pede login:** baixe o PDF e use o upload, ou informe um *Personal Access Token* em ⚙️ → Aparência e preferências → Avançado.
- **Baixei a versão nova, mas aparece a antiga:** a janela preta da versão anterior ainda estava aberta, ocupando a porta 3210.
  - A partir da versão 3.2.0, o `INICIAR.bat` resolve isso sozinho: pede para a versão antiga fechar ou, se ela não souber fechar, abre a nova na próxima porta livre (3211, 3212…).
  - Confira a versão em ⚙️ Configurações, logo abaixo do título.
  - Para voltar à porta padrão, feche as janelas pretas antigas.
- **Porta ocupada por outro programa:** o app usa a próxima porta livre. Para fixar uma porta, defina a variável `PORT`, por exemplo `PORT=4000`.

## Estrutura

```
server.js           servidor local (Node puro; só aceita conexões desta máquina)
lib/prompt.js       regras do fluxograma enviadas à IA
lib/ai.js           motores (Claude, OpenAI, Ollama) + detecção automática
lib/sanitize.js     limpeza e correção automática do código Mermaid
lib/heuristic.js    modo Regras (sem IA): extração das seções e montagem do fluxo
lib/interpret.js    camada 2: objetivo, dependências, condições, repetições e dúvidas
lib/model.js        camada 3: modelo estruturado (nós tipados, ligações, grupos) ⇄ Mermaid
lib/validate.js     camada 4: validação lógica e estrutural com correção automática
lib/pipeline.js     orquestra as camadas e escolhe o tipo Automático
lib/coherence.js    redundâncias, sinônimos e dicas dentro dos blocos
lib/lanes.js        correção das raias vindas da IA
lib/shorten.js      encurta textos para até 7 palavras (verbo + objeto)
public/route.mjs    saídas laterais dos losangos (pós-processamento do SVG)
public/visual-model.mjs  formas, rotas das setas, desenho SVG e conversão para Mermaid
public/visual-editor.mjs editor visual estilo draw.io (paleta, seleção, conexões, texto no lugar)
public/swimlane.mjs      layout automático dos 3 tipos (coluna do Processo, raias do Funcional, árvore da Decisão)
public/graph.mjs    análise do fluxograma: qualidade, decisões, nível Resumido
public/             interface (index.html, style.css, app.js) + vendor/
tests/run.js        testes de unidade (npm test)
tests/cenarios.js   8 cenários de ponta a ponta (tests/cenarios/*.txt)
exemplos/           PDFs de exemplo (montar mesa, jogos no PS5, chamados, Roblox, formatação do Windows)
exemplos-modelo/    fluxogramas-modelo (.mmd) usados como referência de formato + imagens originais
```

Licenças de terceiros: Mermaid (MIT) e pdf.js (Apache 2.0), em `public/vendor/`.
