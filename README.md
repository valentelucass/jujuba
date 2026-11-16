# JujubaSQL

## ⬇️ [Baixar o instalador para Windows (64 bits)](https://github.com/valentelucass/jujubasql/releases/latest)

<img src="frontend/src/assets/jujuba.png" alt="Mascote do JujubaSQL" width="112" />

Aplicativo desktop Windows para explorar SQL Server, MySQL, PostgreSQL, SQLite, MongoDB e Redis. O Tauri abre a interface React e o backend Rust local executa as consultas.

## Instalar e conectar

Na tela inicial, clique em **Nova conexão** e escolha o tipo de banco no centro. O painel direito mostra os bancos disponíveis e destaca a sua escolha. Para MySQL e PostgreSQL, informe servidor, porta e credenciais. Para PostgreSQL, indique também um banco inicial acessível. Para SQLite, abra um arquivo existente. Os três oferecem consultas, navegação, filtros e diagrama das chaves estrangeiras. A edição de células e os dashboards continuam disponíveis no SQL Server.

### MongoDB e Redis

- No MongoDB, informe uma URI `mongodb://` ou `mongodb+srv://`. Abra uma coleção para consultar documentos paginados e aplicar filtros JSON.
- No Redis, informe uma URI `redis://` ou `rediss://`. Indique o banco na URI, como `/2`, para abrir o `db2`. Busque chaves por padrão e confira tipo, valor e expiração.

### SQL Server

1. Execute o instalador x64 do JujubaSQL. O aplicativo usa o runtime gratuito Microsoft Edge WebView2. O instalador pode baixar o runtime se ele ainda não estiver no Windows.
2. Abra o JujubaSQL pelo menu Iniciar e selecione **Conectar**.
3. Se o SQL Server estiver no mesmo Windows, selecione **Neste computador**. Deixe **Instância local** em branco para a instância padrão. Esse modo usa a memória compartilhada do Windows e requer o Microsoft ODBC Driver 18 ou 17 para SQL Server, x64.
4. Para outro computador, selecione **Pela rede** e informe o nome DNS e a porta TCP do servidor. Use a rede privada ou a VPN, se aplicável. O certificado precisa corresponder ao DNS e ser confiável no Windows. Nos dois modos, escolha um usuário autorizado do SQL Server ou a conta atual do Windows. O JujubaSQL preenche os dados da última conexão bem-sucedida. A senha de SQL pode ser lembrada neste PC.
5. Escolha um banco na lista pesquisável ou no explorador. Abra um esquema, a pasta **Tabelas** e uma tabela.

O login deve conseguir abrir o catálogo `master` para descobrir os bancos. Em cada banco, o SQL Server define quais objetos e registros o login pode consultar. A permissão `VIEW DEFINITION` nos objetos relevantes pode permitir classificar mais relações.

## Planejar um sistema com IA

O ícone do assistente no canto inferior direito abre o mesmo chat em todas as telas. Descreva o fluxo ou anexe até quatro documentos de texto, como Markdown, TXT, JSON ou CSV. O assistente reconhece a tela atual e pode propor um fluxograma de sistema. Use **Abrir diagrama no editor** para revisar. Em **Diagramas**, crie etapas pelo painel direito, conecte-as e arraste os cartões. O arquivo `.jujuba.json` guarda o fluxo e as posições. Você também pode exportar Markdown com Mermaid.

Para usar a conta de um assistente, instale o cliente oficial no Windows e entre nele primeiro. Em seguida, selecione-o no chat e clique em **Conexão → Verificar assistente**.

