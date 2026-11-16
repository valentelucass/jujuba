use crate::{
    error::{AppError, Result},
    models::Engine,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, Bson, Document},
    options::ClientOptions,
    Client,
};
use redis::aio::ConnectionManager;
use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::HashSet, fmt::Write, time::Duration};
use zeroize::Zeroizing;

pub enum NoSqlSession {
    Mongo(Client),
    Redis(ConnectionManager),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentsPage {
    documents: Vec<DocumentPreview>,
    has_next: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentPreview {
    title: String,
    json: String,
    truncated: bool,
}

#[derive(Serialize)]
pub struct RedisKeys {
    keys: Vec<RedisKey>,
    next: Option<String>,
}

#[derive(Serialize)]
struct RedisKey {
    id: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisEntry {
    kind: String,
    ttl: i64,
    value: Value,
    truncated: bool,
}

const PAGE: u64 = 20;
const VALUE_LIMIT: usize = 4096;

impl NoSqlSession {
    pub async fn open(engine: Engine, uri: String) -> Result<(Self, String, Vec<String>)> {
        let uri = Zeroizing::new(uri);
        let uri = uri.trim();
        if uri.len() > 8192 || uri.is_empty() || uri.contains('\0') {
            return Err(invalid("Confira a URI de conexão."));
        }
        match engine {
            Engine::Mongodb => {
                if !(uri.starts_with("mongodb://") || uri.starts_with("mongodb+srv://")) {
                    return Err(invalid("Use uma URI mongodb:// ou mongodb+srv://."));
                }
                let mut options = ClientOptions::parse(uri)
                    .await
                    .map_err(|_| connection_error())?;
                options.server_selection_timeout = Some(Duration::from_secs(10));
                options.connect_timeout = Some(Duration::from_secs(8));
                let default_database = options.default_database.clone();
                let endpoint = options
                    .hosts
                    .first()
                    .map(ToString::to_string)
                    .unwrap_or_else(|| "MongoDB".into());
                let client = Client::with_options(options).map_err(|_| connection_error())?;
                client
                    .database("admin")
                    .run_command(doc! { "ping": 1 })
                    .await
                    .map_err(|_| connection_error())?;
                let mut databases = match client.list_database_names().await {
                    Ok(databases) => databases,
                    Err(_) => {
                        let database = default_database.ok_or_else(connection_error)?;
                        client
                            .database(&database)
                            .list_collection_names()
                            .await
                            .map_err(|_| connection_error())?;
                        vec![database]
                    }
                };
                databases.sort_unstable();
                Ok((Self::Mongo(client), endpoint, databases))
            }
            Engine::Redis => {
                if !(uri.starts_with("redis://") || uri.starts_with("rediss://")) {
                    return Err(invalid("Use uma URI redis:// ou rediss://."));
                }
                let client = redis::Client::open(uri).map_err(|_| connection_error())?;
                let info = client.get_connection_info();
                let endpoint = info.addr().to_string();
                let databases = vec![format!("db{}", info.redis_settings().db())];
                let mut manager = client
                    .get_connection_manager()
                    .await
                    .map_err(|_| connection_error())?;
                redis::cmd("PING")
                    .query_async::<String>(&mut manager)
                    .await
                    .map_err(|_| connection_error())?;
                Ok((Self::Redis(manager), endpoint, databases))
            }
            _ => Err(unsupported()),
        }
    }

    pub async fn collections(&self, database: &str) -> Result<Vec<String>> {
        let Self::Mongo(client) = self else {
            return Err(unsupported());
        };
        let mut names = client
            .database(database)
            .list_collection_names()
            .await
            .map_err(|_| read_error())?;
        names.sort_unstable();
        Ok(names)
    }

    pub async fn documents(
        &self,
        database: &str,
        collection: &str,
        filter: &str,
        page: u32,
    ) -> Result<DocumentsPage> {
        let Self::Mongo(client) = self else {
            return Err(unsupported());
        };
        if collection.is_empty() || collection.contains('\0') || page > 100_000 {
            return Err(invalid("Confira a coleção e a página informada."));
        }
        let filter = parse_filter(filter)?;
        let mut cursor = client
            .database(database)
            .collection::<Document>(collection)
            .find(filter)
            .sort(doc! { "_id": 1 })
            .skip(u64::from(page) * PAGE)
            .limit(PAGE as i64 + 1)
            .batch_size(5)
            .max_time(Duration::from_secs(12))
            .await
            .map_err(|_| read_error())?;
        let mut documents = Vec::new();
        let mut has_next = false;
        while let Some(document) = cursor.try_next().await.map_err(|_| read_error())? {
            if documents.len() == PAGE as usize {
                has_next = true;
                break;
            }
            let title = document
                .get("_id")
                .map(|id| id.to_string().chars().take(150).collect())
                .unwrap_or_else(|| {
                    format!(
                        "Documento {}",
                        u64::from(page) * PAGE + documents.len() as u64 + 1
                    )
                });
            let value = Bson::Document(document).into_relaxed_extjson();
            let mut json = serde_json::to_string_pretty(&value).map_err(|_| read_error())?;
            let truncated = json.len() > 16_384;
            if truncated {
                json.truncate(json.floor_char_boundary(16_384));
            }
            documents.push(DocumentPreview {
                title,
                json,
                truncated,
            });
        }
        Ok(DocumentsPage {
            documents,
            has_next,
        })
    }

    pub async fn redis_keys(&self, cursor: &str, pattern: &str) -> Result<RedisKeys> {
        let Self::Redis(manager) = self else {
            return Err(unsupported());
        };
        let cursor: u64 = cursor
            .parse()
            .map_err(|_| invalid("A posição da busca é inválida."))?;
        if pattern.len() > 512 {
            return Err(invalid("O padrão da busca excede 512 bytes."));
        }
        let pattern = if pattern.is_empty() { "*" } else { pattern };
        let mut connection = manager.clone();
        let (next, keys): (u64, Vec<Vec<u8>>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("MATCH")
            .arg(pattern)
            .arg("COUNT")
            .arg(75)
            .query_async(&mut connection)
            .await
            .map_err(|_| read_error())?;
        let mut seen = HashSet::new();
        let keys = keys
            .into_iter()
            .filter_map(|key| {
                let id = STANDARD.encode(&key);
                if !seen.insert(id.clone()) {
                    return None;
                }
                let name = if key.is_empty() {
                    "(chave vazia)".into()
                } else {
                    preview(&key, 256)
                };
                Some(RedisKey { id, name })
            })
            .collect();
        Ok(RedisKeys {
            keys,
            next: (next != 0).then(|| next.to_string()),
        })
    }

    pub async fn redis_entry(&self, id: &str) -> Result<RedisEntry> {
        let Self::Redis(manager) = self else {
            return Err(unsupported());
        };
        let key = STANDARD
            .decode(id)
            .map_err(|_| invalid("A chave informada é inválida."))?;
        let mut connection = manager.clone();
        let (kind, ttl): (String, i64) = redis::pipe()
            .cmd("TYPE")
            .arg(&key)
            .cmd("TTL")
            .arg(&key)
            .query_async(&mut connection)
            .await
            .map_err(|_| read_error())?;
        if ttl == -2 {
            return Ok(RedisEntry {
                kind: "none".into(),
                ttl,
                value: Value::Null,
                truncated: false,
            });
        }
        let (value, truncated) = redis_value(&mut connection, &key, &kind)
            .await
            .map_err(|_| read_error())?;
        Ok(RedisEntry {
            kind,
            ttl,
            value,
            truncated,
        })
    }
}

fn parse_filter(filter: &str) -> Result<Document> {
    let invalid_filter = || invalid("Digite um objeto JSON válido para filtrar os documentos.");
    if filter.len() > 32_768 {
        return Err(invalid("O filtro excede 32 KB."));
    }
    if filter.trim().is_empty() {
        return Ok(Document::new());
    }
    let json = serde_json::from_str::<Value>(filter).map_err(|_| invalid_filter())?;
    match Bson::try_from(json).map_err(|_| invalid_filter())? {
        Bson::Document(document) => Ok(document),
        _ => Err(invalid_filter()),
    }
}

async fn redis_value(
    connection: &mut ConnectionManager,
    key: &[u8],
    kind: &str,
) -> redis::RedisResult<(Value, bool)> {
    type RedisPair = (Vec<u8>, Vec<u8>);

    fn strings(values: Vec<Vec<u8>>) -> (Value, bool) {
        let limited = values.len() > 20 || values.iter().any(|value| value.len() > VALUE_LIMIT);
        let values: Vec<_> = values
            .into_iter()
            .take(20)
            .map(|value| preview(&value, VALUE_LIMIT))
            .collect();
        (json!(values), limited)
    }

    fn fields(values: Vec<RedisPair>) -> (Value, bool) {
        let limited = values.len() > 20
            || values
                .iter()
                .any(|(field, value)| field.len() > VALUE_LIMIT || value.len() > VALUE_LIMIT);
        let values: Vec<_> = values.into_iter().take(20).map(|(field, value)|
            json!({"campo": preview(&field, VALUE_LIMIT), "valor": preview(&value, VALUE_LIMIT)})).collect();
        (json!(values), limited)
    }

    Ok(match kind {
        "string" => {
            let (bytes, total): (Vec<u8>, usize) = redis::pipe()
                .cmd("GETRANGE")
                .arg(key)
                .arg(0)
                .arg(VALUE_LIMIT - 1)
                .cmd("STRLEN")
                .arg(key)
                .query_async(connection)
                .await?;
            (json!(preview(&bytes, VALUE_LIMIT)), total > VALUE_LIMIT)
        }
        "hash" => {
            let (next, pairs): (u64, Vec<RedisPair>) = redis::cmd("HSCAN")
                .arg(key)
                .arg(0)
                .arg("COUNT")
                .arg(20)
                .query_async(connection)
                .await?;
            let (value, limited) = fields(pairs);
            (value, limited || next != 0)
        }
        "set" => {
            let (next, values): (u64, Vec<Vec<u8>>) = redis::cmd("SSCAN")
                .arg(key)
                .arg(0)
                .arg("COUNT")
                .arg(20)
                .query_async(connection)
                .await?;
            let (value, limited) = strings(values);
            (value, limited || next != 0)
        }
        "list" => strings(
            redis::cmd("LRANGE")
                .arg(key)
                .arg(0)
                .arg(20)
                .query_async(connection)
                .await?,
        ),
        "zset" => {
            let pairs: Vec<(Vec<u8>, f64)> = redis::cmd("ZRANGE")
                .arg(key)
                .arg(0)
                .arg(20)
                .arg("WITHSCORES")
                .query_async(connection)
                .await?;
            let limited =
                pairs.len() > 20 || pairs.iter().any(|(value, _)| value.len() > VALUE_LIMIT);
            let values: Vec<_> = pairs.into_iter().take(20).map(|(member, score)|
                json!({"membro": preview(&member, VALUE_LIMIT), "pontuação": score.to_string()})).collect();
            (json!(values), limited)
        }
        "stream" => {
            let rows: Vec<(String, Vec<RedisPair>)> = redis::cmd("XRANGE")
                .arg(key)
                .arg("-")
                .arg("+")
                .arg("COUNT")
                .arg(21)
                .query_async(connection)
                .await?;
            let mut limited = rows.len() > 20;
            let values: Vec<_> = rows
                .into_iter()
                .take(20)
                .map(|(id, values)| {
                    let (value, truncated) = fields(values);
                    limited |= truncated;
                    json!({"id": id, "campos": value})
                })
                .collect();
            (json!(values), limited)
        }
        _ => (Value::Null, false),
    })
}

fn preview(bytes: &[u8], limit: usize) -> String {
    let visible = &bytes[..bytes.len().min(limit)];
    let mut text = match std::str::from_utf8(visible) {
        Ok(text) => text.to_owned(),
        Err(error) if error.error_len().is_none() && bytes.len() > limit => {
            String::from_utf8_lossy(&visible[..error.valid_up_to()]).into_owned()
        }
        Err(_) => {
            let mut hex = String::from("0x");
            for byte in visible {
                let _ = write!(hex, "{byte:02x}");
            }
            hex
        }
    };
    if bytes.len() > limit {
        text.push('…');
    }
    text
}

fn invalid(message: &'static str) -> AppError {
    AppError::new("input", message)
}
fn unsupported() -> AppError {
    AppError::new(
        "unsupported",
        "Esta operação não está disponível neste banco.",
    )
}
fn read_error() -> AppError {
    AppError::new(
        "query",
        "O banco não conseguiu concluir a leitura. Confira o acesso e os dados informados.",
    )
}
fn connection_error() -> AppError {
    AppError::new(
        "connection",
        "Conexão recusada. Confira a URI, as credenciais e o acesso ao servidor.",
    )
}

#[cfg(test)]
mod tests;
