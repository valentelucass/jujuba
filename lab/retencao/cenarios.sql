SET NOCOUNT ON;
SET XACT_ABORT ON;
IF ISNULL(CONVERT(int,SERVERPROPERTY('IsLocalDB')),0)<>1 OR DB_NAME()<>'JujubaRetencaoLab'
    THROW 54000, 'Destino diferente do laboratorio.', 1;

CREATE TABLE #testes (nome nvarchar(120) PRIMARY KEY);
CREATE TABLE #rodadas (hoje date, primeiroDia date, diasApagados int, registrosApagados int, registrosAtivos int);
DECLARE @base date='20260824';
;WITH dias AS (SELECT 0 AS n UNION ALL SELECT n+1 FROM dias WHERE n<93)
INSERT lab.Particao(id,entidade,dia,recebida)
SELECT e.i*1000+d.n,e.nome,DATEADD(day,d.n,@base),DATEADD(day,d.n,@base)
FROM dias d CROSS JOIN (VALUES(0,'OCORRENCIAS'),(1,'FRETES_LEITURA'),(2,'COLETAS'),(3,'PERFORMANCE')) e(i,nome);
INSERT lab.Origem
SELECT p.id,o.n,p.id%7 FROM lab.Particao p
CROSS JOIN (VALUES(1),(2),(3),(4)) o(n)
WHERE o.n <= 1+(p.id%1000+p.id/1000)%4;
INSERT lab.Publicacao SELECT particao,ordem,valor*2 FROM lab.Origem;
INSERT lab.Cobertura SELECT id FROM lab.Particao;

SELECT * INTO #originais FROM lab.Origem;
SELECT * INTO #publicados FROM lab.Publicacao;
SELECT * INTO #cobertas FROM lab.Cobertura;
SELECT id,entidade,dia,recebida INTO #particoes FROM lab.Particao;

IF (SELECT COUNT(*) FROM lab.Previa('OCORRENCIAS','20261125'))<>4
    OR (SELECT COUNT(*) FROM lab.Particao)<>376 OR EXISTS(SELECT 1 FROM lab.ArquivoParticao)
    THROW 54200, 'Previa ou isolamento incorreto.', 1;
INSERT #testes VALUES(N'Prévia sem escrita');

DECLARE @dia date;
BEGIN TRY
    EXEC lab.LimparDia 'OCORRENCIAS','20261125',@dia OUTPUT,1;
    THROW 54201, 'A falha de teste nao ocorreu.', 1;
END TRY
BEGIN CATCH
    IF ERROR_NUMBER()<>54003 THROW;
