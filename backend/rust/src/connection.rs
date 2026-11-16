use crate::{
    credentials::PasswordKey,
    error::{deadline, AppError, Result},
    models::{ConnectInput, Connected, Engine, Scope},
    other_db::OtherSession,
    sql_server::{
        catalog,
        connection::{Profile, SqlClient},
    },
};
use std::{collections::HashSet, sync::Arc};
use tokio::sync::RwLock;

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

enum SessionProfile {
    SqlServer(Arc<Profile>),
    Other(Arc<OtherSession>),
}

impl Connections {
    pub async fn connect(
        &self,
        input: ConnectInput,
        use_saved: bool,
        remember: bool,
    ) -> Result<Connected> {
        if input.engine != Engine::SqlServer {
            return self.connect_other(input).await;
        }
        let key = PasswordKey::for_input(&input);
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

    async fn connect_other(&self, input: ConnectInput) -> Result<Connected> {
        let engine = input.engine;
        let revision = self.clear().await;
        let (other, endpoint, transport, databases) =
            deadline(OtherSession::connect(input)).await?;
        let mut state = self.state.write().await;
        if state.revision != revision {
            return Err(AppError::new(
                "disconnected",
                "A conexão foi substituída ou encerrada.",
            ));
        }
        state.active = Some(Session {
            profile: SessionProfile::Other(Arc::new(other)),
            databases: databases.iter().cloned().collect(),
        });
        Ok(Connected {
            engine,
            session: revision,
            endpoint,
            transport,
            databases,
            password_save_failed: false,
        })
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
            SessionProfile::Other(other) => Ok(Some(Arc::clone(other))),
        }
    }

    pub async fn open_database(&self, scope: &Scope) -> Result<SqlClient> {
        let profile = {
            let state = self.state.read().await;
            match state.session(scope)? {
                SessionProfile::SqlServer(profile) => Arc::clone(profile),
                SessionProfile::Other(_) => {
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
