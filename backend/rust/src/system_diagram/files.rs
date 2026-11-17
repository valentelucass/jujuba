use super::model::{invalid, Diagram};
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

const FORMAT: u32 = 1;
const FORMAT_WITH_NOTES: u32 = 2;
const MAX_IMAGE_SIZE: usize = 16 * 1024 * 1024;
const MAX_FILE: u64 = 512 * 1024;
const SUFFIX: &str = ".jujuba.json";
static SAVE: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
pub struct ProjectRef {
    pub path: String,
    revision: String,
}

#[derive(Serialize)]
pub struct Opened {
    pub project: ProjectRef,
    pub diagram: Diagram,
}

#[derive(Serialize, Deserialize)]
struct FileDiagram {
    format: u32,
    diagram: Diagram,
}

#[derive(Serialize, Deserialize)]
pub struct ProjectCode {
    pub files: Vec<CodeFile>,
}

#[derive(Serialize, Deserialize)]
pub struct CodeFile {
    pub path: String,
    pub content: String,
}

fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn open(path: &Path) -> Result<Opened> {
    let path = diagram_path(path)?;
    let bytes = read(&path)?;
    let contents: FileDiagram = serde_json::from_slice(&bytes)
        .map_err(|_| invalid("O arquivo não é um fluxograma do JujubaSQL válido."))?;
    if !matches!(contents.format, FORMAT | FORMAT_WITH_NOTES) {
        return Err(invalid(
            "O formato deste arquivo precisa de outra versão do JujubaSQL.",
        ));
    }
    contents.diagram.validate_draft()?;
    Ok(Opened {
        project: ProjectRef {
            path: path.to_string_lossy().into_owned(),
            revision: revision(&bytes),
        },
        diagram: contents.diagram,
    })
}

pub fn open_current(expected: &ProjectRef) -> Result<Opened> {
    let opened = open(Path::new(&expected.path))?;
    if opened.project.revision != expected.revision {
        return Err(changed());
    }
    Ok(opened)
}

pub fn save(path: &Path, expected: Option<ProjectRef>, diagram: Diagram) -> Result<ProjectRef> {
    diagram.validate_draft()?;
    let path = diagram_path(path)?;
    let bytes = serde_json::to_vec_pretty(&FileDiagram {
        format: if diagram.notes.is_empty() {
            FORMAT
        } else {
            FORMAT_WITH_NOTES
        },
        diagram,
    })
    .map_err(|_| file_error())?;
    let _guard = SAVE.lock().map_err(|_| file_error())?;
    if let Some(expected) = &expected {
        if Path::new(&expected.path) != path || revision(&read(&path)?) != expected.revision {
            return Err(changed());
        }
    }
    write(&path, &bytes, expected.is_some())?;
    Ok(ProjectRef {
        path: path.to_string_lossy().into_owned(),
        revision: revision(&bytes),
    })
}

pub fn export(path: &Path, diagram: Diagram) -> Result<()> {
    diagram.validate_draft()?;
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
    {
        return Err(invalid("Escolha um arquivo .md para a exportação."));
    }
    write(path, diagram.markdown().as_bytes(), true)
}

pub fn validate_png(bytes: &[u8]) -> Result<()> {
    if bytes.len() > MAX_IMAGE_SIZE || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(invalid("Não foi possível gerar uma imagem PNG válida."));
    }
    Ok(())
}

pub fn export_png(path: &Path, bytes: &[u8]) -> Result<()> {
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
    {
        return Err(invalid("Escolha um arquivo .png para a exportação."));
    }
    write(path, bytes, true)
}

fn diagram_path(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute()
        || !path
            .file_name()
            .and_then(|file| file.to_str())
            .is_some_and(|file| file.to_ascii_lowercase().ends_with(SUFFIX))
    {
        return Err(invalid("Escolha um arquivo com final .jujuba.json."));
    }
    Ok(path.to_owned())
}

