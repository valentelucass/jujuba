use super::{Client, OtherSession};
use crate::{
    error::{AppError, Result},
    models::{
        Column, ColumnPair, DatabaseDiagram, Engine, Index, IndexColumn, RecordsInput, RecordsPage,
        Relationship, Structure, Table,
    },
};
use std::collections::HashMap;

#[derive(Default)]
pub(super) struct TableIds {
    entries: Vec<Table>,
    by_name: HashMap<(String, String), i32>,
}

type Row = Vec<Option<String>>;

const MYSQL_TABLES: &str = "SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME";
const PG_TABLES: &str = "SELECT n.nspname::text, c.relname::text FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p','f') AND left(n.nspname, 3) <> 'pg_'
    AND n.nspname <> 'information_schema' AND has_schema_privilege(n.oid, 'USAGE')
    AND (has_table_privilege(c.oid, 'SELECT') OR has_any_column_privilege(c.oid, 'SELECT'))
    ORDER BY n.nspname, c.relname";
const SQLITE_TABLES: &str = "SELECT 'main', name FROM main.sqlite_schema
    WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name";

const MYSQL_COLUMNS: &str = "SELECT COLUMN_NAME, COLUMN_TYPE,
    CASE WHEN IS_NULLABLE = 'YES' THEN '1' ELSE '0' END,
    CASE WHEN COLUMN_KEY = 'PRI' THEN '1' ELSE '0' END,
    CASE WHEN EXTRA LIKE '%auto_increment%' THEN '1' ELSE '0' END,
    CASE WHEN COALESCE(GENERATION_EXPRESSION, '') <> '' THEN '1' ELSE '0' END
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION";
const PG_COLUMNS: &str = "SELECT a.attname::text, pg_catalog.format_type(a.atttypid,a.atttypmod),
    CASE WHEN a.attnotnull THEN '0' ELSE '1' END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_constraint p
        WHERE p.conrelid = c.oid AND p.contype = 'p' AND a.attnum = ANY(p.conkey)) THEN '1' ELSE '0' END,
    CASE WHEN a.attidentity <> '' THEN '1' ELSE '0' END,
    CASE WHEN a.attgenerated <> '' THEN '1' ELSE '0' END
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
    AND has_column_privilege(c.oid, a.attnum, 'SELECT') ORDER BY a.attnum";
const SQLITE_COLUMNS: &str = "SELECT name, COALESCE(NULLIF(type, ''), 'ANY'),
    CASE WHEN \"notnull\" = 0 AND NOT (pk = 1 AND upper(type) = 'INTEGER') THEN '1' ELSE '0' END,
    CASE WHEN pk > 0 THEN '1' ELSE '0' END, '0',
    CASE WHEN hidden IN (2,3) THEN '1' ELSE '0' END
    FROM pragma_table_xinfo(?, 'main') WHERE hidden <> 1 ORDER BY cid";

const MYSQL_INDEXES: &str = "SELECT INDEX_NAME, INDEX_TYPE,
    CASE WHEN NON_UNIQUE = 0 THEN '1' ELSE '0' END,
    CASE WHEN INDEX_NAME = 'PRIMARY' THEN '1' ELSE '0' END, NULL,
    COALESCE(COLUMN_NAME, '(expressão)'), CASE WHEN COLLATION = 'D' THEN '1' ELSE '0' END, '0'
    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY INDEX_NAME, SEQ_IN_INDEX";
const PG_INDEXES: &str = "SELECT idx.relname::text, am.amname::text,
    CASE WHEN i.indisunique THEN '1' ELSE '0' END,
    CASE WHEN i.indisprimary THEN '1' ELSE '0' END,
    pg_catalog.pg_get_expr(i.indpred, i.indrelid),
    COALESCE(a.attname::text, pg_catalog.pg_get_indexdef(i.indexrelid, k.ordinal::int, true)),
    CASE WHEN (i.indoption[(k.ordinal - 1)::int] & 1) = 1 THEN '1' ELSE '0' END,
    CASE WHEN k.ordinal > i.indnkeyatts THEN '1' ELSE '0' END
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid JOIN pg_catalog.pg_am am ON am.oid = idx.relam
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinal)
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
    WHERE n.nspname = $1 AND c.relname = $2 AND i.indisvalid ORDER BY idx.relname, k.ordinal";
const SQLITE_INDEXES: &str = "SELECT i.name, 'B-tree',
    CASE WHEN i.\"unique\" = 1 THEN '1' ELSE '0' END,
    CASE WHEN i.origin = 'pk' THEN '1' ELSE '0' END,
    CASE WHEN i.partial = 1 THEN '(índice parcial)' END,
    COALESCE(c.name, '(expressão)'), CASE WHEN c.desc = 1 THEN '1' ELSE '0' END, '0'
    FROM pragma_index_list(?, 'main') i JOIN pragma_index_xinfo(i.name, 'main') c
    WHERE c.key = 1 ORDER BY i.name, c.seqno";

