use super::{
    flow_access::{self, Guest, Sharing, StoredInvitation},
    flow_mascot::{Mascot, Meeting, Splat},
    flow_merge::merge,
    model::{invalid, Diagram, Position},
    workspaces,
};
use crate::error::{AppError, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use iroh::{
    endpoint::{presets, Connection, RecvStream, SendStream},
    Endpoint, EndpointAddr, EndpointId, SecretKey,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    future::Future,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, State};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{mpsc, oneshot, watch},
    task::{AbortHandle, JoinSet},
    time::{sleep_until, timeout, Instant},
};
use uuid::Uuid;

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const ALPN: &[u8] = b"jujubasql/flow/4";
const INVITATION_LIFETIME: Duration = Duration::from_secs(600);
const APPROVAL_TIME: Duration = Duration::from_secs(120);
const DIAL_TIME: Duration = Duration::from_secs(25);
const IO_TIME: Duration = Duration::from_secs(8);
const CLOSE_TIME: Duration = Duration::from_millis(1200);
const MAX_FRAME: usize = 256 * 1024;
const MAX_PENDING: usize = 128;

#[derive(Default)]
pub struct FlowCollaboration(Mutex<Sessions>);

#[derive(Default)]
struct Sessions {
    entries: HashMap<Option<Uuid>, Session>,
    closing: bool,
}

struct Session {
    id: Uuid,
    view: Arc<Mutex<View>>,
    tx: mpsc::Sender<Request>,
    task: AbortHandle,
}

