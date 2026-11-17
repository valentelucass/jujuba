use iroh::{EndpointId, SecretKey};
use serde::{Deserialize, Serialize};
use std::{fs, io::ErrorKind, path::Path};
use uuid::Uuid;

use super::model::invalid;
use crate::error::Result;

#[derive(Serialize, Deserialize)]
pub(super) struct Sharing {
    pub key: [u8; 32],
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    guest: Option<Guest>,
    #[serde(default)]
    pub guests: Vec<Guest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub invitation: Option<StoredInvitation>,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
pub(super) struct StoredInvitation {
    pub token: Uuid,
    pub expires_at: u64,
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Guest {
    pub id: EndpointId,
    pub name: String,
    pub ticket: Uuid,
}

impl Sharing {
    pub fn new(name: String) -> Self {
        Self {
            key: SecretKey::generate().to_bytes(),
            name,
            guest: None,
            guests: Vec::new(),
            invitation: None,
        }
    }
}

pub(super) fn read(directory: &Path, project: Uuid) -> Result<Option<Sharing>> {
    let mut saved: Option<Sharing> = read_json(&directory.join(format!("{project}.sharing")))?;
    if let Some(sharing) = &mut saved {
        if let Some(guest) = sharing.guest.take() {
            if !sharing.guests.iter().any(|entry| entry.id == guest.id) {
                sharing.guests.push(guest);
            }
        }
    }
    Ok(saved)
}

pub(super) fn write(directory: &Path, project: Uuid, sharing: &Sharing) -> Result<()> {
    write_json(&directory.join(format!("{project}.sharing")), sharing)
}

pub(super) fn remove(directory: &Path, project: Uuid) -> Result<()> {
    match fs::remove_file(directory.join(format!("{project}.sharing"))) {
        Err(error) if error.kind() != ErrorKind::NotFound => Err(access_error()),
        _ => Ok(()),
    }
}

pub(super) fn guest_key(directory: &Path) -> Result<SecretKey> {
    let path = directory.join("guest-identity");
    if let Some(bytes) = read_json::<[u8; 32]>(&path)? {
        return Ok(SecretKey::from_bytes(&bytes));
    }
    let key = SecretKey::generate();
    write_json(&path, &key.to_bytes())?;
    Ok(key)
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| access_error()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(_) => Err(access_error()),
    }
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let directory = path.parent().ok_or_else(access_error)?;
    let mut tempfile = tempfile::NamedTempFile::new_in(directory).map_err(|_| access_error())?;
    serde_json::to_writer(&mut tempfile, value).map_err(|_| access_error())?;
    tempfile.persist(path).map_err(|_| access_error())?;
    Ok(())
}

fn access_error() -> crate::error::AppError {
    invalid("Não foi possível acessar as autorizações do fluxograma.")
}
