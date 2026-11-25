use super::{text, Parameter};
use crate::{
    connection::Connections,
    error::{deadline, AppError, Result},
    models::Scope,
};
use serde_json::Value;

const EMPTY: &str = "SELECT N'{\"available\":false}' AS payload";
async fn call(state: &Connections, scope: Scope, procedure: &str, arguments: &str, params: &[Parameter]) -> Result<Value> {
    // Procedure names and argument lists are fixed by the commands below. User values are bound.
    let statement = format!("IF OBJECT_ID(N'ctl.{procedure}', N'P') IS NULL BEGIN {EMPTY}; END ELSE EXEC ctl.{procedure} {arguments};");
    deadline(async {
        let mut client = state.open_database(&scope).await?;
        let rows = client.query(&statement, params).await?;
        let row = rows.first().ok_or_else(super::unexpected_catalog)?;
        serde_json::from_str(&text(row, "payload")?).map_err(|_| super::unexpected_catalog())
    }).await
}

fn check_name(entity: &str) -> Result<()> {
    if entity == "*" || (!entity.is_empty() && entity.len() <= 40 && entity.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')) {
        return Ok(());
    }
    Err(AppError::new("validation", "Selecione uma entidade do banco."))
}

#[tauri::command]
pub async fn retention_catalog(scope: Scope, state: tauri::State<'_, Connections>) -> Result<Value> {
    call(&state, scope, "usp_jujuba_retencao_catalogo", "", &[]).await
}

#[tauri::command]
pub async fn retention_preview(scope: Scope, entity: String, days: i32, state: tauri::State<'_, Connections>) -> Result<Value> {
    check_name(&entity)?;
    if days < 0 { return Err(AppError::new("validation", "O prazo deve ser positivo.")); }
    call(&state, scope, "usp_jujuba_retencao_previa", "@entidade=@P1, @dias=@P2", &[Parameter::Text(entity), Parameter::Int(days)]).await
}

#[tauri::command]
pub async fn retention_configure(scope: Scope, entity: String, mode: String, days: i32, revision: String, state: tauri::State<'_, Connections>) -> Result<Value> {
    check_name(&entity)?;
    if !matches!(mode.as_str(), "own" | "keep" | "inherit") || (mode == "own" && days < 1) || (mode != "own" && days != 0)
       || revision.len() != 16 || !revision.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError::new("validation", "Revise o prazo e atualize a prévia do banco."));
    }
    call(&state, scope, "usp_jujuba_retencao_configurar", "@entidade=@P1, @modo=@P2, @dias=@P3, @revisao=@P4",
        &[Parameter::Text(entity), Parameter::Text(mode), Parameter::Int(days), Parameter::Text(revision)]).await
}