fn read(path: &Path) -> Result<Vec<u8>> {
    let file = fs::File::open(path).map_err(|_| file_error())?;
    if !file.metadata().map_err(|_| file_error())?.is_file() {
        return Err(file_error());
    }
    let mut bytes = Vec::new();
    file.take(MAX_FILE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| file_error())?;
    if bytes.len() as u64 > MAX_FILE {
        return Err(invalid("O arquivo é grande demais para um fluxograma."));
    }
    Ok(bytes)
}

fn write(path: &Path, bytes: &[u8], replace: bool) -> Result<()> {
    let directory = path.parent().ok_or_else(file_error)?;
    let mut temp = tempfile::NamedTempFile::new_in(directory).map_err(|_| file_error())?;
    temp.write_all(bytes).map_err(|_| file_error())?;
    temp.as_file().sync_all().map_err(|_| file_error())?;
    if replace {
        temp.persist(path).map_err(|_| file_error())?;
    } else {
        temp.persist_noclobber(path).map_err(|failure| {
            if failure.error.kind() == std::io::ErrorKind::AlreadyExists {
                invalid("Já existe um fluxograma com esse nome. Abra-o ou escolha outro nome.")
            } else {
                file_error()
            }
        })?;
    }
    Ok(())
}

impl ProjectCode {
    pub fn validate(&self) -> Result<()> {
        let mut size = 0usize;
        let mut paths = HashSet::new();
        if self.files.is_empty() || self.files.len() > 32 {
            return Err(invalid(
                "A implementação precisa conter entre 1 e 32 arquivos.",
            ));
        }
        for file in &self.files {
            if !safe_relative_path(&file.path) || !paths.insert(file.path.to_ascii_lowercase()) {
                return Err(invalid(
                    "A implementação trouxe nomes de arquivo inválidos ou repetidos.",
                ));
            }
            size = size.saturating_add(file.content.len());
        }
        if size > 512 * 1024 {
            return Err(invalid("A implementação ultrapassou o limite de tamanho."));
        }
        if paths.iter().any(|path| {
            path.match_indices('/')
                .any(|(end, _)| paths.contains(&path[..end]))
        }) {
            return Err(invalid(
                "Um nome de arquivo da implementação também foi usado como pasta.",
            ));
        }
        Ok(())
    }

    pub fn save(&self, parent: &Path) -> Result<String> {
        self.validate()?;
        if !parent.is_absolute() || !parent.is_dir() {
            return Err(file_error());
        }
        for index in 1..=100 {
            let folder = if index == 1 {
                "sistema-gerado".into()
            } else {
                format!("sistema-gerado-{index}")
            };
            let folder = parent.join(folder);
            match fs::create_dir(&folder) {
                Ok(()) => {
                    if self.write_to(&folder).is_err() {
                        // This directory was reserved for this write operation.
                        let _ = fs::remove_dir_all(&folder);
                        return Err(file_error());
                    }
                    return Ok(folder.to_string_lossy().into_owned());
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => return Err(file_error()),
            }
        }
        Err(invalid("Escolha outra pasta para salvar a implementação."))
    }

    fn write_to(&self, root: &Path) -> std::io::Result<()> {
        for file in &self.files {
            let target = root.join(&file.path);
            let parent = target.parent().expect("validated relative path");
            fs::create_dir_all(parent)?;
            let mut out = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(target)?;
            out.write_all(file.content.as_bytes())?;
        }
        Ok(())
    }
}

fn safe_relative_path(path: &str) -> bool {
    if path.is_empty() || path.len() > 160 {
        return false;
    }
    path.split('/').all(|part| {
        let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        !part.is_empty()
            && part.len() <= 64
            && !part.ends_with('.')
            && part
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.'))
            && !matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            && !(base.len() == 4
                && (base.starts_with("COM") || base.starts_with("LPT"))
                && base.as_bytes()[3].is_ascii_digit())
            && !part.eq_ignore_ascii_case(".git")
    })
}

fn changed() -> AppError {
    invalid("O arquivo mudou no disco. Abra o fluxograma novamente para usar a versão atual.")
}
fn file_error() -> AppError {
    AppError::new(
        "file",
        "Não foi possível ler ou salvar o arquivo. Confira a pasta e suas permissões.",
    )
}
