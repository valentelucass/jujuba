use crate::{
    credentials::PasswordKey,
    engine_dashboard::{self, EngineDashboard},
    error::{deadline, AppError, Result},
    models::{ConnectInput, Connected, Engine, Scope, Transport},
    no_sql::NoSqlSession,
    other_db::OtherSession,
    sql_server::{
        catalog,
        connection::{Profile, SqlClient},
    },
};
use std::{collections::HashSet, sync::Arc};
use tokio::sync::RwLock;
use zeroize::Zeroizing;

#[derive(Default)]
pub struct Connections {
    state: RwLock<ConnectionState>,
}

#[derive(Default)]
struct ConnectionState {
    revision: u32,
    active: Option<Session>,
}

struct Session {
    profile: SessionProfile,
    databases: HashSet<String>,
}

#[derive(Clone)]
enum SessionProfile {
    SqlServer(Arc<Profile>),
    Other(Arc<OtherSession>),
    NoSql(Arc<NoSqlSession>),
}

impl Connections {
    pub async fn connect(&self, input: ConnectInput, use_saved: bool) -> Result<Connected> {
        let key = PasswordKey::for_input(&input);
        self.connect_with_key(input, use_saved, key).await
    }

    async fn connect_with_key(
        &self,
        input: ConnectInput,
        use_saved: bool,
        key: Option<PasswordKey>,
    ) -> Result<Connected> {
        let remember = input.password.is_some() || !use_saved;
        if input.engine != Engine::SqlServer {
            return self.connect_other(input, use_saved, remember, key).await;
        }
        let saved = if use_saved && input.password.is_none() {
            Some(
                key.as_ref()
                    .map(PasswordKey::read)
                    .transpose()?
                    .flatten()
                    .ok_or_else(|| {
                        AppError::new(
                            "credentials",
                            "A senha salva não está disponível. Digite a senha para conectar.",
                        )
                    })?,
            )
        } else {
            None
        };
        let profile = Arc::new(Profile::with_saved_password(input, saved)?);
        let revision = self.clear().await;
        let databases = deadline(async {
            let mut client = profile.open("master").await?;
            catalog::databases(&mut client).await
        })
        .await?;

        let endpoint = profile.endpoint();
        let transport = profile.transport();
        let mut state = self.state.write().await;
        if state.revision != revision {
            return Err(AppError::new(
                "disconnected",
                "A conexão foi substituída ou encerrada.",
            ));
        }
        let password_save_failed = remember
            && key
                .as_ref()
                .zip(profile.sql_password())
                .is_some_and(|(key, password)| key.save(password).is_err());
        state.active = Some(Session {
            profile: SessionProfile::SqlServer(profile),
            databases: databases.iter().cloned().collect(),
        });
        Ok(Connected {
            engine: Engine::SqlServer,
            session: revision,
            endpoint,
            transport,
            databases,
            password_save_failed,
        })
    }

    async fn connect_other(
        &self,
        mut input: ConnectInput,
        use_saved: bool,
        remember: bool,
        key: Option<PasswordKey>,
    ) -> Result<Connected> {
        let engine = input.engine;
        if use_saved && input.password.is_none() && engine != Engine::Sqlite {
            input.password = Some(read_secret(key.as_ref())?.to_string());
        }
        let secret = if remember && key.is_some() {
            Some(Zeroizing::new(input.password.clone().unwrap_or_default()))
        } else {
            None
        };
        let revision = self.clear().await;
        let (other, endpoint, transport, databases) =
            deadline(OtherSession::connect(input)).await?;
        let connected = Connected {
            engine,
            session: revision,
            endpoint,
            transport,
            databases,
            password_save_failed: false,
        };
        self.activate(
            connected,
            SessionProfile::Other(Arc::new(other)),
            key.as_ref(),
            secret.as_deref().map(String::as_str),
        )
        .await
    }

    pub async fn connect_nosql(
        &self,
        engine: Engine,
        uri: Option<String>,
        use_saved: bool,
    ) -> Result<Connected> {
        let key = PasswordKey::for_uri(engine);
        self.connect_nosql_with_key(engine, uri, use_saved, key)
            .await
    }

