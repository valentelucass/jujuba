IF ISNULL(CONVERT(int, SERVERPROPERTY('IsLocalDB')),0) <> 1 OR DB_NAME() <> N'JujubaRetencaoLab'
    THROW 54000, 'Este ensaio exige o banco descartavel do LocalDB.', 1;
GO
CREATE SCHEMA lab;
GO
CREATE TABLE lab.Padrao (
    id int PRIMARY KEY CHECK (id=1), dias int NULL CHECK (dias > 0)
);
INSERT lab.Padrao VALUES (1,NULL);
CREATE TABLE lab.Entidade (
    nome varchar(32) PRIMARY KEY,
    modo varchar(10) NOT NULL CHECK (modo IN ('propria','herdar','conservar')),
    dias int NULL,
    CHECK ((modo='propria' AND dias IS NOT NULL AND dias>0) OR (modo<>'propria' AND dias IS NULL))
);
INSERT lab.Entidade VALUES
    ('OCORRENCIAS','propria',90), ('FRETES_LEITURA','herdar',NULL),
    ('COLETAS','conservar',NULL), ('PERFORMANCE','herdar',NULL);

-- As chaves de cada camada são sintéticas. A ordem preserva até linhas de conteúdo idêntico.
CREATE TABLE lab.Particao (
    id int PRIMARY KEY, entidade varchar(32) NOT NULL REFERENCES lab.Entidade(nome),
    dia date NULL, recebida date NOT NULL, protegida bit NOT NULL DEFAULT 0
);
CREATE INDEX IX_particao_dia ON lab.Particao(entidade,dia,id) INCLUDE(protegida);
CREATE TABLE lab.Origem (
    particao int REFERENCES lab.Particao(id), ordem int, valor int NOT NULL,
    PRIMARY KEY(particao,ordem)
);
CREATE TABLE lab.Publicacao (
    particao int, ordem int, valor int NOT NULL, PRIMARY KEY(particao,ordem),
    FOREIGN KEY(particao,ordem) REFERENCES lab.Origem(particao,ordem)
);
CREATE TABLE lab.Cobertura (particao int PRIMARY KEY REFERENCES lab.Particao(id));
CREATE TABLE lab.Referencia (particao int PRIMARY KEY REFERENCES lab.Particao(id));
CREATE TABLE lab.ArquivoParticao (
    id int PRIMARY KEY, entidade varchar(32) NOT NULL, dia date NOT NULL, recebida date NOT NULL,
    rodada date NOT NULL
);
CREATE INDEX IX_historico_dia ON lab.ArquivoParticao(entidade,dia);
CREATE TABLE lab.ArquivoOrigem (
    particao int REFERENCES lab.ArquivoParticao(id), ordem int, valor int NOT NULL,
    PRIMARY KEY(particao,ordem)
);
CREATE TABLE lab.ArquivoPublicacao (
    particao int REFERENCES lab.ArquivoParticao(id), ordem int, valor int NOT NULL,
    PRIMARY KEY(particao,ordem)
);
CREATE TABLE lab.ArquivoCobertura (particao int PRIMARY KEY REFERENCES lab.ArquivoParticao(id));
CREATE TABLE lab.Revisao (
    id int PRIMARY KEY, entidade varchar(32) NOT NULL REFERENCES lab.Entidade(nome),
    dia date NULL, recebida date NOT NULL, motivo varchar(30) NOT NULL
);
CREATE TABLE lab.RevisaoLinha (
    particao int REFERENCES lab.Revisao(id), ordem int, valor int NOT NULL, PRIMARY KEY(particao,ordem)
);
GO
CREATE FUNCTION lab.Corte(@entidade varchar(32), @hoje date)
RETURNS TABLE AS RETURN
    SELECT CASE WHEN d.dias IS NULL THEN NULL
                WHEN d.dias > 1 + DATEDIFF(day,CONVERT(date,'00010101'),@hoje) THEN CONVERT(date,'00010101')
                ELSE DATEADD(day,1-d.dias,@hoje) END AS primeiro_dia
    FROM lab.Entidade e CROSS JOIN lab.Padrao banco
    CROSS APPLY (VALUES(CASE e.modo WHEN 'propria' THEN e.dias WHEN 'herdar' THEN banco.dias END)) d(dias)
    WHERE e.nome=@entidade;
GO
CREATE FUNCTION lab.Previa(@entidade varchar(32), @hoje date)
RETURNS TABLE AS RETURN
    SELECT p.dia, COUNT_BIG(*) AS particoes
    FROM lab.Particao p CROSS APPLY lab.Corte(@entidade,@hoje) c
    LEFT JOIN lab.Referencia r ON r.particao=p.id
    WHERE p.entidade=@entidade AND p.dia<c.primeiro_dia
    GROUP BY p.dia
    HAVING MAX(CASE WHEN p.protegida=1 OR r.particao IS NOT NULL THEN 1 ELSE 0 END)=0;
GO
CREATE PROCEDURE lab.Travar @entidade varchar(32) AS
BEGIN
    DECLARE @chave nvarchar(255), @resultado int;
    SELECT @chave=N'jujuba-lab-retencao/'+nome FROM lab.Entidade WHERE nome=@entidade;
    IF @chave IS NULL THROW 54005, 'Entidade fora do catalogo.', 1;
    EXEC @resultado=sys.sp_getapplock @Resource=@chave, @LockMode='Exclusive',
         @LockOwner='Transaction', @LockTimeout=0;
    IF @resultado<0 THROW 54001, 'Entidade em uso; repetir a rodada.', 1;