- **ChatGPT** usa o Codex instalado no computador. Na primeira vez, execute `codex login` e escolha entrar com o ChatGPT. [Autenticação do Codex](https://learn.chatgpt.com/docs/auth)
- **Claude** usa o Claude Code instalado no computador. Abra `claude` e siga a instrução de login. [Instalação e login do Claude Code](https://code.claude.com/docs/en/quickstart)
- **Gemini** usa o Gemini CLI instalado no computador. Abra `gemini` e escolha entrar com o Google para autenticar o cliente. [Autenticação do Gemini CLI](https://geminicli.com/docs/get-started/authentication/)

Em **Código**, o assistente usa o fluxograma salvo para criar uma primeira implementação. Revise a prévia e escolha onde salvar os arquivos. No chat, clique no ícone de pasta para escolher um projeto e peça ajuda para entender ou editar seus arquivos. Ao enviar da tela **Diagramas**, o fluxo aberto acompanha o pedido. Os clientes usam a sessão configurada no Windows e enviam o pedido e o contexto de trabalho ao serviço escolhido.

Use o ícone do sol ou da lua na barra superior para trocar entre fundo branco e preto. O aplicativo lembra a sua escolha.

## Desenvolver e compilar

Requisitos no Windows x64:

- Node.js 22.12 ou superior e npm.
- Rust estável com o alvo `x86_64-pc-windows-msvc`.
- Microsoft C++ Build Tools com o Windows SDK e Microsoft Edge WebView2.

Na pasta do projeto, rode:

```powershell
Set-Location frontend
npm ci
npm run desktop -- dev
```

Para gerar o instalador:

```powershell
npm run desktop -- build
```

O pacote NSIS é gerado em `backend/rust/target/release/bundle/nsis/`. A entrega inicial usa um instalador x64 sem assinatura comercial. O pacote pode ser distribuído internamente conforme a política do Windows da empresa. Para executar os testes Rust, rode `cargo test --manifest-path backend/rust/Cargo.toml` a partir da raiz.

## Organização

- `frontend/src/models` define os tipos de catálogo, dados, conexão e relações. `controllers` coordena seleção, expansão e chamadas tipadas. `views` renderiza a interface Estúdio.
- `backend/rust/src` mantém os comandos Tauri, casos de uso e os adaptadores de catálogo, registros e conexões em `sql_server`. A ponte expõe comandos distintos para consulta SQL e edição de células. Na grade, os valores são parametrizados e os identificadores vêm do catálogo.
- `database` contém as instruções de validação com um banco existente ou isolado.

## Escopo da primeira versão

A árvore carrega os esquemas com tabelas visíveis e permite expandir as colunas. A grade pagina por 25, 50 ou 100 registros, filtra por trecho textual e ordena tipos compatíveis. Usa uma chave única visível quando possível para estabilizar a ordem. Valores textuais longos e binários são apresentados em prévia e valores CLR aparecem identificados como tal.

Selecione um banco para ver todas as tabelas e relações declaradas que o login consegue consultar. A aba Diagrama de uma tabela mostra as relações diretamente ligadas a ela, incluindo relações compostas e autorreferentes. Tabelas sem relações visíveis aparecem no grafo. Arraste os cartões das tabelas e os rótulos das relações para ajustar a visualização. A classificação usa a nulabilidade das colunas, a unicidade dos índices e a visibilidade dos metadados. O diagrama mostra a cardinalidade nas pontas da linha e explica os limites de cada lado no painel de detalhes. Quando a informação é insuficiente, a interface marca a cardinalidade como indeterminada.

## Consultar e editar

- **SQL** executa um único `SELECT` no banco escolhido. O editor aceita consultas com junções e CTEs e mostra até 200 linhas. O login deve ter as permissões de leitura exigidas pela consulta.
- Em **Dados → Editar células**, selecione uma célula compatível, informe o valor e revise a prévia antes de gravar. A edição exige permissão de `UPDATE`, chave primária compatível e confirmação. Se o valor original mudou, o JujubaSQL pede para atualizar a tabela. A primeira versão edita uma célula de texto ou de número inteiro por vez.
- Use uma conta com as permissões adequadas ao trabalho. Para testar gravações, use uma tabela autorizada em um banco de testes.

## Dashboards do banco

Selecione um banco e abra **Dashboards**. **Visão geral** mostra os objetos visíveis e um gráfico de capacidade por tipo de arquivo. **Armazenamento** compara o espaço usado e reservado pelas maiores tabelas, incluindo seus índices. **Desempenho** consulta o Query Store em períodos de 24 horas, 7 dias ou 30 dias. Alterne entre linha e barras para comparar duração média, número de execuções e tempo acumulado.

**Ao vivo** mostra solicitações em andamento, tipos de espera, sessões bloqueadoras e atividade de leitura e gravação por arquivo. Use **Só bloqueadas** para focar nos bloqueios por outras sessões. A atualização automática é opcional, roda a cada 15 segundos enquanto o painel está aberto e pausa se a leitura falhar. O painel exige permissão de monitoramento da instância e filtra as solicitações pelo banco selecionado.

Os painéis usam a conexão já aberta e as permissões do login. Estatísticas de partições e histórico podem exigir permissões adicionais de monitoramento. O JujubaSQL só consulta os metadados e o histórico disponível. A granularidade depende dos intervalos que o Query Store registrou.

## Senha salva no Windows

Ao conectar com um usuário do SQL Server, marque **Lembrar senha neste PC**. Após uma conexão bem-sucedida, a senha fica no Gerenciador de Credenciais da sua conta do Windows, vinculada ao servidor, à porta ou instância e ao usuário. Na próxima conexão, clique em **Conectar** para usar a senha salva. Use **Digitar outra senha** para substituí-la ou **Esquecer senha salva** para removê-la.

## Atualizações no Windows

Instale a versão 0.1.14 ou posterior uma vez. O JujubaSQL procura uma release ao abrir e destaca **Atualizações** na barra superior quando encontra uma versão mais recente. Abra **Atualizações**, salve seu trabalho e clique em **Atualizar agora**. O aplicativo valida a assinatura do instalador antes de iniciá-lo e reinicia após a instalação.

Para distribuir uma versão, atualize as versões do frontend e do backend, incluindo os arquivos de dependências, e envie a tag correspondente, como `v0.1.15`. O workflow **Release Windows** compila o instalador x64, assina o pacote e publica os arquivos em uma Release. A chave pública está na configuração do Tauri. A chave privada fica no secret `TAURI_SIGNING_PRIVATE_KEY` do GitHub Actions e deve ter uma cópia protegida. As instalações existentes confiam nessa chave.

## Validação na empresa

Para testar conexões pela rede, use um DNS coberto pelo certificado do servidor e um login autorizado. Na própria máquina do SQL Server, teste também a conexão por memória compartilhada.

Com a conexão aprovada, selecione `ETL_SISTEMA` e `ETL_SISTEMA_V2` se ambos estiverem acessíveis, ou dois bancos de teste autorizados. Abra uma tabela em cada banco, avance uma página, aplique filtro e ordenação e compare uma FK visível com o SSMS. Repita a conexão no PC pela rede privada ou VPN.

## Testes desta entrega

- Compilação TypeScript e Vite, binário Tauri x64 e pacote NSIS concluídos. A janela do JujubaSQL abriu no Windows e apresentou a tela de conexão.
- Três testes Rust locais passaram, cobrindo validação do nome do servidor e cardinalidade. Um teste separado com o conector Rust confirmou a rejeição de um certificado não confiável.
- O parser T-SQL do SSMS aceitou oito consultas de catálogo e leitura. O teste local da interface, com respostas de teste na ponte, passou para navegação por teclado, troca entre dois bancos, descarte de resposta obsoleta, paginação, ordenação, filtros, estrutura, permissões e FKs compostas e autorreferentes.
- A descoberta dos bancos e a abertura de tabelas pela conexão local foram verificadas no Windows. Valide o catálogo completo e eventuais gravações em um banco de teste autorizado.

## Referências

- Ícones dos bancos de dados de [Devicon](https://github.com/devicons/devicon/tree/v2.17.0), com licença em `frontend/src/assets/devicon-LICENSE.txt`.

- [ByteTable, commit a56ee2d](https://github.com/Rezwanul-Haque/byteTable/tree/a56ee2db01389ae24fbb8b64a3ffddb13375ec45) para arquitetura, catálogo e grade.
- [VeloxDB, commit ed58ff7](https://github.com/veloxbase/veloxdb/tree/ed58ff79acba554dd56444e54f6cdca64dede246) para árvore e diagrama.
- [Tabularis SQL Server Plugin, commit 5e03e8d](https://github.com/TabularisDB/tabularis-sqlserver-plugin/blob/5e03e8dec3fe29169e716b78d8c63a0b5091a2c5/src/driver/pool.rs) para autenticação integrada e verificação TLS.
- [OpenMetadata](https://github.com/open-metadata/OpenMetadata) para catálogo e dependências. [HyperDX](https://github.com/hyperdxio/hyperdx) para controles de filtros e resultados. [Trigger.dev](https://github.com/triggerdotdev/trigger.dev) como referência para histórico de ETL.
- [Apache ECharts](https://github.com/apache/echarts-examples) para os gráficos de armazenamento e desempenho. [Grafana para SQL Server](https://github.com/grafana/grafana-mssql-datasource) como referência para séries temporais e filtros por período.