    pub(crate) async fn connect_nosql_with_key(
        &self,
        engine: Engine,
        uri: Option<String>,
        use_saved: bool,
        key: Option<PasswordKey>,
    ) -> Result<Connected> {
        let remember = uri.is_some();
        let uri = match uri {
            Some(value) => Zeroizing::new(value),
            None if use_saved => read_secret(key.as_ref())?,
            None => return Err(AppError::new("input", "Digite a URI de conexão.")),
        };
        let revision = self.clear().await;
        let (session, endpoint, databases) =
            deadline(NoSqlSession::open(engine, uri.to_string())).await?;
        let connected = Connected {
            engine,
            session: revision,
            endpoint,
            transport: Transport::Network,
            databases,
            password_save_failed: false,
        };
        self.activate(
            connected,
            SessionProfile::NoSql(Arc::new(session)),
            key.as_ref(),
            remember.then_some(uri.as_str()),
        )
        .await
    }

    async fn activate(
        &self,
        mut connected: Connected,
        profile: SessionProfile,
        key: Option<&PasswordKey>,
        secret: Option<&str>,
    ) -> Result<Connected> {
        let mut state = self.state.write().await;
        if state.revision != connected.session {
            return Err(AppError::new(
                "disconnected",
                "A conexão foi substituída ou encerrada.",
            ));
        }
        connected.password_save_failed = key
            .zip(secret)
            .is_some_and(|(key, value)| key.save(value).is_err());
        state.active = Some(Session {
            profile,
            databases: connected.databases.iter().cloned().collect(),
        });
        Ok(connected)
    }

    async fn clear(&self) -> u32 {
        let mut state = self.state.write().await;
        state.revision = state.revision.wrapping_add(1);
        state.active = None;
        state.revision
    }

    pub async fn disconnect(&self) {
        self.clear().await;
    }

    pub async fn other(&self, scope: &Scope) -> Result<Option<Arc<OtherSession>>> {
        let state = self.state.read().await;
        match state.session(scope)? {
            SessionProfile::SqlServer(_) => Ok(None),
            SessionProfile::NoSql(_) => Err(AppError::new(
                "unsupported",
                "Use o explorador deste banco.",
            )),

            SessionProfile::Other(other) => Ok(Some(Arc::clone(other))),
        }
    }

    pub async fn dashboard(&self, scope: &Scope) -> Result<EngineDashboard> {
        let profile = self.state.read().await.session(scope)?.clone();
        deadline(async {
            match profile {
                SessionProfile::Other(session) => {
                    engine_dashboard::sql(session.client(&scope.database).await?).await
                }
                SessionProfile::NoSql(session) => {
                    engine_dashboard::no_sql(&session, &scope.database).await
                }
                SessionProfile::SqlServer(_) => Err(AppError::new(
                    "unsupported",
                    "Use os painéis de monitoramento do SQL Server.",
                )),
            }
        })
        .await
    }

    pub async fn no_sql(&self, scope: &Scope) -> Result<Arc<NoSqlSession>> {
        let state = self.state.read().await;
        match state.session(scope)? {
            SessionProfile::NoSql(session) => Ok(Arc::clone(session)),
            _ => Err(AppError::new(
                "unsupported",
                "Esta operação exige uma conexão NoSQL.",
            )),
        }
    }

    pub async fn open_database(&self, scope: &Scope) -> Result<SqlClient> {
        let profile = {
            let state = self.state.read().await;
            match state.session(scope)? {
                SessionProfile::SqlServer(profile) => Arc::clone(profile),
                SessionProfile::Other(_) | SessionProfile::NoSql(_) => {
                    return Err(AppError::new(
                        "unsupported",
                        "Esta operação está disponível em conexões SQL Server.",
                    ))
                }
            }
        };
        profile.open(&scope.database).await
    }
}

fn read_secret(key: Option<&PasswordKey>) -> Result<Zeroizing<String>> {
    key.map(PasswordKey::read)
        .transpose()?
        .flatten()
        .ok_or_else(|| {
            AppError::new(
                "credentials",
                "A credencial salva não está disponível. Digite os dados da conexão.",
            )
        })
}