END CATCH;
IF EXISTS(SELECT * FROM #publicados EXCEPT SELECT * FROM lab.Publicacao)
    OR EXISTS(SELECT * FROM #cobertas EXCEPT SELECT * FROM lab.Cobertura)
    OR EXISTS(SELECT * FROM #originais EXCEPT SELECT * FROM lab.Origem)
    OR EXISTS(SELECT * FROM lab.ArquivoParticao) OR @@TRANCOUNT<>0
    THROW 54202, 'Rollback incompleto.', 1;
INSERT #testes VALUES(N'Falha no meio do lote reverte origem, publicação, cobertura e arquivo');
GO
CREATE PROCEDURE lab.Rodar @hoje date AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @dia date, @n int=0;
    WHILE 1=1
    BEGIN
        EXEC lab.LimparDia 'OCORRENCIAS',@hoje,@dia OUTPUT;
        IF @dia IS NULL BREAK;
        SET @n+=1;
        IF @n>500 THROW 54203, 'Rodada nao convergiu.', 1;
    END
    INSERT #rodadas
    SELECT @hoje,(SELECT primeiro_dia FROM lab.Corte('OCORRENCIAS',@hoje)),@n,
         (SELECT COUNT(*) FROM lab.ArquivoOrigem o JOIN lab.ArquivoParticao p ON p.id=o.particao
          WHERE p.rodada=@hoje AND p.entidade='OCORRENCIAS'),
         (SELECT COUNT(*) FROM lab.Origem o JOIN lab.Particao p ON p.id=o.particao WHERE p.entidade='OCORRENCIAS');
END;
GO
EXEC lab.Rodar '20261125';
DECLARE @novas lab.Linhas;
INSERT @novas VALUES (1,3),(2,3),(3,3);
EXEC lab.Receber 94,'OCORRENCIAS','20261126','20261126',@novas;
EXEC lab.Rodar '20261126';
INSERT @novas VALUES (4,3);
EXEC lab.Receber 95,'OCORRENCIAS','20261127','20261127',@novas;
EXEC lab.Rodar '20261127';
IF EXISTS (
  SELECT * FROM (VALUES(CONVERT(date,'20261125'),CONVERT(date,'20260828'),4,10),
                       (CONVERT(date,'20261126'),CONVERT(date,'20260829'),1,1),
                       (CONVERT(date,'20261127'),CONVERT(date,'20260830'),1,2)) esperado(d,c,n,q)
  EXCEPT SELECT hoje,primeiroDia,diasApagados,registrosApagados FROM #rodadas)
    OR (SELECT COUNT(*) FROM lab.Particao WHERE entidade='OCORRENCIAS')<>90
    OR (SELECT COUNT(*) FROM lab.Origem WHERE particao IN(94,95))<>7
    THROW 54204, 'Virada da janela de 90 dias incorreta.', 1;
INSERT #testes VALUES(N'25, 26 e 27 de novembro com 90 dias inclusivos e volumes diários diferentes');
DECLARE @dia date;
EXEC lab.LimparDia 'OCORRENCIAS','20261127',@dia OUTPUT;
IF @dia IS NOT NULL OR (SELECT COUNT(*) FROM lab.ArquivoParticao)<>6 THROW 54205, 'Rodada repetiu exclusao.', 1;
INSERT #testes VALUES(N'Repetição da rodada sem exclusões duplicadas');

IF EXISTS (SELECT * FROM #originais WHERE particao>=1000 EXCEPT SELECT * FROM lab.Origem WHERE particao>=1000)
   OR EXISTS (SELECT * FROM lab.Origem WHERE particao>=1000 EXCEPT SELECT * FROM #originais WHERE particao>=1000)
   OR EXISTS (SELECT * FROM #publicados WHERE particao>=1000 EXCEPT SELECT * FROM lab.Publicacao WHERE particao>=1000)
   OR EXISTS (SELECT * FROM #cobertas WHERE particao>=1000 EXCEPT SELECT * FROM lab.Cobertura WHERE particao>=1000)
   OR EXISTS (SELECT * FROM #particoes WHERE id>=1000 EXCEPT SELECT id,entidade,dia,recebida FROM lab.Particao WHERE id>=1000)
   OR EXISTS (SELECT 1 FROM lab.ArquivoParticao WHERE entidade<>'OCORRENCIAS')
    THROW 54206, 'Outra entidade foi alterada.', 1;
INSERT #testes VALUES(N'Fretes de leitura, coletas e performance preservados');

-- Reconstrói a fila original num destino separado, inclusive chaves, ordens e projeções.
SELECT id,entidade,dia,recebida INTO #restauradas FROM lab.ArquivoParticao;
SELECT * INTO #restOrigem FROM lab.ArquivoOrigem;
SELECT * INTO #restPublicada FROM lab.ArquivoPublicacao;
SELECT * INTO #restCobertura FROM lab.ArquivoCobertura;
IF EXISTS (SELECT * FROM #particoes WHERE id<6 EXCEPT SELECT * FROM #restauradas)
   OR EXISTS (SELECT * FROM #restauradas EXCEPT SELECT * FROM #particoes WHERE id<6)
   OR EXISTS (SELECT * FROM #originais WHERE particao<6 EXCEPT SELECT * FROM #restOrigem)
   OR EXISTS (SELECT * FROM #restOrigem EXCEPT SELECT * FROM #originais WHERE particao<6)
   OR EXISTS (SELECT * FROM #publicados WHERE particao<6 EXCEPT SELECT * FROM #restPublicada)
   OR EXISTS (SELECT * FROM #restPublicada EXCEPT SELECT * FROM #publicados WHERE particao<6)
   OR EXISTS (SELECT * FROM #cobertas WHERE particao<6 EXCEPT SELECT * FROM #restCobertura)
   OR EXISTS (SELECT * FROM #restCobertura EXCEPT SELECT * FROM #cobertas WHERE particao<6)
    THROW 54207, 'Restauracao logica divergiu.', 1;
INSERT #testes VALUES(N'Reconstrução em tabelas separadas, com ordem e valores duplicados');

UPDATE lab.Entidade SET dias=30 WHERE nome='OCORRENCIAS';
IF (SELECT primeiro_dia FROM lab.Corte('OCORRENCIAS','20261125'))<>'20261027'
    OR (SELECT MIN(dia) FROM lab.Previa('OCORRENCIAS','20261127'))<>'20260830'
    THROW 54208, 'Prazo de 30 dias incorreto.', 1;
-- Protege a data inteira, mesmo com uma segunda captura não protegida.
UPDATE lab.Particao SET protegida=1 WHERE id=6;
INSERT lab.Particao(id,entidade,dia,recebida) VALUES (4006,'OCORRENCIAS','20260830','20261101');
INSERT lab.Referencia VALUES (7);
EXEC lab.LimparDia 'OCORRENCIAS','20261127',@dia OUTPUT;
IF @dia IS NULL OR @dia<>'20260901' OR (SELECT COUNT(*) FROM lab.Particao WHERE id IN (6,4006,7))<>3
    THROW 54209, 'Data protegida ou vinculada entrou no lote.', 1;
INSERT #testes VALUES(N'Prazo de 30 dias, data protegida e referência de outro consumidor');

UPDATE lab.Entidade SET dias=120 WHERE nome='OCORRENCIAS';
IF EXISTS (SELECT 1 FROM lab.Previa('OCORRENCIAS','20261127')) THROW 54210, 'Ampliar o prazo nao deveria remover.', 1;
BEGIN TRY
    EXEC lab.Receber 91,'OCORRENCIAS','20261123','20261127',@novas;
    THROW 54219,'Uma captura imutavel mudou sem aviso.',1;
END TRY
BEGIN CATCH
    IF ERROR_NUMBER()<>54004 THROW;
END CATCH;
EXEC lab.Receber 4500,'OCORRENCIAS','20260828','20261127',@novas; -- partição já retirada
EXEC lab.Receber 4500,'OCORRENCIAS','20260828','20261127',@novas;
EXEC lab.Receber 4501,'OCORRENCIAS','20260701','20261127',@novas; -- fora da janela atual
EXEC lab.Receber 4502,'OCORRENCIAS',NULL,'20261127',@novas;
EXEC lab.Receber 4503,'OCORRENCIAS','20261129','20261127',@novas;
IF EXISTS(SELECT 1 FROM lab.Cobertura WHERE particao>=4500)
    OR EXISTS(SELECT 1 FROM lab.Particao WHERE entidade='OCORRENCIAS' AND dia='20260828')
    OR (SELECT COUNT(*) FROM lab.Revisao WHERE id>=4500)<>4
    OR (SELECT COUNT(*) FROM lab.RevisaoLinha WHERE particao>=4500)<>16
    THROW 54211, 'Carga anomala perdeu conteudo ou reabriu o passado.', 1;
INSERT #testes VALUES(N'Carga atrasada, dia já apagado, data ausente ou futura e repetição');
EXEC lab.Receber 4504,'OCORRENCIAS','20261120','20261127',@novas;
IF (SELECT COUNT(*) FROM lab.Publicacao WHERE particao=4504)<>4
    THROW 54220,'Carga tardia dentro da janela deixou de ser publicada.',1;
INSERT #testes VALUES(N'Correção tardia dentro do período e rejeição de captura conflitante');

UPDATE lab.Padrao SET dias=7 WHERE id=1;
IF (SELECT primeiro_dia FROM lab.Corte('FRETES_LEITURA','20261125'))<>'20261119'
    OR (SELECT primeiro_dia FROM lab.Corte('OCORRENCIAS','20261125'))<>'20260729'
    OR EXISTS(SELECT 1 FROM lab.Previa('COLETAS','20261125'))
    THROW 54212, 'Precedencia de politicas incorreta.', 1;
UPDATE lab.Padrao SET dias=NULL;
INSERT #testes VALUES(N'Padrão do banco, prazo próprio e entidade sem limpeza');

UPDATE lab.Entidade SET modo='propria',dias=30 WHERE nome='PERFORMANCE';
WHILE 1=1
BEGIN
    EXEC lab.LimparDia 'PERFORMANCE','20261125',@dia OUTPUT;
    IF @dia IS NULL BREAK;
END;
IF (SELECT MIN(dia) FROM lab.Particao WHERE entidade='PERFORMANCE')<>'20261027'
   OR (SELECT COUNT(*) FROM lab.Particao WHERE entidade='PERFORMANCE')<>30
    THROW 54221,'A rodada de 30 dias usou datas erradas.',1;
EXEC lab.LimparDia 'PERFORMANCE','20261126',@dia OUTPUT;
IF @dia IS NULL OR @dia<>'20261027' OR (SELECT COUNT(*) FROM lab.Particao WHERE entidade='PERFORMANCE')<>29
   OR (SELECT COUNT(*) FROM lab.Particao WHERE entidade='COLETAS')<>94
    THROW 54222,'Janela sem entrada ou isolamento incorreto.',1;
INSERT #testes VALUES(N'Outra entidade com 30 dias e virada de dia mesmo sem chegada de registros');

UPDATE lab.Entidade SET dias=1 WHERE nome='OCORRENCIAS';
IF (SELECT primeiro_dia FROM lab.Corte('OCORRENCIAS','20261125'))<>'20261125'
    THROW 54213, 'Janela de um dia incorreta.', 1;
UPDATE lab.Entidade SET dias=2 WHERE nome='OCORRENCIAS';
IF (SELECT primeiro_dia FROM lab.Corte('OCORRENCIAS','20240301'))<>'20240229'
    OR (SELECT primeiro_dia FROM lab.Corte('OCORRENCIAS','20270101'))<>'20261231'
    THROW 54214, 'Virada de calendario incorreta.', 1;
IF CONVERT(date,CAST('2026-11-26T02:59:59+00:00' AS datetimeoffset) AT TIME ZONE 'E. South America Standard Time')<>'20261125'
    OR CONVERT(date,CAST('2026-11-26T03:00:00+00:00' AS datetimeoffset) AT TIME ZONE 'E. South America Standard Time')<>'20261126'
    THROW 54215, 'Fronteira da meia-noite em Brasilia incorreta.',1;
INSERT #testes VALUES(N'Um dia, virada do ano, ano bissexto e meia-noite de Brasília');
BEGIN TRY
    UPDATE lab.Entidade SET dias=0 WHERE nome='OCORRENCIAS';
    THROW 54216,'Aceitou prazo zero.',1;
END TRY
BEGIN CATCH
    IF ERROR_NUMBER()<>547 THROW;
END CATCH;
UPDATE lab.Entidade SET dias=2147483647 WHERE nome='OCORRENCIAS';
IF (SELECT primeiro_dia FROM lab.Corte('OCORRENCIAS','20261125'))<>'00010101'
    THROW 54217,'Prazo longo truncou o calendario.',1;
INSERT #testes VALUES(N'Validação de prazo zero e prazo longo');

IF EXISTS (SELECT p.particao,p.ordem,p.valor FROM lab.Publicacao p
           EXCEPT SELECT o.particao,o.ordem,o.valor*2 FROM lab.Origem o JOIN lab.Cobertura c ON c.particao=o.particao)
   OR EXISTS (SELECT o.particao,o.ordem,o.valor*2 FROM lab.Origem o JOIN lab.Cobertura c ON c.particao=o.particao
              EXCEPT SELECT * FROM lab.Publicacao)
   OR EXISTS (SELECT id FROM lab.ArquivoParticao INTERSECT SELECT particao FROM lab.Cobertura)
    THROW 54218,'Projecao inconsistente ou cobertura aponta para o passado retirado.',1;
INSERT #testes VALUES(N'Projeção e cobertura concordam com a origem vigente');