const MYSQL_RELATIONS: &str = "SELECT TABLE_SCHEMA, TABLE_NAME, CONSTRAINT_NAME,
    REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, COLUMN_NAME, REFERENCED_COLUMN_NAME,
    CAST(ORDINAL_POSITION AS CHAR)
    FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ?
    AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_SCHEMA, TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION";
const PG_RELATIONS: &str = "SELECT sn.nspname::text, s.relname::text, fk.conname::text,
    tn.nspname::text, t.relname::text, sc.attname::text, tc.attname::text, k.ordinal::text
    FROM pg_catalog.pg_constraint fk JOIN pg_catalog.pg_class s ON s.oid = fk.conrelid
    JOIN pg_catalog.pg_class t ON t.oid = fk.confrelid
    JOIN pg_catalog.pg_namespace sn ON sn.oid = s.relnamespace
    JOIN pg_catalog.pg_namespace tn ON tn.oid = t.relnamespace
    CROSS JOIN LATERAL unnest(fk.conkey, fk.confkey) WITH ORDINALITY AS k(src, dst, ordinal)
    JOIN pg_catalog.pg_attribute sc ON sc.attrelid = s.oid AND sc.attnum = k.src
    JOIN pg_catalog.pg_attribute tc ON tc.attrelid = t.oid AND tc.attnum = k.dst
    WHERE fk.contype = 'f' ORDER BY sn.nspname, s.relname, fk.conname, k.ordinal";
const SQLITE_RELATIONS: &str = "SELECT 'main', s.name, 'FK ' || (f.id + 1),
    'main', t.name, f.\"from\", COALESCE(f.\"to\", p.name), CAST(f.seq + 1 AS TEXT)
    FROM main.sqlite_schema s JOIN pragma_foreign_key_list(s.name, 'main') f
    JOIN main.sqlite_schema t ON t.name = f.\"table\" COLLATE NOCASE AND t.type = 'table'
    LEFT JOIN pragma_table_info(t.name, 'main') p ON p.pk = f.seq + 1 AND f.\"to\" IS NULL
    WHERE s.type = 'table' AND s.name NOT GLOB 'sqlite_*' ORDER BY s.name, f.id, f.seq";

fn catalog_changed() -> AppError {
    AppError::new(
        "catalog",
        "O objeto mudou ou foi removido. Atualize o explorador.",
    )
}

fn input_error() -> AppError {
    AppError::new("input", "Confira a coluna, o filtro ou a página informada.")
}

fn value(row: &Row, index: usize) -> Result<&str> {
    row.get(index)
        .and_then(Option::as_deref)
        .ok_or_else(catalog_changed)
}

impl OtherSession {
    pub async fn schemas(&self, database: &str) -> Result<Vec<String>> {
        let tables = self.tables(database, None).await?;
        let mut schemas: Vec<String> = tables.into_iter().map(|table| table.schema).collect();
        schemas.sort_unstable();
        schemas.dedup();
        Ok(schemas)
    }

    pub async fn tables(&self, database: &str, schema: Option<&str>) -> Result<Vec<Table>> {
        let client = self.client(database).await?;
        let rows = match &client {
            Client::Mysql(_) => client.text_rows(MYSQL_TABLES, &[database]).await?,
            Client::Postgres(_) => client.text_rows(PG_TABLES, &[]).await?,
            Client::Sqlite(_) => client.text_rows(SQLITE_TABLES, &[]).await?,
        };

        let mut ids = self.ids.write().await;
        let ids = ids.entry(database.to_owned()).or_default();
        let mut tables = Vec::new();
        for row in rows {
            let name = (value(&row, 0)?.to_owned(), value(&row, 1)?.to_owned());
            if schema.is_some_and(|schema| schema != name.0) {
                continue;
            }
            let index = match ids.by_name.get(&name) {
                Some(&index) => index,
                None => {
                    let index = i32::try_from(ids.entries.len()).map_err(|_| catalog_changed())?;
                    ids.entries.push(Table {
                        id: index + 1,
                        schema: name.0.clone(),
                        name: name.1.clone(),
                    });
                    ids.by_name.insert(name, index);
                    index
                }
            };
            tables.push(ids.entries[index as usize].clone());
        }
        Ok(tables)
    }

    async fn table(&self, database: &str, id: i32) -> Result<Table> {
        let index = id.checked_sub(1).ok_or_else(catalog_changed)? as usize;
        self.ids
            .read()
            .await
            .get(database)
            .and_then(|ids| ids.entries.get(index))
            .cloned()
            .ok_or_else(catalog_changed)
    }

