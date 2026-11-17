mod ai;
pub mod collaboration;
pub mod workspaces;
mod files;
mod model;

use self::{
    ai::Provider,
    files::{Opened, ProjectCode, ProjectRef},
    model::Diagram,
};
use crate::error::{AppError, Result};
use std::path::PathBuf;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder, FilePath};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct SelectedWorkspace(Mutex<Option<PathBuf>>);

#[tauri::command]
pub async fn diagram_choose_workspace(
    app: AppHandle,
    workspace: State<'_, SelectedWorkspace>,
) -> Result<Option<String>> {
    let dialog = app
        .dialog()
        .file()
        .set_title("Escolha a pasta que o assistente poderá editar");
    let Some(path) = choose(dialog, FileDialogBuilder::pick_folder).await? else {
        return Ok(None);
    };
    let path = path.canonicalize().map_err(|_| picker_error())?;
    let label = path
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_owned();
    *workspace.0.lock().await = Some(path);
    Ok(Some(label))
}

#[tauri::command]
pub async fn assistant_converse(
    workspace: State<'_, SelectedWorkspace>,
    provider: Provider,
    request: ai::AssistantRequest,
) -> Result<ai::AssistantReply> {
    let current = workspace.0.lock().await;
    ai::converse(provider, request, current.as_deref()).await
}

#[tauri::command]
pub async fn diagram_agent(provider: Provider) -> Result<()> {
    ai::check(provider).await
}

#[tauri::command]
pub async fn diagram_open(app: AppHandle) -> Result<Option<Opened>> {
    let dialog = app
        .dialog()
        .file()
        .add_filter("Fluxograma do JujubaSQL", &["json"]);
    let path = choose(dialog, FileDialogBuilder::pick_file).await?;
    path.as_deref().map(files::open).transpose()
}

#[tauri::command]
pub async fn diagram_save(
    app: AppHandle,
    diagram: Diagram,
    project: Option<ProjectRef>,
) -> Result<Option<ProjectRef>> {
    diagram.validate_draft()?;
    if let Some(project) = project {
        let path = PathBuf::from(&project.path);
        return files::save(&path, Some(project), diagram).map(Some);
    }
    let dialog = app
        .dialog()
        .file()
        .add_filter("Fluxograma do JujubaSQL", &["json"])
        .set_file_name("fluxograma.jujuba.json");
    let Some(path) = choose(dialog, FileDialogBuilder::save_file).await? else {
        return Ok(None);
    };
    let path = if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(".jujuba.json"))
    {
        path
    } else {
        path.with_extension("jujuba.json")
    };
    files::save(&path, None, diagram).map(Some)
}

#[tauri::command]
pub async fn diagram_markdown(app: AppHandle, diagram: Diagram) -> Result<Option<String>> {
    diagram.validate_draft()?;
    let dialog = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md"])
        .set_file_name("FLUXOGRAMA.md");
    let Some(path) = choose(dialog, FileDialogBuilder::save_file).await? else {
        return Ok(None);
    };
    files::export(&path, diagram)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn diagram_scaffold(
    provider: Provider,
    project: ProjectRef,
    requirements: String,
) -> Result<ProjectCode> {
    let opened = files::open_current(&project)?;
    ai::scaffold(provider, opened.diagram, requirements).await
}

#[tauri::command]
pub async fn diagram_write_code(app: AppHandle, code: ProjectCode) -> Result<Option<String>> {
    code.validate()?;
    let dialog = app
        .dialog()
        .file()
        .set_title("Escolha onde criar a pasta do sistema");
    let Some(parent) = choose(dialog, FileDialogBuilder::pick_folder).await? else {
        return Ok(None);
    };
    code.save(&parent).map(Some)
}

async fn choose(
    dialog: FileDialogBuilder<tauri::Wry>,
    action: impl FnOnce(FileDialogBuilder<tauri::Wry>, Box<dyn FnOnce(Option<FilePath>) + Send>),
) -> Result<Option<PathBuf>> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    action(
        dialog,
        Box::new(move |path| {
            let _ = sender.send(path);
        }),
    );
    let path = receiver.await.map_err(|_| picker_error())?;
    path.map(|path| path.into_path().map_err(|_| picker_error()))
        .transpose()
}

fn picker_error() -> AppError {
    AppError::new("file", "Não foi possível abrir o seletor de arquivos.")
}

#[cfg(test)]
mod tests;
