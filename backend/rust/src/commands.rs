use crate::{
    catalog,
    connection::Connections,
    edit, editor,
    error::{deadline, AppError, Result},
    models::{
        ConnectInput, Connected, DatabaseDiagram, EditInput, EditOutcome, Engine, QueryOutput,
        RecordsInput, RecordsPage, Relationship, Scope, Structure, Table, TableScope,
    },
    no_sql::{DocumentsPage, RedisEntry, RedisKeys},
    records, relationships,
    sql_server::dashboard,
};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn dashboard_files(
    scope: Scope,
    state: State<'_, Connections>,
) -> Result<Vec<dashboard::DatabaseFile>> {
    dashboard::files(&state, scope).await
}

#[tauri::command]
pub async fn dashboard_live(
    scope: Scope,
    state: State<'_, Connections>,
) -> Result<dashboard::LiveActivity> {
    dashboard::live(&state, scope).await
}

#[tauri::command]
pub async fn dashboard_engine(
    scope: Scope,
    state: State<'_, Connections>,
) -> Result<crate::engine_dashboard::EngineDashboard> {
    state.dashboard(&scope).await
}

#[tauri::command]
pub async fn dashboard_overview(
    scope: Scope,
    state: State<'_, Connections>,
) -> Result<dashboard::Overview> {
    dashboard::overview(&state, scope).await
}

#[tauri::command]
pub async fn dashboard_storage(
    scope: Scope,
    state: State<'_, Connections>,
) -> Result<Vec<dashboard::TableStorage>> {
    dashboard::storage(&state, scope).await
}

#[tauri::command]
pub async fn dashboard_performance(
    scope: Scope,
    hours: i32,
    state: State<'_, Connections>,
) -> Result<dashboard::Performance> {
    dashboard::performance(&state, scope, hours).await
}

#[tauri::command]
pub async fn connect(
    input: ConnectInput,
    use_saved: Option<bool>,
    remember: Option<bool>,
    state: State<'_, Connections>,
) -> Result<Connected> {
    state
        .connect(input, use_saved.unwrap_or(false), remember.unwrap_or(false))
        .await
}

#[tauri::command]
pub async fn connect_nosql(
    engine: Engine,
    uri: String,
    state: State<'_, Connections>,
) -> Result<Connected> {
    state.connect_nosql(engine, uri).await
}

#[tauri::command]
pub async fn mongo_collections(scope: Scope, state: State<'_, Connections>) -> Result<Vec<String>> {
    let session = state.no_sql(&scope).await?;
    deadline(session.collections(&scope.database)).await
}

#[tauri::command]
pub async fn mongo_documents(
    scope: Scope,
    collection: String,
    filter: String,
    page: u32,
    state: State<'_, Connections>,
) -> Result<DocumentsPage> {
    let session = state.no_sql(&scope).await?;
    deadline(session.documents(&scope.database, &collection, &filter, page)).await
}

#[tauri::command]
pub async fn redis_keys(
    scope: Scope,
    cursor: String,
    pattern: String,
    state: State<'_, Connections>,
) -> Result<RedisKeys> {
    let session = state.no_sql(&scope).await?;
    deadline(session.redis_keys(&cursor, &pattern)).await
}

#[tauri::command]
pub async fn redis_entry(
    scope: Scope,
    id: String,
    state: State<'_, Connections>,
) -> Result<RedisEntry> {
    let session = state.no_sql(&scope).await?;
    deadline(session.redis_entry(&id)).await
}

#[tauri::command]
pub async fn choose_sqlite_file(app: AppHandle) -> Result<Option<String>> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Banco SQLite", &["sqlite", "sqlite3", "db", "db3"])
        .pick_file(move |file| {
            let _ = sender.send(file);
        });
    let file = receiver
        .await
        .map_err(|_| AppError::new("application", "Não foi possível selecionar o arquivo."))?;
    Ok(file
        .and_then(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn has_saved_password(input: ConnectInput) -> Result<bool> {
    match crate::credentials::PasswordKey::for_input(&input) {
        Some(key) => key.exists(),
        None => Ok(false),
    }
}

#[tauri::command]
pub fn forget_password(input: ConnectInput) -> Result<()> {
    if let Some(key) = crate::credentials::PasswordKey::for_input(&input) {
        key.forget()?;
    }
    Ok(())
}

#[tauri::command]
pub async fn disconnect(state: State<'_, Connections>) -> Result<()> {
    state.disconnect().await;
    Ok(())
}

#[tauri::command]
pub async fn schemas(scope: Scope, state: State<'_, Connections>) -> Result<Vec<String>> {
    if let Some(other) = state.other(&scope).await? {
        return deadline(other.schemas(&scope.database)).await;
    }
    catalog::schemas(&state, scope).await
}

#[tauri::command]
pub async fn tables(
    scope: Scope,
    schema: String,
    state: State<'_, Connections>,
) -> Result<Vec<Table>> {
    if let Some(other) = state.other(&scope).await? {
        return deadline(other.tables(&scope.database, Some(&schema))).await;
    }
    catalog::tables(&state, scope, schema).await
}

#[tauri::command]
pub async fn structure(scope: TableScope, state: State<'_, Connections>) -> Result<Structure> {
    if let Some(other) = state.other(&scope.scope).await? {
        return deadline(other.structure(&scope.scope.database, scope.table_id)).await;
    }
    catalog::structure(&state, scope).await
}

#[tauri::command]
pub async fn records(input: RecordsInput, state: State<'_, Connections>) -> Result<RecordsPage> {
    if let Some(other) = state.other(&input.table.scope).await? {
        let database = input.table.scope.database.clone();
        return deadline(other.records(&database, input)).await;
    }
    records::page(&state, input).await
}

#[tauri::command]
pub async fn query_read(
    scope: Scope,
    source: String,
    state: State<'_, Connections>,
) -> Result<QueryOutput> {
    if let Some(other) = state.other(&scope).await? {
        return deadline(other.read(&scope.database, &source)).await;
    }
    editor::read(&state, scope, source).await
}

#[tauri::command]
pub async fn update_cell(input: EditInput, state: State<'_, Connections>) -> Result<EditOutcome> {
    edit::apply(&state, input).await
}

#[tauri::command]
pub async fn database_diagram(
    scope: Scope,
    state: State<'_, Connections>,
) -> Result<DatabaseDiagram> {
    if let Some(other) = state.other(&scope).await? {
        return deadline(other.diagram(&scope.database)).await;
    }
    relationships::database(&state, scope).await
}

#[tauri::command]
pub async fn relationships(
    scope: TableScope,
    state: State<'_, Connections>,
) -> Result<Vec<Relationship>> {
    if let Some(other) = state.other(&scope.scope).await? {
        return deadline(other.relationships(&scope.scope.database, scope.table_id)).await;
    }
    relationships::list(&state, scope).await
}