    pub async fn structure(&self, database: &str, id: i32) -> Result<Structure> {
        let table = self.table(database, id).await?;
        let client = self.client(database).await?;
        let columns = client.columns(&table).await?;
        let raw_indexes = client
            .table_metadata(&table, MYSQL_INDEXES, PG_INDEXES, SQLITE_INDEXES)
            .await?;
        let mut indexes: Vec<Index> = Vec::new();
        for row in raw_indexes {
            let name = value(&row, 0)?;
            if indexes.last().is_none_or(|index| index.name != name) {
                let filter = row[4].clone();
                indexes.push(Index {
                    name: name.into(),
                    kind: value(&row, 1)?.into(),
                    unique: value(&row, 2)? == "1",
                    primary: value(&row, 3)? == "1",
                    disabled: false,
                    filtered: filter.is_some(),
                    filter,
                    columns: Vec::new(),
                });
            }
            if let Some(index) = indexes.last_mut() {
                index.columns.push(IndexColumn {
                    name: value(&row, 5)?.into(),
                    descending: value(&row, 6)? == "1",
                    included: value(&row, 7)? == "1",
                });
            }
        }
        Ok(Structure {
            table,
            columns,
            indexes,
        })
    }

    pub async fn records(&self, database: &str, input: RecordsInput) -> Result<RecordsPage> {
        let table = self.table(database, input.table.table_id).await?;
        let client = self.client(database).await?;
        let columns = client.columns(&table).await?;
        let offset = u64::from(input.page) * u64::from(input.page_size);
        if !matches!(input.page_size, 25 | 50 | 100) || offset > 1_000_000_000 {
            return Err(input_error());
        }

        let mut order = Vec::new();
        if let Some(sort) = &input.sort {
            let column = columns
                .iter()
                .find(|column| column.id == sort.column_id && column.sortable)
                .ok_or_else(input_error)?;
            let direction = if sort.descending { " DESC" } else { " ASC" };
            order.push(format!("{}{direction}", client.quote(&column.name)));
        }
        let mut stable_order = false;
        for column in columns.iter().filter(|column| column.primary_key) {
            stable_order = true;
            if !input
                .sort
                .as_ref()
                .is_some_and(|sort| sort.column_id == column.id)
            {
                order.push(client.quote(&column.name));
            }
        }
        let order = if order.is_empty() {
            String::new()
        } else {
            format!(" ORDER BY {}", order.join(", "))
        };
        let select = columns
            .iter()
            .map(|column| client.projection(column))
            .collect::<Vec<_>>()
            .join(", ");
        let qualified = format!(
            "{}.{}",
            client.quote(&table.schema),
            client.quote(&table.name)
        );
        let mut params = Vec::new();
        let predicate = if let Some(filter) = &input.filter {
            let column = columns
                .iter()
                .find(|column| column.id == filter.column_id)
                .filter(|column| column.filterable)
                .ok_or_else(input_error)?;
            if filter.text.chars().count() > 200 || filter.text.contains('\0') {
                return Err(input_error());
            }
            params.push(filter.text.as_str());
            let name = client.quote(&column.name);
            match &client {
                Client::Mysql(_) => format!(" WHERE LOCATE(?, CAST({name} AS CHAR)) > 0"),
                Client::Postgres(_) => format!(" WHERE strpos(CAST({name} AS TEXT), $1) > 0"),
                Client::Sqlite(_) => format!(" WHERE instr(CAST({name} AS TEXT), ?) > 0"),
            }
        } else {
            String::new()
        };
        let limit = input.page_size + 1;
        let mut rows = client
            .text_rows(
                &format!(
                    "SELECT {select} FROM {qualified}{predicate}{order}
            LIMIT {limit} OFFSET {offset}"
                ),
                &params,
            )
            .await?;
        let has_next = rows.len() > input.page_size as usize;
        rows.truncate(input.page_size as usize);
        Ok(RecordsPage {
            rows,
            columns,
            page: input.page,
            page_size: input.page_size,
            has_next,
            stable_order,
        })
    }

