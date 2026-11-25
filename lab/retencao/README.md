# Laboratório de retenção por entidade

O ensaio reproduz uma fila em que cada posição é um dia de negócio em Brasília. Uma janela de 90 dias inclui o dia da rodada e os 89 anteriores. Em 25/11/2026, começa em 28/08. Em 26/11, começa em 29/08. A quantidade de registros pode variar entre dias e a janela avança mesmo se o dia novo estiver vazio.

Cada entidade do catálogo aceita um prazo próprio, herança do prazo do banco ou conservação integral. O exemplo começa com 90 dias apenas para Ocorrências. O prazo do banco começa desligado. Cada rodada lê a regra, verifica impedimentos e processa uma data por transação. O histórico de execução distingue uma data vencida de uma exclusão confirmada. Ampliar o prazo preserva esse histórico. Registros atrasados ainda dentro da janela entram normalmente. Os antigos demais, com data futura, desconhecida ou já retirada ficam disponíveis para revisão, com seu conteúdo.

## Reproduzir

Abra [a linha do tempo do ensaio](fila.html). Leia da esquerda para a direita. O trecho hachurado reúne os dias apagados e o trecho contínuo mostra os dias guardados. Ao clicar em **Avançar um dia** na passagem para 26/11, sai um registro de 28/08 e entram três de 26/11. Em **Entidade e prazo**, você pode comparar filas, simular outra regra e consultar um dia específico. A linha funciona offline com dados fictícios e começa em 25/11 ao reabrir o arquivo.

Em um computador de testes com SQL Server LocalDB, execute `./lab/retencao/testar.ps1 -Resultado resultado-retencao.json`. O script cria uma instância com nome aleatório, confirma o motor, prepara uma base sintética, executa os cenários e encerra a instância. A evidência contém as datas de corte, contagens e verificações concluídas. O fluxo de CI desta branch roda em um Windows descartável.

## Aplicação ao ETL

Para Ocorrências, o contrato do relatório 12072 identifica a data do evento. O recebimento operacional identifica entidade, escopo, dia de negócio e captura. O preparo 059 relaciona captura e partição publicada e a visão 062 consulta a marca de cobertura. Uma implementação precisaria retirar ou marcar a partição de forma coerente com a origem, a publicação, a cobertura e os leitores autorizados. Uma política de Performance só pode remover a sua cópia própria depois de identificar as dependências. Uma visão SQL que lê uma origem compartilhada pode ter uma janela de exibição independente.

O staging governado do ETL já tem um processo com arquivo, retenção e restauração próprios. O ensaio usa tabelas fictícias, regras injetadas e uma cópia de conferência na mesma base descartável. Antes da ativação operacional, é preciso homologar a identidade de cada entidade e seu fuso, os consumidores que precisam de histórico, o destino do arquivo e sua restauração, a interação com reprocessamentos e o custo dos lotes com o volume real.

A redução das linhas ativas permite reaproveitamento interno de espaço. Retorno de espaço físico ao sistema operacional é outra operação, dependente dos arquivos e da alocação. [Gerenciamento do tamanho dos arquivos no SQL Server](https://learn.microsoft.com/pt-br/sql/relational-databases/databases/shrink-a-database)
