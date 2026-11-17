mod catalog;
mod values;

#[cfg(test)]
mod tests;

use crate::{
    error::{AppError, Result},
    models::{ConnectInput, Engine, QueryOutput, Transport},
};
use futures_util::TryStreamExt;
use sqlx::{
    mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode},
    postgres::{PgConnectOptions, PgPoolOptions, PgSslMode},
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Column, Executor, MySqlPool, PgPool, Row, SqlitePool,
};
use std::{collections::HashMap, path::Path, time::Duration};
use tokio::sync::{Mutex, RwLock};
use zeroize::Zeroizing;

#[derive(Clone)]
pub enum Client {
    Mysql(MySqlPool),
    Postgres(PgPool),
    Sqlite(SqlitePool),
}

enum Pools {
    Mysql(MySqlConnectOptions, Mutex<HashMap<String, MySqlPool>>),
    Postgres(PgConnectOptions, Mutex<HashMap<String, PgPool>>),
    Sqlite(SqlitePool),
}

pub struct OtherSession {
    pools: Pools,
    ids: RwLock<HashMap<String, catalog::TableIds>>,
}

impl OtherSession {
    pub async fn connect(input: ConnectInput) -> Result<(Self, String, Transport, Vec<String>)> {
        let result = match input.engine {
            Engine::Sqlite => {
                let path = Path::new(input.path.as_deref().ok_or_else(invalid_input)?);
                let file = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .filter(|_| path.is_absolute() && path.is_file())
                    .ok_or_else(|| {
                        AppError::new(
                            "input",
                            "Escolha um arquivo SQLite existente com um caminho absoluto.",
                        )
                    })?;
                let pool = SqlitePoolOptions::new()
                    .max_connections(2)
                    .connect_with(SqliteConnectOptions::new().filename(path).read_only(true))
                    .await?;
                sqlx::query("SELECT name FROM sqlite_schema LIMIT 1")
                    .fetch_optional(&pool)
                    .await?;
                (
                    Pools::Sqlite(pool),
                    file.to_owned(),
                    Transport::Local,
                    vec![file.to_owned()],
                )
            }
            Engine::Mysql | Engine::Postgres => {
                let host = input.host.trim();
                let user = input.username.as_deref().unwrap_or("").trim();
                if host.is_empty()
                    || host.len() > 253
                    || host.chars().any(char::is_whitespace)
                    || host.contains('\0')
                    || user.is_empty()
                    || input.port == 0
                {
                    return Err(invalid_input());
                }
                let password = Zeroizing::new(input.password.unwrap_or_default());
                let local = matches!(
                    host.to_ascii_lowercase().as_str(),
                    "localhost" | "127.0.0.1" | "::1"
                );
                let transport = if local {
                    Transport::Local
                } else {
                    Transport::Network
                };
                let endpoint = format!("{host}:{}", input.port);

                if input.engine == Engine::Mysql {
                    let options = MySqlConnectOptions::new()
                        .host(host)
                        .port(input.port)
                        .username(user)
                        .password(password.as_str())
                        .ssl_mode(if local {
                            MySqlSslMode::Preferred
                        } else {
                            MySqlSslMode::VerifyIdentity
                        });
                    let pool = MySqlPoolOptions::new()
                        .max_connections(1)
                        .connect_with(options.clone())
                        .await?;
                    let databases = sqlx::query_scalar::<_, String>("SELECT SCHEMA_NAME
                        FROM information_schema.SCHEMATA
                        WHERE SCHEMA_NAME NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
                        ORDER BY SCHEMA_NAME").fetch_all(&pool).await?;
                    pool.close().await;
                    (
                        Pools::Mysql(options, Mutex::default()),
                        endpoint,
                        transport,
                        databases,
                    )
                } else {
                    let initial = input.database.as_deref().unwrap_or("postgres");
                    if initial.is_empty() || initial.contains('\0') {
                        return Err(invalid_input());
                    }
                    let options = PgConnectOptions::new()
                        .host(host)
                        .port(input.port)
                        .username(user)
                        .password(password.as_str())
                        .database(initial)
                        .ssl_mode(if local {
                            PgSslMode::Prefer
                        } else {
                            PgSslMode::VerifyFull
                        });
                    let pool = PgPoolOptions::new()
                        .max_connections(3)
                        .connect_with(options.clone())
                        .await?;
                    let mut databases = sqlx::query_scalar::<_, String>("SELECT datname::text
                        FROM pg_catalog.pg_database
                        WHERE datallowconn AND NOT datistemplate AND has_database_privilege(datname, 'CONNECT')
                        ORDER BY datname").fetch_all(&pool).await?;
                    if !databases.iter().any(|database| database == initial) {
                        databases.insert(0, initial.to_owned());
                    }
                    let pools = Mutex::new(HashMap::from([(initial.to_owned(), pool)]));
                    (
                        Pools::Postgres(options, pools),
                        endpoint,
                        transport,
                        databases,
                    )
                }
            }
            Engine::SqlServer | Engine::Mongodb | Engine::Redis => return Err(invalid_input()),
        };

        let (pools, endpoint, transport, databases) = result;
        Ok((
            Self {
                pools,
                ids: RwLock::default(),
            },
            endpoint,
            transport,
            databases,
        ))
    }

    pub(crate) async fn client(&self, database: &str) -> Result<Client> {
        const IDLE: Duration = Duration::from_secs(60);
        match &self.pools {
            Pools::Mysql(options, pools) => {
                let mut pools = pools.lock().await;
                let pool = pools.entry(database.to_owned()).or_insert_with(|| {
                    MySqlPoolOptions::new()
                        .max_connections(3)
                        .idle_timeout(IDLE)
                        .connect_lazy_with(options.clone().database(database))
                });
                Ok(Client::Mysql(pool.clone()))
            }
            Pools::Postgres(options, pools) => {
                let mut pools = pools.lock().await;
                let pool = pools.entry(database.to_owned()).or_insert_with(|| {
                    PgPoolOptions::new()
                        .max_connections(3)
                        .idle_timeout(IDLE)
                        .connect_lazy_with(options.clone().database(database))
                });
                Ok(Client::Postgres(pool.clone()))
            }
            Pools::Sqlite(pool) => Ok(Client::Sqlite(pool.clone())),
        }
    }

    pub async fn read(&self, database: &str, source: &str) -> Result<QueryOutput> {
        let client = self.client(database).await?;
        let source = crate::editor::validate_for(source, client.engine())?;
        client.read(&source).await
    }
}

impl Client {
    fn engine(&self) -> Engine {
        match self {
            Self::Mysql(_) => Engine::Mysql,
            Self::Postgres(_) => Engine::Postgres,
            Self::Sqlite(_) => Engine::Sqlite,
        }
    }

    // Catalog and grid queries project each value as text.
    async fn text_rows(&self, source: &str, params: &[&str]) -> Result<Vec<Vec<Option<String>>>> {
        macro_rules! fetch {
            ($pool:expr, $row:ty) => {{
                let mut query = sqlx::query(source);
                for parameter in params {
                    query = query.bind(*parameter);
                }
                query
                    .try_map(|row: $row| {
                        (0..row.len())
                            .map(|index| row.try_get_unchecked(index))
                            .collect::<std::result::Result<_, sqlx::Error>>()
                    })
                    .fetch_all($pool)
                    .await?
            }};
        }
        Ok(match self {
            Self::Mysql(pool) => fetch!(pool, sqlx::mysql::MySqlRow),
            Self::Postgres(pool) => fetch!(pool, sqlx::postgres::PgRow),
            Self::Sqlite(pool) => fetch!(pool, sqlx::sqlite::SqliteRow),
        })
    }

    async fn read(&self, source: &str) -> Result<QueryOutput> {
        const LIMIT: usize = 200;
        macro_rules! read {
            ($executor:expr, $decode:path) => {{
                let columns = $executor
                    .describe(source)
                    .await?
                    .columns()
                    .iter()
                    .map(|column| column.name().to_owned())
                    .collect();
                let mut stream = sqlx::query(source).fetch($executor);
                let mut rows = Vec::new();
                let mut truncated = false;
                while let Some(row) = stream.try_next().await? {
                    if rows.len() == LIMIT {
                        truncated = true;
                        break;
                    }
                    rows.push((0..row.len()).map(|index| $decode(&row, index)).collect());
                }
                QueryOutput {
                    columns,
                    rows,
                    truncated,
                }
            }};
        }
        match self {
            Self::Mysql(pool) => {
                let mut transaction = pool.begin_with("START TRANSACTION READ ONLY").await?;
                let output = read!(&mut *transaction, values::mysql);
                transaction.rollback().await?;
                Ok(output)
            }
            Self::Postgres(pool) => {
                let mut transaction = pool.begin_with("BEGIN READ ONLY").await?;
                let output = read!(&mut *transaction, values::postgres);
                transaction.rollback().await?;
                Ok(output)
            }
            Self::Sqlite(pool) => Ok(read!(pool, values::sqlite)),
        }
    }
}

fn invalid_input() -> AppError {
    AppError::new(
        "input",
        "Confira o servidor, a porta e o usuário da conexão.",
    )
}

impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        let message = match error {
            sqlx::Error::Database(ref error) => {
                let code = error.code().unwrap_or_default();
                if matches!(code.as_ref(), "28P01" | "28000" | "1045")
                    || error
                        .try_downcast_ref::<sqlx::mysql::MySqlDatabaseError>()
                        .is_some_and(|error| error.number() == 1045)
                {
                    return Self::new(
                        "authentication",
                        "O banco rejeitou o login. Confira o usuário e a senha.",
                    );
                }
                if matches!(code.as_ref(), "42501" | "3D000" | "42S02")
                    || error
                        .try_downcast_ref::<sqlx::mysql::MySqlDatabaseError>()
                        .is_some_and(|error| matches!(error.number(), 1044 | 1049 | 1142))
                {
                    return Self::denied();
                }
                if matches!(code.as_ref(), "14" | "26") {
                    return Self::new(
                        "input",
                        "Não foi possível abrir o arquivo como um banco SQLite.",
                    );
                }
                "O banco não conseguiu concluir a leitura."
            }
            sqlx::Error::Tls(_) => {
                return Self::new(
                    "certificate",
                    "A conexão TLS falhou. Confira o endereço e o certificado do servidor.",
                )
            }
            sqlx::Error::Io(_) | sqlx::Error::PoolTimedOut => {
                return Self::new(
                    "network",
                    "A comunicação com o banco falhou. Confira o servidor e a porta.",
                )
            }
            _ => "Não foi possível interpretar a resposta do banco.",
        };
        Self::new("query", message)
    }
}