END;
GO
-- Uma transação por data. O ensaio arquiva na mesma base descartável para conferir e reconstruir.
CREATE PROCEDURE lab.LimparDia @entidade varchar(32), @hoje date, @processado date OUTPUT,
                               @falhaDeTeste bit=0 AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        EXEC lab.Travar @entidade;
        SELECT @processado=MIN(dia) FROM lab.Previa(@entidade,@hoje);
        IF @processado IS NOT NULL
        BEGIN
            DECLARE @lote TABLE (id int PRIMARY KEY);
            INSERT @lote SELECT id FROM lab.Particao WITH (UPDLOCK,HOLDLOCK)
            WHERE entidade=@entidade AND dia=@processado;
            INSERT lab.ArquivoParticao SELECT p.id,p.entidade,p.dia,p.recebida,@hoje
                FROM lab.Particao p JOIN @lote b ON p.id=b.id;
            INSERT lab.ArquivoOrigem SELECT s.* FROM lab.Origem s JOIN @lote b ON s.particao=b.id;
            INSERT lab.ArquivoPublicacao SELECT s.* FROM lab.Publicacao s JOIN @lote b ON s.particao=b.id;
            INSERT lab.ArquivoCobertura SELECT s.* FROM lab.Cobertura s JOIN @lote b ON s.particao=b.id;
            IF EXISTS (SELECT s.* FROM lab.Origem s JOIN @lote b ON s.particao=b.id EXCEPT SELECT * FROM lab.ArquivoOrigem)
               OR EXISTS (SELECT s.* FROM lab.Publicacao s JOIN @lote b ON s.particao=b.id EXCEPT SELECT * FROM lab.ArquivoPublicacao)
               OR EXISTS (SELECT s.* FROM lab.Cobertura s JOIN @lote b ON s.particao=b.id EXCEPT SELECT * FROM lab.ArquivoCobertura)
               THROW 54002, 'A copia da data divergiu.', 1;
            DELETE s FROM lab.Publicacao s JOIN @lote b ON s.particao=b.id;
            DELETE s FROM lab.Cobertura s JOIN @lote b ON s.particao=b.id;
            IF @falhaDeTeste=1 THROW 54003, 'Falha injetada depois de retirar publicacao e cobertura.', 1;
            DELETE s FROM lab.Origem s JOIN @lote b ON s.particao=b.id;
            DELETE p FROM lab.Particao p JOIN @lote b ON p.id=b.id;
        END
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK;
        THROW;
    END CATCH
END;
GO
CREATE TYPE lab.Linhas AS TABLE (ordem int PRIMARY KEY, valor int NOT NULL);
GO
CREATE PROCEDURE lab.Receber @id int, @entidade varchar(32), @dia date, @recebida date, @linhas lab.Linhas READONLY AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        EXEC lab.Travar @entidade;
        IF EXISTS (SELECT 1 FROM lab.Revisao WHERE id=@id)
            OR EXISTS (SELECT 1 FROM lab.Particao WHERE id=@id)
            OR EXISTS (SELECT 1 FROM lab.ArquivoParticao WHERE id=@id)
        BEGIN
            DECLARE @anterior TABLE (ordem int PRIMARY KEY, valor int NOT NULL);
            INSERT @anterior SELECT ordem,valor FROM lab.Origem WHERE particao=@id
                UNION ALL SELECT ordem,valor FROM lab.ArquivoOrigem WHERE particao=@id
                UNION ALL SELECT ordem,valor FROM lab.RevisaoLinha WHERE particao=@id;
            IF EXISTS (SELECT entidade,dia FROM (
                  SELECT entidade,dia FROM lab.Particao WHERE id=@id UNION ALL
                  SELECT entidade,dia FROM lab.ArquivoParticao WHERE id=@id UNION ALL
                  SELECT entidade,dia FROM lab.Revisao WHERE id=@id) p
                  EXCEPT SELECT @entidade,@dia)
               OR EXISTS (SELECT * FROM @anterior EXCEPT SELECT * FROM @linhas)
               OR EXISTS (SELECT * FROM @linhas EXCEPT SELECT * FROM @anterior)
                THROW 54004, 'O mesmo identificador chegou com outro conteudo.', 1;
            COMMIT;
            RETURN;
        END
        DECLARE @motivo varchar(30);
        IF @dia IS NULL OR @dia>@recebida SET @motivo='data para revisar';
        ELSE IF @dia < (SELECT primeiro_dia FROM lab.Corte(@entidade,@recebida))
            OR EXISTS (SELECT 1 FROM lab.ArquivoParticao WHERE entidade=@entidade AND dia=@dia)
            SET @motivo='fora da janela';
        IF @motivo IS NOT NULL
        BEGIN
            INSERT lab.Revisao VALUES (@id,@entidade,@dia,@recebida,@motivo);
            INSERT lab.RevisaoLinha SELECT @id,ordem,valor FROM @linhas;
        END
        ELSE
        BEGIN
            INSERT lab.Particao(id,entidade,dia,recebida) VALUES (@id,@entidade,@dia,@recebida);
            INSERT lab.Origem SELECT @id,ordem,valor FROM @linhas;
            INSERT lab.Publicacao SELECT @id,ordem,valor*2 FROM @linhas;
            INSERT lab.Cobertura VALUES (@id);
        END
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK;
        THROW;
    END CATCH
END;
GO