impl Drop for Session {
    fn drop(&mut self) {
        self.task.abort();
        change(&self.view, |view| view.phase = Phase::Ended);
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Phase {
    Starting,
    Available,
    Inviting,
    Joining,
    Approval,
    Connected,
    Ended,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    id: Uuid,
    project_id: Option<Uuid>,
    phase: Phase,
    code: Option<String>,
    peer: Option<String>,
    peer_version: Option<String>,
    can_edit: bool,
    cursor: Option<Position>,
    mascot_supported: bool,
    mascot_version: u64,
    mascot: Option<Mascot>,
    mascot_meeting: Option<Meeting>,
    mascot_splats: VecDeque<Splat>,
    diagram: Option<Arc<Diagram>>,
    revision: u64,
    message: Option<String>,
    trusted_peer: Option<String>,
    return_code: Option<String>,
    live_version: u64,
    #[serde(skip)]
    updates: watch::Sender<u64>,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum ViewUpdate {
    Unchanged {
        id: Uuid,
        unchanged: bool,
        #[serde(rename = "liveVersion")]
        live_version: u64,
    },
    Full(View),
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Packet {
    Bye,
    Hello {
        name: String,
        token: [u8; 16],
        #[serde(default)]
        mascots: bool,
        #[serde(default)]
        version: Option<String>,
    },
    RoomVersion {
        name: String,
        version: String,
    },
    Accepted {
        name: String,
        diagram: Diagram,
        return_code: Option<String>,
        #[serde(default)]
        mascots: bool,
        #[serde(default)]
        version: Option<String>,
    },
    Rejected,
    Snapshot {
        diagram: Diagram,
        acknowledged: u64,
    },
    Edit {
        before: Diagram,
        diagram: Diagram,
    },
    Cursor {
        position: Option<Position>,
    },
    Mascot {
        mascot: Option<Mascot>,
    },
    MascotMeeting {
        meeting: Meeting,
    },
    MascotSplat {
        splat: Splat,
    },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Command {
    End,
    Accept { remember: bool },
    Reject,
    Invite,
    Revoke,
    Cursor { position: Option<Position> },
    Mascot { mascot: Option<Mascot> },
    MascotMeeting { meeting: Meeting },
    MascotSplat { splat: Splat },
    Edit { before: Diagram, diagram: Diagram },
}

struct Request {
    command: Command,
    response: oneshot::Sender<Result<()>>,
}

type Inbox = mpsc::Receiver<Request>;

#[derive(Clone)]
struct SharedProject {
    id: Uuid,
    directory: PathBuf,
}

struct Visitor {
    name: String,
    token: [u8; 16],
    mascots: bool,
    version: Option<String>,
}

enum Approval {
    Accepted { remember: bool },
    Rejected,
    Interrupted,
}

impl Sessions {
    fn active_host(&self, project: Uuid) -> Result<Option<View>> {
        let Some(session) = self.entries.get(&Some(project)) else {
            return Ok(None);
        };
        let view = session.view.lock().map_err(|_| unavailable())?;
        Ok((view.phase != Phase::Ended).then(|| view.clone()))
    }

    fn start<F, Fut>(&mut self, project: Option<Uuid>, run: F) -> Result<View>
    where
        F: FnOnce(Arc<Mutex<View>>, Inbox) -> Fut,
        Fut: Future<Output = Result<()>> + Send + 'static,
    {
        if self.closing {
            return Err(disconnected());
        }
        if let Some(session) = self.entries.get(&project) {
            let view = session.view.lock().map_err(|_| unavailable())?;
            if view.phase != Phase::Ended {
                return Err(invalid("Encerre a sessão atual antes de iniciar outra."));
            }
        }

        let initial = View {
            id: Uuid::new_v4(),
            project_id: project,
            phase: Phase::Starting,
            code: None,
            peer: None,
            peer_version: None,
            can_edit: false,
            cursor: None,
            mascot_supported: false,
            mascot_version: 0,
            mascot: None,
            mascot_meeting: None,
            mascot_splats: VecDeque::new(),
            diagram: None,
            revision: 0,
            message: None,
            trusted_peer: None,
            return_code: None,
            live_version: 0,
            updates: watch::channel(0).0,
        };
        let view = Arc::new(Mutex::new(initial.clone()));
        let (tx, rx) = mpsc::channel(24);
        let operation = run(view.clone(), rx);
        let state = view.clone();
        let task = tokio::spawn(async move {
            let result = operation.await;
            change(&state, |view| {
                view.phase = Phase::Ended;
                view.can_edit = false;
                view.code = None;
                view.cursor = None;
                view.mascot = None;
                view.mascot_meeting = None;
                view.mascot_splats.clear();
                view.mascot_supported = false;
                view.message = Some(
                    result
                        .err()
                        .unwrap_or_else(disconnected)
                        .message
                        .into_owned(),
                );
            });
        });
        self.entries.insert(
            project,
            Session {
                id: initial.id,
                view,
                tx,
                task: task.abort_handle(),
            },
        );
        Ok(initial)
    }

    fn find(&self, id: Uuid) -> Option<&Session> {
        self.entries.values().find(|session| session.id == id)
    }
}

impl FlowCollaboration {
    fn start<F, Fut>(&self, project: Option<Uuid>, run: F) -> Result<View>
    where
        F: FnOnce(Arc<Mutex<View>>, Inbox) -> Fut,
        Fut: Future<Output = Result<()>> + Send + 'static,
    {
        self.0
            .lock()
            .map_err(|_| unavailable())?
            .start(project, run)
    }

    fn sender(&self, id: Uuid) -> Result<mpsc::Sender<Request>> {
        let guard = self.0.lock().map_err(|_| unavailable())?;
        let session = guard.find(id).ok_or_else(disconnected)?;
        Ok(session.tx.clone())
    }

    fn end(&self, id: Uuid) -> Result<()> {
        let mut guard = self.0.lock().map_err(|_| unavailable())?;
        guard.entries.retain(|_, session| session.id != id);
        Ok(())
    }

    fn view(&self, id: Uuid) -> Result<Option<Arc<Mutex<View>>>> {
        let guard = self.0.lock().map_err(|_| unavailable())?;
        Ok(guard.find(id).map(|session| session.view.clone()))
    }

    pub fn begin_shutdown(&self) -> bool {
        let Ok(mut sessions) = self.0.lock() else {
            return true;
        };
        let first = !sessions.closing;
        sessions.closing = true;
        first
    }

    pub async fn shutdown(&self) {
        let mut requests = JoinSet::new();
        if let Ok(sessions) = self.0.lock() {
            for session in sessions.entries.values() {
                let sender = session.tx.clone();
                requests.spawn(async move {
                    let _ = submit(sender, Command::End).await;
                });
            }
        }
        let _ = timeout(CLOSE_TIME, async {
            while requests.join_next().await.is_some() {}
        })
        .await;
        if let Ok(mut sessions) = self.0.lock() {
            sessions.entries.clear();
        }
    }

    async fn next_view(
        &self,
        id: Uuid,
        seen: u64,
        known: Option<u64>,
    ) -> Result<Option<ViewUpdate>> {
        let Some(state) = self.view(id)? else {
            return Ok(None);
        };
        let mut updates = {
            let view = state.lock().map_err(|_| unavailable())?;
            if view.phase == Phase::Ended
                || known != Some(view.live_version)
                || seen != view.revision
            {
                return Ok(Some(snapshot(&view, seen)));
            }
            view.updates.subscribe()
        };
        let _ = timeout(Duration::from_millis(600), updates.changed()).await;
        let Some(state) = self.view(id)? else {
            return Ok(None);
        };
        let view = state.lock().map_err(|_| unavailable())?;
        if view.phase != Phase::Ended && known == Some(view.live_version) && seen == view.revision {
            return Ok(Some(ViewUpdate::Unchanged {
                id,
                unchanged: true,
                live_version: view.live_version,
            }));
        }
        Ok(Some(snapshot(&view, seen)))
    }
}

fn snapshot(view: &View, seen: u64) -> ViewUpdate {
    let mut view = view.clone();
    if view.revision == seen {
        view.diagram = None;
    }
    ViewUpdate::Full(view)
}

fn change(state: &Mutex<View>, update: impl FnOnce(&mut View)) {
    if let Ok(mut view) = state.lock() {
        update(&mut view);
        view.live_version = view.live_version.wrapping_add(1);
        view.updates.send_replace(view.live_version);
    }
}

async fn endpoint(host: bool, key: SecretKey) -> Result<Endpoint> {
    let mut builder = Endpoint::builder(presets::N0).secret_key(key);
    if host {
        builder = builder.alpns(vec![ALPN.to_vec()]);
    }
    builder.bind().await.map_err(|_| unavailable())
}

fn encode(id: EndpointId, token: Uuid) -> String {
    let mut bytes = [0; 48];
    bytes[..32].copy_from_slice(id.as_bytes());
    bytes[32..].copy_from_slice(token.as_bytes());
    URL_SAFE_NO_PAD.encode(bytes)
}

fn decode(code: &str) -> Result<(EndpointId, [u8; 16])> {
    let bad_code = || invalid("Confira o código do convite.");
    if code.trim().len() != 64 {
        return Err(bad_code());
    }
    let mut bytes = [0; 48];
    URL_SAFE_NO_PAD
        .decode_slice(code.trim(), &mut bytes)
        .map_err(|_| bad_code())?;
    let (id, token) = bytes.split_at(32);
    let id =
        EndpointId::from_bytes(&id.try_into().map_err(|_| bad_code())?).map_err(|_| bad_code())?;
    Ok((id, token.try_into().map_err(|_| bad_code())?))
}

fn alias(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 32 || name.chars().any(char::is_control) {
        return Err(invalid("Digite um nome de até 32 caracteres."));
    }
    Ok(name.to_owned())
}

async fn host(
    endpoint: Endpoint,
    mut sharing: Sharing,
    mut diagram: Diagram,
    project: SharedProject,
    mut invitation: Option<(Uuid, Instant)>,
    state: Arc<Mutex<View>>,
    mut commands: Inbox,
) -> Result<()> {
    loop {
        idle_view(&state, &endpoint, &sharing, invitation);
        let mut next = std::pin::pin!(incoming(&endpoint));
        let attempt = loop {
            let expires = invitation.map(|(_, expires)| expires);
            tokio::select! {
                result = &mut next => break result?,
                _ = wait_for_expiry(expires), if expires.is_some() => {
                    invitation = None;
                    idle_view(&state, &endpoint, &sharing, invitation);
                }
                request = commands.recv() => {
                    let request = request.ok_or_else(disconnected)?;
                    let result = match request.command {
                        Command::Invite => {
                            record_invitation(&project, &mut sharing, Some(new_invitation())).map(|next| {
                                invitation = next;
                                idle_view(&state, &endpoint, &sharing, invitation);
                            })
                        }
                        Command::Revoke => revoke(&project, &mut sharing, &state),
                        Command::End => {
                            let _ = request.response.send(Ok(()));
                            return Ok(());
                        }
                        Command::Edit { before, diagram: after } =>
                            apply_edit(&state, Some(&project), &mut diagram, &before, &after),
                        _ => Err(operation_unavailable()),
                    };
                    let _ = request.response.send(result);
                }
            }
        };
        let (
            connection,
            mut send,
            mut recv,
            Visitor {
                name: peer,
                token: candidate,
                mascots,
                version,
            },
        ) = attempt;
        let peer_id = connection.remote_id();
        let saved = sharing
            .guest
            .as_ref()
            .filter(|guest| guest.id == peer_id && matches_token(candidate, guest.ticket));
        let return_code = if let Some(guest) = saved {
            if announce_room(&mut send, &sharing.name, version.is_some())
                .await
                .is_err()
            {
                continue;
            }
            change(&state, |view| {
                view.peer = Some(guest.name.clone());
                view.peer_version.clone_from(&version);
            });
            Some(encode(endpoint.id(), guest.ticket))
        } else if invitation.is_some_and(|(token, expiry)| {
            Instant::now() < expiry && matches_token(candidate, token)
        }) {
            if announce_room(&mut send, &sharing.name, version.is_some())
                .await
                .is_err()
            {
                continue;
            }
            change(&state, |view| {
                view.phase = Phase::Approval;
                view.peer_version.clone_from(&version);
                view.peer = Some(peer.clone());
                view.code = None;
            });
            let remember =
                match approve(&connection, &mut commands, &state, &project, &mut diagram).await {
                    Approval::Accepted { remember } => {
                        invitation = record_invitation(&project, &mut sharing, None)?;
                        remember
                    }
                    Approval::Rejected => {
                        invitation = record_invitation(&project, &mut sharing, None)?;
                        reject(connection, send);
                        continue;
                    }
                    Approval::Interrupted => {
                        reject(connection, send);
                        continue;
                    }
                };
            if remember {
                let ticket = Uuid::new_v4();
                let previous = sharing.guest.replace(Guest {
                    id: peer_id,
                    name: peer,
                    ticket,
                });
                if flow_access::write(&project.directory, project.id, &sharing).is_ok() {
                    change(&state, |view| {
                        view.trusted_peer = sharing.guest.as_ref().map(|guest| guest.name.clone())
                    });
                    Some(encode(endpoint.id(), ticket))
                } else {
                    sharing.guest = previous;
                    change(&state, |view| {
                        view.message =
                            Some("A pessoa entrou, mas não foi possível salvar o acesso.".into())
                    });
                    None
                }
            } else {
                None
            }
        } else {
            reject(connection, send);
            continue;
        };
        if send_packet(
            &mut send,
            Packet::Accepted {
                name: sharing.name.clone(),
                diagram: diagram.clone(),
                return_code,
                mascots,
                version: Some(APP_VERSION.into()),
            },
        )
        .await
        .is_err()
        {
            continue;
        }

        let result = connected(
            &mut send,
            &mut recv,
            &state,
            &mut commands,
            &mut diagram,
            mascots,
            Some((&project, &mut sharing)),
        )
        .await;
        if result.is_ok_and(|ended_here| ended_here) {
            return Ok(());
        }
        // Keep the project's listener available when a guest leaves.
    }
}

fn new_invitation() -> (Uuid, Instant) {
    (Uuid::new_v4(), Instant::now() + INVITATION_LIFETIME)
}

fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn record_invitation(
    project: &SharedProject,
    sharing: &mut Sharing,
    invitation: Option<(Uuid, Instant)>,
) -> Result<Option<(Uuid, Instant)>> {
    let previous = sharing.invitation;
    sharing.invitation = invitation.map(|(token, deadline)| StoredInvitation {
        token,
        expires_at: unix_millis()
            + deadline
                .saturating_duration_since(Instant::now())
                .as_millis() as u64,
    });
    if let Err(error) = flow_access::write(&project.directory, project.id, sharing) {
        sharing.invitation = previous;
        return Err(error);
    }
    Ok(invitation)
}

fn restore_invitation(sharing: &Sharing) -> Option<(Uuid, Instant)> {
    let invitation = sharing.invitation?;
    let remaining = invitation.expires_at.checked_sub(unix_millis())?;
    if remaining == 0 || remaining > INVITATION_LIFETIME.as_millis() as u64 {
        return None;
    }
    Some((
        invitation.token,
        Instant::now() + Duration::from_millis(remaining),
    ))
}

fn valid_version(version: &str) -> bool {
    version.len() <= 24
        && version.split('.').count() == 3
        && version.split('.').all(|part| {
            !part.is_empty()
                && part.bytes().all(|c| c.is_ascii_digit())
                && part.parse::<u32>().is_ok()
        })
}

async fn announce_room(send: &mut SendStream, name: &str, versioned: bool) -> Result<()> {
    if versioned {
        send_packet(
            send,
            Packet::RoomVersion {
                name: name.into(),
                version: APP_VERSION.into(),
            },
        )
        .await?;
    }
    Ok(())
}

fn idle_view(
    state: &Mutex<View>,
    endpoint: &Endpoint,
    sharing: &Sharing,
    invitation: Option<(Uuid, Instant)>,
) {
    change(state, |view| {
        view.phase = if invitation.is_some() {
            Phase::Inviting
        } else {
            Phase::Available
        };
        view.code = invitation.map(|(token, _)| encode(endpoint.id(), token));
        view.peer = None;
        view.peer_version = None;
        view.cursor = None;
        view.mascot = None;
        view.mascot_meeting = None;
        view.mascot_splats.clear();
        view.mascot_supported = false;
        view.can_edit = true;
        view.trusted_peer = sharing.guest.as_ref().map(|guest| guest.name.clone());
    });
}

async fn wait_for_expiry(expires: Option<Instant>) {
    if let Some(expires) = expires {
        sleep_until(expires).await;
    }
}

async fn approve(
    connection: &Connection,
    commands: &mut Inbox,
    state: &Mutex<View>,
    project: &SharedProject,
    diagram: &mut Diagram,
) -> Approval {
    let expires = Instant::now() + APPROVAL_TIME;
    loop {
        let request = tokio::select! {
            _ = connection.closed() => return Approval::Interrupted,
            _ = sleep_until(expires) => return Approval::Interrupted,
            request = commands.recv() => match request {
                Some(request) => request,
                None => return Approval::Interrupted,
            },
        };
        let result = match request.command {
            Command::Accept { remember } => {
                let _ = request.response.send(Ok(()));
                return Approval::Accepted { remember };
            }
            Command::Reject => {
                let _ = request.response.send(Ok(()));
                return Approval::Rejected;
            }
            Command::Edit {
                before,
                diagram: after,
            } => apply_edit(state, Some(project), diagram, &before, &after),
            _ => Err(operation_unavailable()),
        };
        let _ = request.response.send(result);
    }
}

fn revoke(project: &SharedProject, sharing: &mut Sharing, state: &Mutex<View>) -> Result<()> {
    let previous = sharing.guest.take();
    if let Err(error) = flow_access::write(&project.directory, project.id, sharing) {
        sharing.guest = previous;
        return Err(error);
    }
    change(state, |view| view.trusted_peer = None);
    Ok(())
}

fn reject(connection: Connection, mut send: SendStream) {
    tokio::spawn(async move {
        let _ = send_packet(&mut send, Packet::Rejected).await;
        let _ = send.finish();
        let _ = timeout(IO_TIME, send.stopped()).await;
        drop(connection);
    });
}

fn matches_token(candidate: [u8; 16], token: Uuid) -> bool {
    candidate
        .iter()
        .zip(token.as_bytes())
        .fold(0, |diff, (a, b)| diff | (a ^ b))
        == 0
}

async fn incoming(endpoint: &Endpoint) -> Result<(Connection, SendStream, RecvStream, Visitor)> {
    while let Some(incoming) = endpoint.accept().await {
        let attempt = timeout(IO_TIME, async {
            let connection = incoming.await.map_err(|_| unavailable())?;
            let (send, mut recv) = connection.accept_bi().await.map_err(|_| unavailable())?;
            let Packet::Hello {
                name,
                token,
                mascots,
                version,
            } = read_packet(&mut recv).await?
            else {
                return Err(unavailable());
            };
            Ok((
                connection,
                send,
                recv,
                Visitor {
                    name: alias(&name)?,
                    token,
                    mascots,
                    version: version.filter(|value| valid_version(value)),
                },
            ))
        })
        .await;
        if let Ok(Ok(attempt)) = attempt {
            return Ok(attempt);
        }
    }
    Err(disconnected())
}

async fn join(
    endpoint: Endpoint,
    address: EndpointAddr,
    token: [u8; 16],
    name: String,
    state: Arc<Mutex<View>>,
    mut commands: Inbox,
) -> Result<()> {
    let (_connection, mut send, mut recv) = timeout(DIAL_TIME, async {
        let connection = endpoint
            .connect(address, ALPN)
            .await
            .map_err(|_| unavailable())?;
        let (mut send, recv) = connection.open_bi().await.map_err(|_| unavailable())?;
        send_packet(
            &mut send,
            Packet::Hello {
                name,
                token,
                mascots: true,
                version: Some(APP_VERSION.into()),
            },
        )
        .await?;
        Ok::<_, AppError>((connection, send, recv))
    })
    .await
    .map_err(|_| unavailable())??;
    change(&state, |view| view.phase = Phase::Joining);
    let deadline = Instant::now() + APPROVAL_TIME;
    let mut answer = tokio::time::timeout_at(deadline, read_packet(&mut recv)).await;
    if let Ok(Ok(Packet::RoomVersion { name, version })) = &answer {
        let peer = alias(name)?;
        change(&state, |view| {
            view.peer = Some(peer);
            view.peer_version = valid_version(version).then(|| version.clone());
        });
        answer = tokio::time::timeout_at(deadline, read_packet(&mut recv)).await;
    }
    let (name, mut diagram, return_code, mascots, version) = match answer {
        Ok(Ok(Packet::Accepted {
            name,
            diagram,
            return_code,
            mascots,
            version,
        })) => (alias(&name)?, diagram, return_code, mascots, version),
        Ok(Ok(Packet::Rejected)) => {
            return Err(AppError::new(
                "declined",
                "O código ou o acesso salvo não está disponível neste projeto.",
            ))
        }
        _ => {
            return Err(AppError::new(
                "approval",
                "O convite foi encerrado ou expirou.",
            ))
        }
    };
    diagram.validate_draft()?;
    change(&state, |view| {
        view.peer = Some(name);
        if let Some(version) = version.filter(|value| valid_version(value)) {
            view.peer_version = Some(version);
        }
        view.return_code = return_code;
        view.diagram = Some(Arc::new(diagram.clone()));
        view.revision += 1;
    });

    let result = connected(
        &mut send,
        &mut recv,
        &state,
        &mut commands,
        &mut diagram,
        mascots,
        None,
    )
    .await;
    endpoint.close().await;
    result.map(|_| ())
}

async fn connected(
    send: &mut SendStream,
    recv: &mut RecvStream,
    state: &Mutex<View>,
    commands: &mut Inbox,
    diagram: &mut Diagram,
    mascots: bool,
    mut owner: Option<(&SharedProject, &mut Sharing)>,
) -> Result<bool> {
    change(state, |view| {
        view.phase = Phase::Connected;
        view.mascot_supported = mascots;
        view.can_edit = true;
        view.code = None;
    });
    let rich_mascots = mascots
        && state
            .lock()
            .map_err(|_| unavailable())?
            .peer_version
            .is_some();
    let mut acknowledged = 0;
    let mut sequence = 0;
    let mut pending = VecDeque::new();
    loop {
        // Keep the read future alive while local commands run so partial frames are retained.
        let mut packet = std::pin::pin!(read_packet(recv));
        let received = loop {
            tokio::select! {
                incoming = &mut packet => break incoming?,
                request = commands.recv() => {
                    let request = request.ok_or_else(disconnected)?;
                    let result = match request.command {
                        Command::End => {
                            let result = send_packet(send, Packet::Bye).await;
                            let _ = send.finish();
                            let _ = timeout(Duration::from_millis(500), send.stopped()).await;
                            let _ = request.response.send(result);
                            return Ok(true);
                        }
                        Command::Edit { before, diagram: after } => {
                            if let Some((project, _)) = owner.as_ref() {
                                match apply_edit(state, Some(project), diagram, &before, &after) {
                                    Ok(()) => send_packet(send, Packet::Snapshot { diagram: diagram.clone(), acknowledged }).await,
                                    Err(error) => Err(error),
                                }
                            } else if pending.len() >= MAX_PENDING {
                                Err(invalid("Aguarde a sincronização para continuar editando."))
                            } else {
                                match apply_edit(state, None, diagram, &before, &after) {
                                    Ok(()) => {
                                        let message = Packet::Edit { before: before.clone(), diagram: after.clone() };
                                        sequence += 1;
                                        pending.push_back((sequence, before, after));
                                        send_packet(send, message).await
                                    }
                                    Err(error) => Err(error),
                                }
                            }
                        }
                        Command::Revoke => match owner.as_mut() {
                            Some((project, sharing)) => revoke(project, sharing, state),
                            None => Err(operation_unavailable()),
                        },
                        Command::Mascot { mascot } if mascots && mascot.as_ref().is_none_or(Mascot::valid) =>
                            send_packet(send, Packet::Mascot { mascot }).await,
                        Command::MascotSplat { splat } if rich_mascots && splat.valid() =>
                            send_packet(send, Packet::MascotSplat { splat }).await,
                        Command::MascotMeeting { meeting } if mascots && meeting.valid() =>
                            send_packet(send, Packet::MascotMeeting { meeting }).await,
                        Command::Cursor { position } if valid_position(position) =>
                            send_packet(send, Packet::Cursor { position }).await,
                        _ => Err(operation_unavailable()),
                    };
                    let lost = result.as_ref().err().is_some_and(|error| error.kind == "collaboration");
                    let _ = request.response.send(result);
                    if lost {
                        return Err(disconnected());
                    }
                }
            }
        };
        match received {
            Packet::Bye => return Ok(false),
            Packet::Mascot { mascot } if mascots => {
                if mascot.as_ref().is_none_or(Mascot::valid) {
                    change(state, |view| {
                        if mascot.is_none() {
                            view.mascot_meeting = None;
                            view.mascot_splats.clear();
                        }
                        view.mascot = mascot;
                        view.mascot_version += 1;
                    });
                }
            }
            Packet::MascotSplat { splat } if rich_mascots => {
                if splat.valid() {
                    change(state, |view| {
                        if view.mascot.is_some() {
                            if view.mascot_splats.len() >= 16 {
                                view.mascot_splats.pop_front();
                            }
                            view.mascot_splats.push_back(splat);
                            view.mascot_version += 1;
                        }
                    });
                }
            }
            Packet::MascotMeeting { meeting } if mascots => {
                if meeting.valid() {
                    change(state, |view| {
                        if view.mascot.is_some() {
                            view.mascot_meeting = Some(meeting);
                            view.mascot_version += 1;
                        }
                    });
                }
            }
            Packet::Cursor { position } if valid_position(position) => {
                change(state, |view| view.cursor = position);
            }
            Packet::Edit {
                before,
                diagram: after,
            } if owner.is_some() => {
                let project = owner.as_ref().map(|(project, _)| *project);
                apply_edit(state, project, diagram, &before, &after)?;
                acknowledged += 1;
                send_packet(
                    send,
                    Packet::Snapshot {
                        diagram: diagram.clone(),
                        acknowledged,
                    },
                )
                .await?;
            }
            Packet::Snapshot {
                diagram: mut next,
                acknowledged,
            } if owner.is_none() => {
                next.validate_draft()?;
                pending.retain(|(sequence, _, _)| *sequence > acknowledged);
                for (_, before, after) in &pending {
                    merge(&mut next, before, after);
                }
                *diagram = next;
                publish(state, diagram);
            }
            _ => {
                return Err(AppError::new(
                    "protocol",
                    "O outro aplicativo enviou uma mensagem inesperada.",
                ))
            }
        }
    }
}

fn apply_edit(
    state: &Mutex<View>,
    project: Option<&SharedProject>,
    diagram: &mut Diagram,
    before: &Diagram,
    after: &Diagram,
) -> Result<()> {
    before.validate_draft()?;
    after.validate_draft()?;
    let mut next = diagram.clone();
    merge(&mut next, before, after);
    if let Some(project) = project {
        workspaces::update(&project.directory, project.id, next.clone())?;
    }
    *diagram = next;
    publish(state, diagram);
    Ok(())
}

fn publish(state: &Mutex<View>, diagram: &Diagram) {
    change(state, |view| {
        view.revision += 1;
        view.diagram = Some(Arc::new(diagram.clone()));
    });
}

fn operation_unavailable() -> AppError {
    invalid("A ação não está disponível nesta sessão.")
}

fn valid_position(position: Option<Position>) -> bool {
    position.is_none_or(|point| point.x.abs() <= 1_000_000.0 && point.y.abs() <= 1_000_000.0)
}

async fn read_packet(recv: &mut RecvStream) -> Result<Packet> {
    let size = recv.read_u32().await.map_err(|_| disconnected())? as usize;
    if size == 0 || size > MAX_FRAME {
        return Err(unavailable());
    }
    let mut bytes = vec![0; size];
    timeout(IO_TIME, recv.read_exact(&mut bytes))
        .await
        .map_err(|_| disconnected())?
        .map_err(|_| disconnected())?;
    serde_json::from_slice(&bytes).map_err(|_| unavailable())
}

async fn send_packet(send: &mut SendStream, packet: Packet) -> Result<()> {
    let bytes = serde_json::to_vec(&packet).map_err(|_| unavailable())?;
    if bytes.len() > MAX_FRAME {
        return Err(unavailable());
    }
    timeout(IO_TIME, async {
        send.write_u32(bytes.len() as u32)
            .await
            .map_err(|_| disconnected())?;
        send.write_all(&bytes).await.map_err(|_| disconnected())
    })
    .await
    .map_err(|_| disconnected())?
}

fn unavailable() -> AppError {
    AppError::new(
        "collaboration",
        "Não foi possível estabelecer a conexão. Confira a internet e o código do convite.",
    )
}

fn disconnected() -> AppError {
    AppError::new("collaboration", "A conexão do fluxograma foi encerrada.")
}

impl FlowCollaboration {
    fn host_project(
        &self,
        directory: &Path,
        id: Uuid,
        name: Option<String>,
        resume_invite: bool,
    ) -> Result<Option<View>> {
        let mut sessions = self.0.lock().map_err(|_| unavailable())?;
        if sessions.closing {
            return Err(disconnected());
        }
        if let Some(view) = sessions.active_host(id)? {
            return Ok(Some(view));
        }
        let name = name.as_deref().map(alias).transpose()?;
        let saved = flow_access::read(directory, id)?;
        let project = SharedProject {
            directory: directory.to_path_buf(),
            id,
        };
        let (mut sharing, mut invitation) = if let Some(name) = &name {
            let mut sharing = saved.unwrap_or_else(|| Sharing::new(name.clone()));
            sharing.name.clone_from(name);
            (sharing, Some(new_invitation()))
        } else {
            let invitation = saved
                .as_ref()
                .filter(|_| resume_invite)
                .and_then(restore_invitation);
            match saved {
                Some(sharing) if invitation.is_some() || sharing.guest.is_some() => {
                    (sharing, invitation)
                }
                _ if resume_invite => {
                    return Err(AppError::new(
                        "expired",
                        "O convite anterior expirou. Gere um novo convite neste projeto.",
                    ))
                }
                _ => return Ok(None),
            }
        };
        let diagram = workspaces::load(directory, id)?.diagram;
        if name.is_some() {
            invitation = record_invitation(&project, &mut sharing, invitation)?;
        }
        sessions
            .start(Some(id), |state, commands| async move {
                let endpoint = endpoint(true, SecretKey::from_bytes(&sharing.key)).await?;
                timeout(DIAL_TIME, endpoint.online())
                    .await
                    .map_err(|_| unavailable())?;
                let result = host(
                    endpoint.clone(),
                    sharing,
                    diagram,
                    project,
                    invitation,
                    state,
                    commands,
                )
                .await;
                endpoint.close().await;
                result
            })
            .map(Some)
    }

    pub fn restore_hosts(&self, directory: &Path) {
        let Ok(entries) = fs::read_dir(directory) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .extension()
                .is_none_or(|extension| extension != "sharing")
            {
                continue;
            }
            let Some(id) = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .and_then(|stem| Uuid::parse_str(stem).ok())
            else {
                continue;
            };
            if flow_access::read(directory, id)
                .is_ok_and(|saved| saved.is_some_and(|sharing| sharing.guest.is_some()))
            {
                let _ = self.host_project(directory, id, None, true);
            }
        }
    }

    async fn close(&self, id: Uuid) -> Result<()> {
        let connected = if let Some(view) = self.view(id)? {
            view.lock().map_err(|_| unavailable())?.phase == Phase::Connected
        } else {
            false
        };
        if connected {
            if let Ok(sender) = self.sender(id) {
                let _ = timeout(CLOSE_TIME, submit(sender, Command::End)).await;
            }
        }
        self.end(id)
    }
}

#[tauri::command]
pub async fn flow_collab_host(
    app: AppHandle,
    sessions: State<'_, FlowCollaboration>,
    id: Uuid,
    name: Option<String>,
    resume_invite: Option<bool>,
) -> Result<Option<View>> {
    sessions.host_project(
        &workspaces::directory(&app)?,
        id,
        name,
        resume_invite.unwrap_or(false),
    )
}

#[tauri::command]
pub async fn flow_collab_join(
    app: AppHandle,
    sessions: State<'_, FlowCollaboration>,
    code: String,
    name: String,
) -> Result<View> {
    let (host_id, token) = decode(&code)?;
    let name = alias(&name)?;
    let key = flow_access::guest_key(&workspaces::directory(&app)?)?;
    sessions.start(None, |state, commands| async move {
        let endpoint = endpoint(false, key).await?;
        join(
            endpoint,
            EndpointAddr::new(host_id),
            token,
            name,
            state,
            commands,
        )
        .await
    })
}

#[tauri::command]
pub async fn flow_collab_view(
    sessions: State<'_, FlowCollaboration>,
    id: Uuid,
    seen: u64,
    known: Option<u64>,
) -> Result<Option<ViewUpdate>> {
    sessions.next_view(id, seen, known).await
}

async fn submit(sender: mpsc::Sender<Request>, command: Command) -> Result<()> {
    let (response, result) = oneshot::channel();
    sender
        .send(Request { command, response })
        .await
        .map_err(|_| disconnected())?;
    result.await.map_err(|_| disconnected())?
}

#[tauri::command]
pub async fn flow_collab_command(
    sessions: State<'_, FlowCollaboration>,
    id: Uuid,
    command: Command,
) -> Result<()> {
    submit(sessions.sender(id)?, command).await
}

#[tauri::command]
pub async fn flow_collab_end(sessions: State<'_, FlowCollaboration>, id: Uuid) -> Result<()> {
    sessions.close(id).await
}

#[tauri::command]
pub fn flow_project_edit(
    app: AppHandle,
    sessions: State<'_, FlowCollaboration>,
    id: Uuid,
    diagram: Diagram,
) -> Result<()> {
    let guard = sessions.0.lock().map_err(|_| unavailable())?;
    if guard.active_host(id)?.is_some() {
        return Err(invalid(
            "Este projeto está em uma sessão de compartilhamento.",
        ));
    }
    workspaces::update(&workspaces::directory(&app)?, id, diagram)
}

#[tauri::command]
pub async fn flow_project_remove(
    app: AppHandle,
    sessions: State<'_, FlowCollaboration>,
    id: Uuid,
) -> Result<()> {
    let view = sessions
        .0
        .lock()
        .map_err(|_| unavailable())?
        .active_host(id)?;
    if let Some(view) = view {
        sessions.close(view.id).await?;
    }
    let mut guard = sessions.0.lock().map_err(|_| unavailable())?;
    if guard.active_host(id)?.is_some() {
        return Err(invalid(
            "Este projeto está em uma sessão de compartilhamento.",
        ));
    }
    guard.entries.remove(&Some(id));
    workspaces::remove(&workspaces::directory(&app)?, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn diagram(title: &str) -> Diagram {
        Diagram {
            title: title.to_owned(),
            summary: String::new(),
            nodes: Vec::new(),
            edges: Vec::new(),
            requirements: Vec::new(),
            open_questions: Vec::new(),
            notes: Vec::new(),
        }
    }

    async fn wait(
        session: &FlowCollaboration,
        project: Option<Uuid>,
        check: impl Fn(&View) -> bool,
    ) -> View {
        let state = session.0.lock().unwrap().entries[&project].view.clone();
        timeout(Duration::from_secs(12), async {
            loop {
                let view = state.lock().unwrap().clone();
                if check(&view) {
                    return view;
                }
                assert!(view.phase != Phase::Ended, "{:?}", view.message);
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .unwrap()
    }

    #[test]
    fn cosmetic_capability_is_optional_in_existing_invitations() {
        let hello = serde_json::json!({ "type": "hello", "name": "Bia", "token": vec![0; 16] });
        assert!(matches!(
            serde_json::from_value::<Packet>(hello).unwrap(),
            Packet::Hello { mascots: false, .. }
        ));
        let accepted = serde_json::json!({ "type": "accepted", "name": "Ana", "diagram": diagram("Projeto"), "return_code": null });
        assert!(matches!(
            serde_json::from_value::<Packet>(accepted).unwrap(),
            Packet::Accepted { mascots: false, .. }
        ));
    }

    #[test]
    fn remembers_only_an_unexpired_pending_invitation() {
        let directory = tempfile::tempdir().unwrap();
        let project = SharedProject {
            id: Uuid::new_v4(),
            directory: directory.path().to_owned(),
        };
        let mut sharing = Sharing::new("Ana".into());
        let (token, _) = record_invitation(&project, &mut sharing, Some(new_invitation()))
            .unwrap()
            .unwrap();
        let loaded = flow_access::read(&project.directory, project.id)
            .unwrap()
            .unwrap();
        assert_eq!(restore_invitation(&loaded).unwrap().0, token);
        assert_eq!(sharing.key, loaded.key);
        record_invitation(&project, &mut sharing, None).unwrap();
        let loaded = flow_access::read(&project.directory, project.id)
            .unwrap()
            .unwrap();
        assert!(restore_invitation(&loaded).is_none());
        sharing.invitation = Some(StoredInvitation {
            token,
            expires_at: unix_millis().saturating_sub(1),
        });
        assert!(restore_invitation(&sharing).is_none());
    }

    async fn test_endpoint(secret: SecretKey, relay: bool, host: bool) -> Endpoint {
        let mut builder = if relay {
            Endpoint::builder(presets::N0).clear_ip_transports()
        } else {
            Endpoint::builder(presets::Minimal)
        };
        if host {
            builder = builder.alpns(vec![ALPN.to_vec()]);
        }
        let endpoint = builder.secret_key(secret).bind().await.unwrap();
        if relay && host {
            timeout(DIAL_TIME, endpoint.online()).await.unwrap();
        }
        endpoint
    }

    fn address(endpoint: &Endpoint, relay: bool) -> EndpointAddr {
        let address = EndpointAddr::new(endpoint.id());
        if relay {
            return address;
        }
        let port = endpoint
            .bound_sockets()
            .into_iter()
            .find(|ip| ip.is_ipv4())
            .unwrap()
            .port();
        address.with_ip_addr(([127, 0, 0, 1], port).into())
    }

    #[tokio::test]
    async fn real_invitation_approval_cursors_and_editing() {
        exercise_session(false).await;
    }

    #[tokio::test]
    #[ignore = "requer acesso aos relays públicos do Iroh"]
    async fn invitation_uses_public_relay_with_direct_ip_disabled() {
        exercise_session(true).await;
    }

    async fn exercise_session(relay: bool) {
        let directory = tempfile::tempdir().unwrap();
        let project = SharedProject {
            id: Uuid::new_v4(),
            directory: directory.path().to_owned(),
        };
        let mut base = diagram("Projeto");
        for id in ["processo", "fim"] {
            base.nodes.push(super::super::model::Node {
                id: id.into(),
                kind: super::super::model::Kind::Action,
                label: id.into(),
                detail: String::new(),
                position: None,
            });
        }
        base.notes.push(super::super::model::Note {
            id: "nota".into(),
            text: "Revisar".into(),
            position: Position { x: 260.0, y: 0.0 },
        });
        let workspace = workspaces::Workspace {
            id: project.id,
            diagram: base.clone(),
            file: None,
            file_dirty: false,
            returning_guest: false,
        };
        std::fs::write(
            project.directory.join(format!("{}.json", project.id)),
            serde_json::to_vec(&workspace).unwrap(),
        )
        .unwrap();
        let sharing = Sharing::new("Ana".into());
        let server = test_endpoint(SecretKey::from_bytes(&sharing.key), relay, true).await;
        let destination = address(&server, relay);
        let guest_key = flow_access::guest_key(&project.directory).unwrap();
        let client = test_endpoint(guest_key.clone(), relay, false).await;

        let owner = FlowCollaboration::default();
        let host = owner
            .start(Some(project.id), |state, commands| {
                let operation = super::host(
                    server.clone(),
                    sharing,
                    base.clone(),
                    project.clone(),
                    Some(new_invitation()),
                    state,
                    commands,
                );
                async move { operation.await }
            })
            .unwrap();
        let invite = wait(&owner, Some(project.id), |view| {
            view.phase == Phase::Inviting
        })
        .await;
        let (id, token) = decode(&invite.code.unwrap()).unwrap();
        assert_eq!(destination.id, id);

        let guest = FlowCollaboration::default();
        let visitor = guest
            .start(None, |state, commands| {
                join(
                    client,
                    destination.clone(),
                    token,
                    "Bia".into(),
                    state,
                    commands,
                )
            })
            .unwrap();

        let request = wait(&owner, Some(project.id), |view| {
            view.phase == Phase::Approval
        })
        .await;
        assert_eq!(request.peer.as_deref(), Some("Bia"));
        assert_eq!(request.peer_version.as_deref(), Some(APP_VERSION));
        let before_approval = wait(&guest, None, |view| {
            view.phase == Phase::Joining && view.peer_version.is_some()
        })
        .await;
        assert_eq!(before_approval.peer.as_deref(), Some("Ana"));
        assert_eq!(before_approval.peer_version.as_deref(), Some(APP_VERSION));
        assert!(before_approval.diagram.is_none());
        assert!(!before_approval.can_edit);
        let host_tx = owner.sender(host.id).unwrap();
        let guest_tx = guest.sender(visitor.id).unwrap();
        submit(host_tx.clone(), Command::Accept { remember: true })
            .await
            .unwrap();
        let approved = wait(&guest, None, |view| view.phase == Phase::Connected).await;
        assert!(approved.can_edit);
        assert_eq!(approved.diagram.unwrap().title, "Projeto");
        assert_eq!(approved.peer.as_deref(), Some("Ana"));
        let code = approved.return_code.unwrap();
        assert!(
            wait(&owner, Some(project.id), |view| view.phase
                == Phase::Connected)
            .await
            .can_edit
        );
        let other = owner
            .start(Some(Uuid::new_v4()), |_, _| std::future::pending())
            .unwrap();
        let attached = owner
            .host_project(&project.directory, project.id, None, false)
            .unwrap()
            .unwrap();
        assert_eq!(attached.id, host.id);
        assert!(attached.phase == Phase::Connected);

        assert!(approved.mascot_supported);
        assert!(
            wait(&owner, Some(project.id), |view| view.mascot_supported)
                .await
                .mascot_supported
        );
        let mascot = Mascot {
            position: Position { x: 0.31, y: 0.72 },
            hat: "leather".into(),
            pose: super::super::flow_mascot::Pose::Idle,
            scene: Some(serde_json::from_value(serde_json::json!({
                "epoch": 1, "origin": {"x":0.4,"y":0.6},
                "toy": {
                    "epoch":3, "kind":"bow", "anchor":{"x":0.5,"y":0.4}, "direction":{"x":1.0,"y":0.0},
                    "shoulder":{"x":0.4,"y":0.6}, "hand":{"x":0.42,"y":0.6}, "stretch":0.7, "boost":0.5, "power":1.15,
                    "shots":[{"id":1,"point":{"x":0.6,"y":0.4},"direction":{"x":1.0,"y":0.0},"power":1.15}],
                    "sparks":[{"id":2,"point":{"x":0.7,"y":0.4},"kind":"impact"}]
                },
                "clone":{"point":{"x":0.3,"y":0.6},"hat":"pirate","pose":"idle","flight":null},
                "young":[{"id":1,"point":{"x":0.2,"y":0.9},"phase":"young","rotation":5.0,"squash":0.2,"held":false}],
                "hits":[{"id":1,"target":"young:1","impulse":{"direction":{"x":1.0,"y":0.0},"strength":800.0},"pop":true}],
                "sounds":[{"id":2,"kind":"bounceOffWall","strength":0.8}]
            })).unwrap()),
            flight: Some(super::super::flow_mascot::Flight {
                velocity_x: -1040.0,
                squash: 0.4,
                edge: super::super::flow_mascot::Edge::Bottom,
            }),
        };
        submit(
            guest_tx.clone(),
            Command::Mascot {
                mascot: Some(mascot.clone()),
            },
        )
        .await
        .unwrap();
        let remote = wait(&owner, Some(project.id), |view| view.mascot.is_some())
            .await
            .mascot
            .unwrap();
        assert_eq!(remote.hat, "leather");
        assert_eq!(remote.position, mascot.position);
        let scene = remote.scene.as_ref().unwrap();
        assert_eq!(scene.toy.as_ref().unwrap().shots[0].id, 1);
        assert_eq!(scene.clone.as_ref().unwrap().hat, "pirate");
        assert_eq!(scene.young.len(), 1);
        assert!(scene.hits[0].pop);
        assert_eq!(scene.sounds[0].strength, 0.8);
        assert_eq!(remote.flight.unwrap().velocity_x, -1040.0);
        submit(
            host_tx.clone(),
            Command::Mascot {
                mascot: Some(mascot),
            },
        )
        .await
        .unwrap();
        wait(&guest, None, |view| view.mascot.is_some()).await;

        let splat = Splat {
            id: 1,
            position: Position { x: 0.7, y: 1.0 },
            edge: super::super::flow_mascot::Edge::Bottom,
            slide: 0.15,
            strength: 0.7,
        };
        submit(guest_tx.clone(), Command::MascotSplat { splat })
            .await
            .unwrap();
        let splats = wait(&owner, Some(project.id), |view| {
            !view.mascot_splats.is_empty()
        })
        .await
        .mascot_splats;
        assert_eq!(splats[0].strength, 0.7);

        let meeting = Meeting {
            id: 1,
            position: Position { x: 0.5, y: 0.5 },
            kind: super::super::flow_mascot::MeetingKind::Bump,
            impulse: Some(super::super::flow_mascot::Impulse {
                direction: Position { x: 1.0, y: 0.0 },
                strength: 920.0,
            }),
        };
        submit(guest_tx.clone(), Command::MascotMeeting { meeting })
            .await
            .unwrap();
        assert_eq!(
            wait(&owner, Some(project.id), |view| view
                .mascot_meeting
                .is_some())
            .await
            .mascot_meeting
            .unwrap()
            .id,
            1
        );
        submit(guest_tx.clone(), Command::Mascot { mascot: None })
            .await
            .unwrap();
        let hidden = wait(&owner, Some(project.id), |view| view.mascot.is_none()).await;
        assert!(hidden.mascot_meeting.is_none());
        assert!(hidden.mascot_splats.is_empty());
        assert!(hidden.mascot_version >= 3);

        let position = Some(Position { x: 21.0, y: -117.0 });
        submit(guest_tx.clone(), Command::Cursor { position })
            .await
            .unwrap();
        wait(&owner, Some(project.id), |view| view.cursor == position).await;
        let current = wait(&guest, None, |view| view.phase == Phase::Connected).await;
        let (update, sent) = tokio::join!(
            guest.next_view(visitor.id, current.revision, Some(current.live_version)),
            submit(host_tx.clone(), Command::Cursor { position }),
        );
        sent.unwrap();
        let ViewUpdate::Full(updated) = update.unwrap().unwrap() else {
            panic!("A posição deveria acordar a leitura pendente");
        };
        assert_eq!(updated.cursor, position);
        assert!(updated.live_version > current.live_version);
        assert!(updated.diagram.is_none());
        assert!(matches!(
            guest.next_view(visitor.id, updated.revision, Some(updated.live_version)).await.unwrap(),
            Some(ViewUpdate::Unchanged { live_version, .. }) if live_version == updated.live_version
        ));

        let mut host_edit = base.clone();
        host_edit.nodes[0].label = "Ana editou".into();
        host_edit.notes[0].text = "Confirmar com a equipe".into();
        let mut guest_edit = base.clone();
        guest_edit.nodes[0].position = position;
        guest_edit.nodes[1].label = "Bia editou".into();
        guest_edit.notes[0].position = Position { x: 320.0, y: 42.0 };
        let (sent_host, sent_guest) = tokio::join!(
            submit(
                host_tx,
                Command::Edit {
                    before: base.clone(),
                    diagram: host_edit
                }
            ),
            submit(
                guest_tx.clone(),
                Command::Edit {
                    before: base,
                    diagram: guest_edit
                }
            ),
        );
        sent_host.unwrap();
        sent_guest.unwrap();
        let merged = |view: &View| {
            view.diagram.as_ref().is_some_and(|diagram| {
                diagram.nodes[0].label == "Ana editou"
                    && diagram.nodes[0].position == position
                    && diagram.nodes[1].label == "Bia editou"
                    && diagram.notes[0].text == "Confirmar com a equipe"
                    && diagram.notes[0].position == (Position { x: 320.0, y: 42.0 })
            })
        };
        wait(&owner, Some(project.id), merged).await;
        wait(&guest, None, merged).await;
        assert_eq!(
            workspaces::load(&project.directory, project.id)
                .unwrap()
                .diagram
                .nodes[1]
                .label,
            "Bia editou"
        );
        let reattached = owner
            .host_project(&project.directory, project.id, None, false)
            .unwrap()
            .unwrap();
        assert_eq!(reattached.id, host.id);
        assert!(merged(&reattached));

        submit(guest_tx, Command::End).await.unwrap();
        guest.end(visitor.id).unwrap();
        wait(&owner, Some(project.id), |view| {
            view.phase == Phase::Available && view.cursor.is_none()
        })
        .await;
        owner.end(host.id).unwrap();
        assert!(owner.view(other.id).unwrap().is_some());
        owner.end(other.id).unwrap();
        server.close().await;

        let sharing = flow_access::read(&project.directory, project.id)
            .unwrap()
            .unwrap();
        let (host_id, token) = decode(&code).unwrap();
        let destination = if relay {
            // The native startup path listens for saved guests before an editor attaches.
            owner.restore_hosts(&project.directory);
            EndpointAddr::new(host_id)
        } else {
            let reopened = test_endpoint(SecretKey::from_bytes(&sharing.key), false, true).await;
            let destination = address(&reopened, false);
            assert_eq!(host_id, reopened.id());
            let diagram = workspaces::load(&project.directory, project.id)
                .unwrap()
                .diagram;
            owner
                .start(Some(project.id), |state, commands| {
                    super::host(
                        reopened,
                        sharing,
                        diagram,
                        project.clone(),
                        None,
                        state,
                        commands,
                    )
                })
                .unwrap();
            destination
        };
        let resumed = wait(&owner, Some(project.id), |view| {
            view.phase == Phase::Available
        })
        .await;

        let stranger = test_endpoint(SecretKey::generate(), relay, false).await;
        let attempt = guest
            .start(None, |state, commands| {
                join(
                    stranger,
                    destination.clone(),
                    token,
                    "Bia".into(),
                    state,
                    commands,
                )
            })
            .unwrap();
        let denied = wait(&guest, None, |view| view.phase == Phase::Ended).await;
        assert!(denied.diagram.is_none());
        guest.end(attempt.id).unwrap();

        let client = test_endpoint(guest_key, relay, false).await;
        let visitor = guest
            .start(None, |state, commands| {
                join(client, destination, token, "Bia".into(), state, commands)
            })
            .unwrap();
        assert!(
            wait(&guest, None, |view| view.phase == Phase::Connected)
                .await
                .can_edit
        );
        wait(&guest, None, merged).await;
        submit(owner.sender(resumed.id).unwrap(), Command::Revoke)
            .await
            .unwrap();
        assert!(flow_access::read(&project.directory, project.id)
            .unwrap()
            .unwrap()
            .guest
            .is_none());
        assert!(owner.begin_shutdown());
        assert!(!owner.begin_shutdown());
        owner.shutdown().await;
        wait(&guest, None, |view| view.phase == Phase::Ended).await;
        assert!(owner.view(resumed.id).unwrap().is_none());
        assert!(guest.view(visitor.id).unwrap().is_some());
    }
}