    pub async fn diagram(&self, database: &str) -> Result<DatabaseDiagram> {
        let tables = self.tables(database, None).await?;
        let by_name: HashMap<_, _> = tables
            .iter()
            .map(|table| ((table.schema.as_str(), table.name.as_str()), table))
            .collect();
        let client = self.client(database).await?;
        let rows = match &client {
            Client::Mysql(_) => client.text_rows(MYSQL_RELATIONS, &[database]).await?,
            Client::Postgres(_) => client.text_rows(PG_RELATIONS, &[]).await?,
            Client::Sqlite(_) => client.text_rows(SQLITE_RELATIONS, &[]).await?,
        };
        let mut relationships: Vec<Relationship> = Vec::new();
        for row in rows {
            let source = by_name.get(&(value(&row, 0)?, value(&row, 1)?)).copied();
            let target = by_name.get(&(value(&row, 3)?, value(&row, 4)?)).copied();
            let (Some(source), Some(target), Some(target_column)) =
                (source, target, row[6].as_deref())
            else {
                continue;
            };
            let name = value(&row, 2)?;
            if relationships.last().is_none_or(|rel| {
                rel.source.id != source.id || rel.target.id != target.id || rel.name != name
            }) {
                relationships.push(Relationship {
                    id: i32::try_from(relationships.len() + 1).map_err(|_| catalog_changed())?,
                    name: name.into(), source: source.clone(), target: target.clone(), columns: Vec::new(),
                    target_per_source: None, source_per_target: None,
                    unknown_reason: Some("O diagrama mostra a chave estrangeira declarada. Cardinalidade indeterminada."),
                });
            }
            if let Some(relation) = relationships.last_mut() {
                relation.columns.push(ColumnPair {
                    source: value(&row, 5)?.into(),
                    target: target_column.into(),
                    ordinal: value(&row, 7)?.parse().map_err(|_| catalog_changed())?,
                });
            }
        }
        Ok(DatabaseDiagram {
            tables,
            relationships,
        })
    }

    pub async fn relationships(&self, database: &str, id: i32) -> Result<Vec<Relationship>> {
        self.table(database, id).await?;
        Ok(self
            .diagram(database)
            .await?
            .relationships
            .into_iter()
            .filter(|relation| relation.source.id == id || relation.target.id == id)
            .collect())
    }
}

impl Client {
    async fn table_metadata(
        &self,
        table: &Table,
        mysql: &str,
        postgres: &str,
        sqlite: &str,
    ) -> Result<Vec<Row>> {
        match self {
            Self::Mysql(_) => self.text_rows(mysql, &[&table.schema, &table.name]).await,
            Self::Postgres(_) => {
                self.text_rows(postgres, &[&table.schema, &table.name])
                    .await
            }
            Self::Sqlite(_) => self.text_rows(sqlite, &[&table.name]).await,
        }
    }

    async fn columns(&self, table: &Table) -> Result<Vec<Column>> {
        let rows = self
            .table_metadata(table, MYSQL_COLUMNS, PG_COLUMNS, SQLITE_COLUMNS)
            .await?;
        if rows.is_empty() {
            return Err(catalog_changed());
        }
        rows.into_iter()
            .enumerate()
            .map(|(index, row)| {
                let data_type = value(&row, 1)?.to_owned();
                let normalized = data_type.to_ascii_lowercase();
                let binary = [
                    "blob",
                    "binary",
                    "geometry",
                    "bit",
                    "point",
                    "linestring",
                    "polygon",
                ]
                .iter()
                .any(|name| normalized.contains(name));
                let sortable = match self {
                    Self::Postgres(_) => {
                        normalized != "json"
                            && !matches!(
                                normalized.as_str(),
                                "xml"
                                    | "point"
                                    | "polygon"
                                    | "line"
                                    | "lseg"
                                    | "circle"
                                    | "box"
                                    | "path"
                            )
                    }
                    Self::Mysql(_) => !binary,
                    Self::Sqlite(_) => true,
                };
                Ok(Column {
                    id: index as i32 + 1,
                    name: value(&row, 0)?.into(),
                    data_type,
                    nullable: value(&row, 2)? == "1",
                    primary_key: value(&row, 3)? == "1",
                    identity: value(&row, 4)? == "1",
                    computed: value(&row, 5)? == "1",
                    sortable,
                    filterable: !binary,
                    editable: false,
                    editable_key: false,
                    system_type: 0,
                })
            })
            .collect()
    }

    fn quote(&self, id: &str) -> String {
        let delimiter = if self.engine() == Engine::Mysql {
            '`'
        } else {
            '"'
        };
        format!(
            "{delimiter}{}{delimiter}",
            id.replace(delimiter, &format!("{delimiter}{delimiter}"))
        )
    }

    fn projection(&self, column: &Column) -> String {
        let name = self.quote(&column.name);
        match self {
            Self::Mysql(_) if !column.filterable =>
                format!("CASE WHEN {name} IS NOT NULL THEN CONCAT('0x', HEX(LEFT({name}, 1023))) END"),
            Self::Mysql(_) => format!("LEFT(CAST({name} AS CHAR), 2048)"),
            Self::Postgres(_) => format!("LEFT(CAST({name} AS TEXT), 2048)"),
            Self::Sqlite(_) => format!("CASE WHEN typeof({name}) = 'blob'
                THEN '0x' || hex(substr({name}, 1, 1023)) ELSE substr(CAST({name} AS TEXT), 1, 2048) END"),
        }
    }
}
