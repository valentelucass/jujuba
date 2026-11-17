use super::{
    files::ProjectRef,
    flow_access,
    model::{invalid, Diagram, Edge, Node},
};
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

static CATALOG: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: Uuid,
    pub diagram: Diagram,
    pub file: Option<ProjectRef>,
    pub file_dirty: bool,
    #[serde(default, skip_deserializing, skip_serializing_if = "is_false")]
    pub returning_guest: bool,
}

#[derive(Serialize)]
pub struct WorkspaceEntry {
    id: Uuid,
    title: String,
    preview: Preview,
}

#[derive(Serialize)]
struct Preview {
    nodes: Vec<Node>,
    edges: Vec<Edge>,
}

pub fn directory(app: &AppHandle) -> Result<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| catalog_error())?
        .join("fluxogramas");
    fs::create_dir_all(&directory).map_err(|_| catalog_error())?;
    Ok(directory)
}

pub fn load(directory: &Path, id: Uuid) -> Result<Workspace> {
    let bytes = fs::read(path(directory, id)).map_err(|_| catalog_error())?;
    let workspace: Workspace = serde_json::from_slice(&bytes).map_err(|_| catalog_error())?;
    workspace.diagram.validate_draft()?;
    if workspace.id != id {
        return Err(catalog_error());
    }
    Ok(workspace)
}

pub fn update(directory: &Path, id: Uuid, diagram: Diagram) -> Result<()> {
    let _guard = CATALOG.lock().map_err(|_| catalog_error())?;
    let mut workspace = load(directory, id)?;
    workspace.diagram = diagram;
    workspace.file_dirty = true;
    persist(directory, &workspace)
}

fn path(directory: &Path, id: Uuid) -> PathBuf {
    directory.join(format!("{id}.json"))
}

fn persist(directory: &Path, workspace: &Workspace) -> Result<()> {
    workspace.diagram.validate_draft()?;
    let mut tempfile = tempfile::NamedTempFile::new_in(directory).map_err(|_| catalog_error())?;
    serde_json::to_writer(&mut tempfile, workspace).map_err(|_| catalog_error())?;
    tempfile.flush().map_err(|_| catalog_error())?;
    tempfile
        .persist(path(directory, workspace.id))
        .map_err(|_| catalog_error())?;
    Ok(())
}

fn catalog_error() -> AppError {
    AppError::new(
        "workspace",
        "Não foi possível acessar os projetos de fluxograma.",
    )
}

#[tauri::command]
pub fn flow_projects(app: AppHandle) -> Result<Vec<WorkspaceEntry>> {
    let mut entries = Vec::new();
    for item in fs::read_dir(directory(&app)?).map_err(|_| catalog_error())? {
        let path = item.map_err(|_| catalog_error())?.path();
        let Some(id) = path
            .file_stem()
            .and_then(|name| name.to_str())
            .and_then(|name| Uuid::parse_str(name).ok())
        else {
            continue;
        };
        if path
            .extension()
            .is_some_and(|extension| extension == "json")
        {
            let workspace = load(path.parent().ok_or_else(catalog_error)?, id)?;
            entries.push(WorkspaceEntry {
                id,
                title: workspace.diagram.title,
                preview: Preview {
                    nodes: workspace.diagram.nodes,
                    edges: workspace.diagram.edges,
                },
            });
        }
    }
    entries.sort_by(|first, second| first.title.to_lowercase().cmp(&second.title.to_lowercase()));
    Ok(entries)
}

#[tauri::command]
pub fn flow_project_load(app: AppHandle, id: Uuid) -> Result<Workspace> {
    let directory = directory(&app)?;
    let mut workspace = load(&directory, id)?;
    workspace.returning_guest =
        flow_access::read(&directory, id)?.is_some_and(|sharing| sharing.guest.is_some());
    Ok(workspace)
}

fn is_false(value: &bool) -> bool {
    !value
}

#[tauri::command]
pub fn flow_project_create(
    app: AppHandle,
    diagram: Diagram,
    file: Option<ProjectRef>,
) -> Result<Workspace> {
    if diagram.title.trim().is_empty() {
        return Err(invalid("Dê um nome ao projeto."));
    }
    let workspace = Workspace {
        id: Uuid::new_v4(),
        file_dirty: file.is_none(),
        returning_guest: false,
        diagram,
        file,
    };
    persist(&directory(&app)?, &workspace)?;
    Ok(workspace)
}

#[tauri::command]
pub fn flow_project_link(
    app: AppHandle,
    id: Uuid,
    file: ProjectRef,
    diagram: Diagram,
) -> Result<()> {
    let _guard = CATALOG.lock().map_err(|_| catalog_error())?;
    let directory = directory(&app)?;
    let mut workspace = load(&directory, id)?;
    // An incoming edit can arrive while the file dialog is open.
    workspace.file_dirty = serde_json::to_value(&workspace.diagram).map_err(|_| catalog_error())?
        != serde_json::to_value(diagram).map_err(|_| catalog_error())?;
    workspace.file = Some(file);
    persist(&directory, &workspace)
}

#[tauri::command]
pub fn flow_project_remove(app: AppHandle, id: Uuid) -> Result<()> {
    let _guard = CATALOG.lock().map_err(|_| catalog_error())?;
    let directory = directory(&app)?;
    flow_access::remove(&directory, id)?;
    match fs::remove_file(path(&directory, id)) {
        Err(error) if error.kind() != ErrorKind::NotFound => Err(catalog_error()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn diagram(title: &str) -> Diagram {
        Diagram {
            title: title.to_owned(),
            summary: String::new(),
            nodes: Vec::new(),
            edges: Vec::new(),
            requirements: Vec::new(),
            open_questions: Vec::new(),
        }
    }

    #[test]
    fn updates_stay_in_the_selected_project() {
        let directory = tempfile::tempdir().unwrap();
        let id = Uuid::new_v4();
        let other = Uuid::new_v4();
        for id in [id, other] {
            persist(
                directory.path(),
                &Workspace {
                    id,
                    diagram: diagram("Original"),
                    file: None,
                    file_dirty: false,
                    returning_guest: false,
                },
            )
            .unwrap();
        }
        update(directory.path(), id, diagram("Alterado")).unwrap();
        let edited = load(directory.path(), id).unwrap();
        assert_eq!(edited.diagram.title, "Alterado");
        assert!(edited.file_dirty);
        assert_eq!(
            load(directory.path(), other).unwrap().diagram.title,
            "Original"
        );
    }
}
