use super::{choose, model::{invalid, Diagram}, workspaces};
use crate::error::Result;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{fs, io::{ErrorKind, Write}, path::{Path, PathBuf}, process::Stdio, time::Duration};
use tauri::{AppHandle, Manager, path::BaseDirectory};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};
use uuid::Uuid;

#[derive(Serialize, Deserialize)]
struct Link { key: Uuid, folder: String, title: String }

#[derive(Serialize, Deserialize)]
pub struct SourceArea { title: String, steps: Vec<String>, files: Vec<String> }

#[derive(Serialize, Deserialize)]
pub struct Answer {
    #[serde(flatten)]
    pub diagram: Diagram,
    areas: Vec<SourceArea>,
}

#[derive(Deserialize)]
struct Generation { answer: Answer, at: String }

#[derive(Serialize, Deserialize)]
struct Status { phase: String, message: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceView {
    folder: String,
    status: Status,
    updated_at: Option<String>,
    answer: Option<Answer>,
}

fn folder(dir: &Path) -> PathBuf { dir.join("sources") }
fn link_path(dir: &Path, id: Uuid) -> PathBuf { folder(dir).join(format!("{id}.link.json")) }
fn error() -> crate::error::AppError { invalid("Não foi possível acessar o vínculo do fluxograma com a pasta.") }

fn read<T: DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    match fs::File::open(path) {
        Ok(file) => serde_json::from_reader(std::io::BufReader::new(file)).map(Some).map_err(|_|error()),
        Err(e) if e.kind()==ErrorKind::NotFound => Ok(None),
        Err(_) => Err(error()),
    }
}
fn save(path: &Path, value: &impl Serialize) -> Result<()> {
    let parent=path.parent().ok_or_else(error)?;
    fs::create_dir_all(parent).map_err(|_|error())?;
    let mut tmp=tempfile::NamedTempFile::new_in(parent).map_err(|_|error())?;
    serde_json::to_writer(&mut tmp,value).map_err(|_|error())?;
    tmp.flush().map_err(|_|error())?;
    tmp.persist(path).map_err(|_|error())?;
    Ok(())
}
pub(super) fn detach(dir: &Path,id: Uuid) -> Result<()> {
    let target=link_path(dir,id);
    if let Some(link)=read::<Link>(&target)? {
        fs::remove_file(target).map_err(|_|error())?;
        for ext in ["result","status"] { let _=fs::remove_file(folder(dir).join(format!("{}.{ext}.json",link.key))); }
    }
    Ok(())
}
pub(super) fn bind(dir: &Path,id: Uuid,title: &str,source: &str) -> Result<()> {
    let path=Path::new(source.trim());
    if !path.is_absolute() || !path.is_dir() || path.parent().is_none() {
        return Err(invalid("Escolha a pasta de um projeto existente."));
    }
    let path=path.canonicalize().map_err(|_|error())?;
    let label=if let Some(unc)=path.to_string_lossy().strip_prefix(r"\\?\UNC\") { format!(r"\\{unc}") }
        else { path.to_string_lossy().trim_start_matches(r"\\?\").to_owned() };
    let target=link_path(dir,id);
    let old=read::<Link>(&target)?;
    if old.as_ref().is_some_and(|l|l.folder.eq_ignore_ascii_case(&label)) { return Ok(()) }
    let link=Link{key:Uuid::new_v4(),folder:label,title:title.to_owned()};
    save(&target,&link)?;
    if let Some(old)=old { for ext in ["result","status"] { let _=fs::remove_file(folder(dir).join(format!("{}.{ext}.json",old.key))); } }
    Ok(())
}

#[tauri::command]
pub async fn flow_source_pick(app: AppHandle) -> Result<Option<String>> {
    let dialog=app.dialog().file().set_title("Escolha a pasta do código deste projeto");
    Ok(choose(dialog, FileDialogBuilder::pick_folder).await?.map(|p|p.to_string_lossy().into_owned()))
}
#[tauri::command]
pub fn flow_source_bind(app: AppHandle,id: Uuid,source: Option<String>) -> Result<()> {
    let dir=workspaces::directory(&app)?;
    let workspace=workspaces::load(&dir,id)?;
    if let Some(source)=source { bind(&dir,id,&workspace.diagram.title,&source) } else {detach(&dir,id)}
}
fn generation(dir: &Path,link:&Link) -> Result<Option<Generation>> {
    read(&folder(dir).join(format!("{}.result.json",link.key)))
}
pub(super) fn preview(dir:&Path,id:Uuid) -> Option<Diagram> {
    let link=read::<Link>(&link_path(dir,id)).ok()??;
    generation(dir,&link).ok()?.map(|g|g.answer.diagram)
}
#[tauri::command]
pub fn flow_source_view(app: AppHandle,id: Uuid) -> Result<Option<SourceView>> {
    let dir=workspaces::directory(&app)?;
    let Some(link)=read::<Link>(&link_path(&dir,id))? else {return Ok(None)};
    let status=read(&folder(&dir).join(format!("{}.status.json",link.key)))?
        .unwrap_or(Status{phase:"pending".into(),message:"Atualização agendada.".into()});
    let generation=generation(&dir,&link)?;
    let (updated_at,answer)=generation.map(|g|(Some(g.at),Some(g.answer))).unwrap_or_default();
    Ok(Some(SourceView{folder:link.folder,status,updated_at,answer}))
}

pub async fn monitor(app: AppHandle,dir: PathBuf) {
    let Ok(script)=app.path().resolve("resources/source-worker.mjs",BaseDirectory::Resource) else {return};
    let root=folder(&dir);
    loop {
        if let Ok(items)=fs::read_dir(&root) {
            for entry in items.flatten() {
                let name=entry.file_name();
                let Some(id)=name.to_str().and_then(|s|s.strip_suffix(".link.json")).and_then(|s|Uuid::parse_str(s).ok()) else {continue};
                if !dir.join(format!("{id}.json")).is_file() {continue}
                let Ok(Some(link))=read::<Link>(&entry.path()) else {continue};
                let status_path=root.join(format!("{}.status.json",link.key));
                if read::<Status>(&status_path).ok().flatten().is_some_and(|s|s.phase=="error")
                    && fs::metadata(&status_path).and_then(|m|m.modified()).ok().and_then(|t|t.elapsed().ok()).is_some_and(|d|d<Duration::from_secs(300)) {continue}
                let mut command=tokio::process::Command::new("node");
                #[cfg(windows)]
                command.creation_flags(0x08000000);
                let result=command.arg(&script).arg(&root).arg(id.to_string()).current_dir(&root)
                    .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).kill_on_drop(true).status().await;
                if result.is_err() {
                    let _=save(&status_path,&Status{phase:"error".into(),message:"Instale o Node.js 22 ou superior para acompanhar a pasta.".into()});
                } else if result.is_ok_and(|status|!status.success()) && !read::<Status>(&status_path).ok().flatten().is_some_and(|s|s.phase=="error") {
                    let _=save(&status_path,&Status{phase:"error".into(),message:"Não foi possível executar a leitura da pasta. Confira a instalação do JUJUBA e do Node.js.".into()});
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(30)).await;
    }
}
