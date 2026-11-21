# Como interpretar o monitor do SQL Server

Comece pelo nome do banco e pelo horário da última leitura. Um mesmo servidor pode atender vários bancos. A memória é medida na instância. Tabelas, arquivos e sessões podem ter um escopo diferente. [Abrir o monitor e conectar ao banco](../README.md)

## Está usando toda essa RAM agora?

| Campo do painel | O que ele responde |
| --- | --- |
| Memória em uso | No SQL Server, o cartão informa quantos bytes o gerenciador de memória comprometeu para cache e trabalho na instância. O valor exato em bytes aparece abaixo. |
| Memória física usada pelo processo SQL | Quanto o processo SQL ocupa na RAM do sistema naquele instante. Inclui componentes que o gerenciador contabiliza separadamente. |
| Limite configurado | Qual teto está em vigor na configuração `max server memory`. 16 GiB equivalem a 17.179.869.184 bytes. |
| Meta dinâmica do gerenciador SQL | Quanto o gerenciador busca manter nas condições atuais. |
| Maior leitura observada · até 7 dias | O maior valor que o Jujuba realmente coletou. Confira data, intervalo e quantidade de amostras. Uma amostra representa um instante. Quando o monitor fica fechado, há intervalos sem coleta. |
| Pressão de memória agora | Reúne sinais de pouca RAM e de consultas que aguardam memória. Para decidir sobre o limite, compare esses sinais com a RAM livre do servidor e a demora observada durante um período de uso intenso. |

Um banco pode conservar em memória os dados que acabou de ler para responder mais rápido na próxima consulta. Para comparar consultas, registre a memória reservada, a parte usada, o tempo e quantas linhas cada execução processou. [Monitoramento de RAM](https://learn.microsoft.com/en-us/sql/relational-databases/performance-monitor/monitor-memory-usage?view=sql-server-ver16) · [Reservas de memória por consulta](https://learn.microsoft.com/en-us/troubleshoot/sql/database-engine/performance/troubleshoot-memory-grant-issues)

## Por que a lista de sessões está vazia?

Em **Sessões e aplicações**, retire o filtro de texto e alterne entre **Banco selecionado** e **Instância**. O painel informa quantas sessões de usuário a conta consegue ver e exclui a conexão usada pela própria leitura. Zero no banco pode coexistir com várias sessões na instância. “Leitura de sessões indisponível” indica que o painel não conseguiu obter a medição. Uma consulta curta também pode começar e terminar entre duas amostras.

**Atividade por objeto** lista até 20 tabelas do banco com leituras ou atualizações registradas pelo SQL, ordenadas pelo último acesso. Uma lista vazia pode acompanhar um banco ocioso ou uma conta com visibilidade limitada. Para investigar uma operação específica, abra o monitor durante a operação e anote banco, horário, conta usada e escopo mostrado.

## O que significa cada coluna de atividade dos arquivos?

| Coluna | Em palavras simples |
| --- | --- |
| Arquivo lógico | Nome interno do arquivo. O de dados guarda tabelas e índices. O de log registra mudanças para recuperação. |
| Leituras | Quantas operações pediram dados ao arquivo. Uma operação pode trazer várias páginas. |
| Gravações | Quantas operações pediram que o arquivo salvasse dados. |
| Volume lido | Quantidade total de bytes lidos. Ler o mesmo trecho duas vezes conta as duas leituras. |
| Volume gravado | Quantidade total de bytes escritos. Regravar um trecho aumenta esse total. |
| Latência média de leitura | Tempo médio de espera para receber uma leitura, em milissegundos. |
| Latência média de gravação | Tempo médio de espera para concluir uma gravação, em milissegundos. |

A tela identifica o período acumulado. Para investigar uma lentidão recente, pegue duas leituras dos contadores do mesmo arquivo. Divida o acréscimo de tempo de espera pelo acréscimo de operações. Por exemplo, 80 ms adicionais em dez gravações dão 8 ms por gravação no intervalo. Com zero gravações, não há média a calcular. [Estatísticas de I/O por arquivo](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-objects/sys-dm-io-virtual-file-stats-transact-sql?view=sql-server-ver16)

## Quanto espaço cada coluna ocupa?

Em **Dashboards → Armazenamento**, clique em uma tabela. **Reservado** mostra o espaço separado pelo banco para a tabela e seus índices. **Usado** mostra a parte já ocupada. Dentro da tabela, a tela exibe o nome da coluna, o tipo SQL e a soma dos bytes dos valores das linhas que conseguiu medir.

Confira o método exibido. **Leitura completa** cobre todas as linhas lidas. **Amostra por páginas** traz uma contagem de linhas medidas e pode oferecer **Estimado na tabela**, uma projeção. **Leitura limitada** cobre apenas o subconjunto indicado. Para medir o total dos valores de uma coluna, use **Medir todas as linhas** e confira a contagem concluída. Índices, compressão e estruturas de página influenciam o espaço físico da tabela. [Tamanho dos valores no SQL Server](https://learn.microsoft.com/en-us/sql/t-sql/functions/datalength-transact-sql?view=sql-server-ver16)