impl ConnectionState {
    fn session(&self, scope: &Scope) -> Result<&SessionProfile> {
        let session = self
            .active
            .as_ref()
            .filter(|_| self.revision == scope.session)
            .ok_or_else(|| {
                AppError::new(
                    "disconnected",
                    "A conexão foi encerrada. Conecte novamente.",
                )
            })?;
        if !session.databases.contains(&scope.database) {
            return Err(AppError::denied());
        }
        Ok(&session.profile)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Authentication;

    struct TestCredential(String);

    impl TestCredential {
        fn new(engine: Engine) -> Self {
            Self(format!("reconnect-{engine:?}-{}", std::process::id()))
        }

        fn key(&self) -> PasswordKey {
            PasswordKey::test_target(&self.0)
        }
    }

    impl Drop for TestCredential {
        fn drop(&mut self) {
            let _ = self.key().forget();
        }
    }

    #[tokio::test]
    #[ignore = "requer MySQL de teste local"]
    async fn reconnects_mysql_with_the_automatically_saved_password() {
        check_sql_reconnect(Engine::Mysql, "MYSQL").await;
    }

    #[tokio::test]
    #[ignore = "requer PostgreSQL de teste local"]
    async fn reconnects_postgres_with_the_automatically_saved_password() {
        check_sql_reconnect(Engine::Postgres, "POSTGRES").await;
    }

    async fn check_sql_reconnect(engine: Engine, prefix: &str) {
        let setting = |name| std::env::var(format!("JUJUBA_TEST_{prefix}_{name}")).unwrap();
        let password = setting("PASSWORD");
        let input = |password| ConnectInput {
            engine,
            database: Some("postgres".into()),
            path: None,
            host: "127.0.0.1".into(),
            port: setting("PORT").parse().unwrap(),
            transport: Transport::Network,
            instance: None,
            authentication: Authentication::Sql,
            username: Some(setting("USER")),
            password,
        };
        let fixture = TestCredential::new(engine);
        let first = Connections::default();
        let active = first
            .connect_with_key(input(Some(password.clone())), false, Some(fixture.key()))
            .await
            .unwrap();
        assert!(!active.password_save_failed);
        first.disconnect().await;
        let second = Connections::default();
        assert!(second
            .connect_with_key(
                input(Some(format!("{password}-invalid"))),
                false,
                Some(fixture.key())
            )
            .await
            .is_err());
        let active = second
            .connect_with_key(input(None), true, Some(fixture.key()))
            .await
            .unwrap();
        assert_eq!(active.engine, engine);
        assert!(active.databases.iter().any(|name| name == "jujuba_test"));
    }

    #[tokio::test]
    #[ignore = "requer MongoDB de teste local"]
    async fn reconnects_mongodb_with_the_automatically_saved_uri() {
        check_uri_reconnect(
            Engine::Mongodb,
            "JUJUBA_TEST_MONGO_URI",
            "mongodb://127.0.0.1:",
        )
        .await;
    }

    #[tokio::test]
    #[ignore = "requer Redis de teste local"]
    async fn reconnects_redis_with_the_automatically_saved_uri() {
        check_uri_reconnect(Engine::Redis, "JUJUBA_TEST_REDIS_URI", "redis://127.0.0.1:").await;
    }

    async fn check_uri_reconnect(engine: Engine, variable: &str, prefix: &str) {
        let uri = std::env::var(variable).unwrap();
        assert!(uri.starts_with(prefix));
        let fixture = TestCredential::new(engine);
        let first = Connections::default();
        let active = first
            .connect_nosql_with_key(engine, Some(uri), false, Some(fixture.key()))
            .await
            .unwrap();
        assert!(!active.password_save_failed);
        first.disconnect().await;
        let second = Connections::default();
        assert!(second
            .connect_nosql_with_key(
                engine,
                Some("invalid-uri".into()),
                false,
                Some(fixture.key())
            )
            .await
            .is_err());
        let resumed = second
            .connect_nosql_with_key(engine, None, true, Some(fixture.key()))
            .await
            .unwrap();
        assert_eq!(resumed.engine, engine);
        assert_eq!(resumed.endpoint, active.endpoint);
    }
}
