use super::{
    model::{invalid, Diagram, Position},
    workspaces,
};
use crate::error::{AppError, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use iroh::{
    endpoint::{presets, Connection, RecvStream, SendStream},
    Endpoint, EndpointAddr, EndpointId,
};
use serde::{Deserialize, Serialize};
use std::{
    future::Future,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, State};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{mpsc, oneshot},
    task::AbortHandle,
    time::{timeout, timeout_at, Instant},
};
use uuid::Uuid;

const ALPN: &[u8] = b"jujubasql/flow/2";
const INVITATION_LIFETIME: Duration = Duration::from_secs(600);
const APPROVAL_TIME: Duration = Duration::from_secs(120);
const DIAL_TIME: Duration = Duration::from_secs(25);
const IO_TIME: Duration = Duration::from_secs(8);
const MAX_FRAME: usize = 128 * 1024;

#[derive(Default)]
pub struct FlowCollaboration(Mutex<Option<Session>>);

struct Session {
    view: Arc<Mutex<View>>,
    tx: mpsc::Sender<Request>,
    task: AbortHandle,
}

impl Drop for Session {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Phase {
    Starting,
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
    can_edit: bool,
    cursor: Option<Position>,
    diagram: Option<Diagram>,
    revision: u64,
    message: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Packet {
    Bye,
    Hello { name: String, token: [u8; 16] },
    Accepted { name: String, diagram: Diagram },
    Rejected,
    Snapshot { diagram: Diagram },
    Cursor { position: Option<Position> },
    PassEdit,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Command {
    End,
    Accept,
    Reject,
    PassEdit,
    Cursor { position: Option<Position> },
    Edit { diagram: Diagram },
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

impl FlowCollaboration {
    fn start<F, Fut>(&self, project: Option<Uuid>, run: F) -> Result<View>
    where
        F: FnOnce(Arc<Mutex<View>>, Inbox) -> Fut,
        Fut: Future<Output = Result<()>> + Send + 'static,
    {
        let mut session = self.0.lock().map_err(|_| unavailable())?;
        if session.is_some() {
            return Err(invalid("Encerre a sessão atual antes de iniciar outra."));
        }

        let initial = View {
            id: Uuid::new_v4(),
            project_id: project,
            phase: Phase::Starting,
            code: None,
            peer: None,
            can_edit: false,
            cursor: None,
            diagram: None,
            revision: 0,
            message: None,
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
                view.message = Some(
                    result
                        .err()
                        .unwrap_or_else(disconnected)
                        .message
                        .into_owned(),
                );
            });
        });
        *session = Some(Session {
            view,
            tx,
            task: task.abort_handle(),
        });
        Ok(initial)
    }

    fn sender(&self, id: Uuid) -> Result<mpsc::Sender<Request>> {
        let guard = self.0.lock().map_err(|_| unavailable())?;
        let session = guard.as_ref().ok_or_else(disconnected)?;
        if session.view.lock().map_err(|_| unavailable())?.id != id {
            return Err(disconnected());
        }
        Ok(session.tx.clone())
    }

    fn end(&self, id: Uuid) -> Result<()> {
        let mut guard = self.0.lock().map_err(|_| unavailable())?;
        if let Some(session) = guard.as_ref() {
            if session.view.lock().map_err(|_| unavailable())?.id == id {
                *guard = None;
            }
        }
        Ok(())
    }
}

fn change(state: &Mutex<View>, update: impl FnOnce(&mut View)) {
    if let Ok(mut view) = state.lock() {
        update(&mut view);
    }
}

async fn endpoint(host: bool) -> Result<Endpoint> {
    let mut builder = Endpoint::builder(presets::N0);
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
    name: String,
    mut diagram: Diagram,
    project: Option<SharedProject>,
    state: Arc<Mutex<View>>,
    mut commands: Inbox,
) -> Result<()> {
    let token = Uuid::new_v4();
    change(&state, |view| {
        view.phase = Phase::Inviting;
        view.code = Some(encode(endpoint.id(), token));
    });

    let (connection, mut send, mut recv, peer) =
        timeout(INVITATION_LIFETIME, invited(&endpoint, token))
            .await
            .map_err(|_| AppError::new("expired", "O convite expirou. Crie outro código."))??;
    change(&state, |view| {
        view.phase = Phase::Approval;
        view.peer = Some(peer);
        view.code = None;
    });

    let deadline = Instant::now() + APPROVAL_TIME;
    loop {
        let request = tokio::select! {
            _ = connection.closed() => return Err(disconnected()),
            request = timeout_at(deadline, commands.recv()) =>
                request.map_err(|_| AppError::new("expired", "O pedido de entrada expirou."))?
                    .ok_or_else(disconnected)?,
        };
        match request.command {
            Command::Accept => {
                send_packet(
                    &mut send,
                    Packet::Accepted {
                        name,
                        diagram: diagram.clone(),
                    },
                )
                .await?;
                let _ = request.response.send(Ok(()));
                break;
            }
            Command::Reject => {
                send_packet(&mut send, Packet::Rejected).await?;
                let _ = send.finish();
                let _ = request.response.send(Ok(()));
                // Let QUIC deliver the last frame before the endpoint is dropped.
                let _ = timeout(IO_TIME, send.stopped()).await;
                return Err(AppError::new(
                    "declined",
                    "O pedido de entrada foi recusado.",
                ));
            }
            _ => {
                let _ = request.response.send(Err(unavailable()));
            }
        }
    }

    let result = connected(
        &mut send,
        &mut recv,
        &state,
        &mut commands,
        &mut diagram,
        true,
        project,
    )
    .await;
    endpoint.close().await;
    result
}

async fn invited(
    endpoint: &Endpoint,
    token: Uuid,
) -> Result<(Connection, SendStream, RecvStream, String)> {
    while let Some(incoming) = endpoint.accept().await {
        let attempt = timeout(IO_TIME, async {
            let connection = incoming.await.map_err(|_| unavailable())?;
            let (send, mut recv) = connection.accept_bi().await.map_err(|_| unavailable())?;
            let Packet::Hello {
                name,
                token: candidate,
            } = read_packet(&mut recv).await?
            else {
                return Err(unavailable());
            };
            let diff = candidate
                .iter()
                .zip(token.as_bytes())
                .fold(0, |diff, (a, b)| diff | (a ^ b));
            if diff != 0 {
                return Err(unavailable());
            }
            Ok((connection, send, recv, alias(&name)?))
        })
        .await;
        if let Ok(Ok(invitation)) = attempt {
            return Ok(invitation);
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
        send_packet(&mut send, Packet::Hello { name, token }).await?;
        Ok::<_, AppError>((connection, send, recv))
    })
    .await
    .map_err(|_| unavailable())??;
    change(&state, |view| view.phase = Phase::Joining);
    let (name, mut diagram) = match timeout(APPROVAL_TIME, read_packet(&mut recv)).await {
        Ok(Ok(Packet::Accepted { name, diagram })) => (alias(&name)?, diagram),
        Ok(Ok(Packet::Rejected)) => {
            return Err(AppError::new(
                "declined",
                "O dono recusou o pedido de entrada.",
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
        view.diagram = Some(diagram.clone());
        view.revision += 1;
    });

    let result = connected(
        &mut send,
        &mut recv,
        &state,
        &mut commands,
        &mut diagram,
        false,
        None,
    )
    .await;
    endpoint.close().await;
    result
}

async fn connected(
    send: &mut SendStream,
    recv: &mut RecvStream,
    state: &Mutex<View>,
    commands: &mut Inbox,
    diagram: &mut Diagram,
    mut can_edit: bool,
    project: Option<SharedProject>,
) -> Result<()> {
    change(state, |view| {
        view.phase = Phase::Connected;
        view.can_edit = can_edit;
    });
    loop {
        // Retain the read future while handling local commands, including partial frames.
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
                            let _ = timeout(IO_TIME, send.stopped()).await;
                            let _ = request.response.send(result);
                            return Ok(());
                        }
                        Command::Edit { diagram: next } if can_edit => {
                            match save(project.as_ref(), &next) {
                                Ok(()) => {
                                    *diagram = next;
                                    send_packet(send, Packet::Snapshot { diagram: diagram.clone() }).await
                                }
                                Err(error) => Err(error),
                            }
                        }
                        Command::PassEdit if can_edit => {
                            can_edit = false;
                            change(state, |view| view.can_edit = false);
                            send_packet(send, Packet::PassEdit).await
                        }
                        Command::Cursor { position } if valid_position(position) =>
                            send_packet(send, Packet::Cursor { position }).await,
                        _ => Err(invalid("A edição está com a outra pessoa.")),
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
            Packet::Bye => return Ok(()),
            Packet::Cursor { position } if valid_position(position) => {
                change(state, |view| view.cursor = position);
            }
            Packet::PassEdit if !can_edit => {
                can_edit = true;
                change(state, |view| view.can_edit = true);
            }
            Packet::Snapshot { diagram: next } if !can_edit => {
                save(project.as_ref(), &next)?;
                *diagram = next;
                change(state, |view| {
                    view.revision += 1;
                    view.diagram = Some(diagram.clone());
                });
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

fn save(project: Option<&SharedProject>, diagram: &Diagram) -> Result<()> {
    diagram.validate_draft()?;
    if let Some(project) = project {
        workspaces::update(&project.directory, project.id, diagram.clone())?;
    }
    Ok(())
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

#[tauri::command]
pub async fn flow_collab_host(
    app: AppHandle,
    sessions: State<'_, FlowCollaboration>,
    id: Uuid,
    name: String,
) -> Result<View> {
    let name = alias(&name)?;
    let directory = workspaces::directory(&app)?;
    let diagram = workspaces::load(&directory, id)?.diagram;
    let project = SharedProject { directory, id };
    sessions.start(Some(id), |state, commands| async move {
        let endpoint = endpoint(true).await?;
        timeout(DIAL_TIME, endpoint.online())
            .await
            .map_err(|_| unavailable())?;
        host(endpoint, name, diagram, Some(project), state, commands).await
    })
}

#[tauri::command]
pub async fn flow_collab_join(
    sessions: State<'_, FlowCollaboration>,
    code: String,
    name: String,
) -> Result<View> {
    let (host_id, token) = decode(&code)?;
    let name = alias(&name)?;
    sessions.start(None, |state, commands| async move {
        let endpoint = endpoint(false).await?;
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
pub fn flow_collab_view(
    sessions: State<'_, FlowCollaboration>,
    id: Uuid,
    seen: u64,
) -> Result<Option<View>> {
    let guard = sessions.0.lock().map_err(|_| unavailable())?;
    let Some(session) = guard.as_ref() else {
        return Ok(None);
    };
    let view = session.view.lock().map_err(|_| unavailable())?;
    if view.id != id {
        return Ok(None);
    }
    let mut view = view.clone();
    if view.revision == seen {
        view.diagram = None;
    }
    Ok(Some(view))
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
    if flow_collab_view(sessions.clone(), id, 0)?.is_some_and(|view| view.phase == Phase::Connected)
    {
        let _ = submit(sessions.sender(id)?, Command::End).await;
    }
    sessions.end(id)
}

#[tauri::command]
pub fn flow_project_edit(
    app: AppHandle,
    sessions: State<'_, FlowCollaboration>,
    id: Uuid,
    diagram: Diagram,
) -> Result<()> {
    let guard = sessions.0.lock().map_err(|_| unavailable())?;
    if let Some(session) = guard.as_ref() {
        let view = session.view.lock().map_err(|_| unavailable())?;
        if view.project_id == Some(id) {
            return Err(invalid(
                "Este projeto está em uma sessão de compartilhamento.",
            ));
        }
    }
    workspaces::update(&workspaces::directory(&app)?, id, diagram)
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
        }
    }

    async fn wait(session: &FlowCollaboration, check: impl Fn(&View) -> bool) -> View {
        timeout(Duration::from_secs(12), async {
            loop {
                let view = {
                    let guard = session.0.lock().unwrap();
                    let view = guard.as_ref().unwrap().view.lock().unwrap().clone();
                    view
                };
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

    #[tokio::test]
    async fn real_invitation_approval_cursors_and_editing() {
        let server = Endpoint::builder(presets::Minimal)
            .alpns(vec![ALPN.to_vec()])
            .bind()
            .await
            .unwrap();
        let port = server
            .bound_sockets()
            .into_iter()
            .find(|address| address.is_ipv4())
            .unwrap()
            .port();
        let address = EndpointAddr::new(server.id()).with_ip_addr(([127, 0, 0, 1], port).into());
        let client = Endpoint::builder(presets::Minimal).bind().await.unwrap();
        exercise_session(server, client, address).await;
    }

    #[tokio::test]
    #[ignore = "requer acesso aos relays públicos do Iroh"]
    async fn invitation_uses_public_relay_with_direct_ip_disabled() {
        let server = Endpoint::builder(presets::N0)
            .clear_ip_transports()
            .alpns(vec![ALPN.to_vec()])
            .bind()
            .await
            .unwrap();
        timeout(DIAL_TIME, server.online()).await.unwrap();
        let address = EndpointAddr::new(server.id());
        let client = Endpoint::builder(presets::N0)
            .clear_ip_transports()
            .bind()
            .await
            .unwrap();
        exercise_session(server, client, address).await;
    }

    async fn exercise_session(server: Endpoint, client: Endpoint, address: EndpointAddr) {
        let owner = FlowCollaboration::default();
        let host = owner
            .start(None, |state, commands| {
                super::host(
                    server,
                    "Ana".into(),
                    diagram("Projeto"),
                    None,
                    state,
                    commands,
                )
            })
            .unwrap();
        let invite = wait(&owner, |view| view.phase == Phase::Inviting).await;
        let (id, token) = decode(&invite.code.unwrap()).unwrap();
        assert_eq!(address.id, id);

        let guest = FlowCollaboration::default();
        let visitor = guest
            .start(None, |state, commands| {
                join(client, address, token, "Bia".into(), state, commands)
            })
            .unwrap();

        let request = wait(&owner, |view| view.phase == Phase::Approval).await;
        assert_eq!(request.peer.as_deref(), Some("Bia"));
        let before_approval = wait(&guest, |view| view.phase == Phase::Joining).await;
        assert!(before_approval.diagram.is_none());
        assert!(!before_approval.can_edit);
        let host_tx = owner.sender(host.id).unwrap();
        let guest_tx = guest.sender(visitor.id).unwrap();
        submit(host_tx.clone(), Command::Accept).await.unwrap();
        let approved = wait(&guest, |view| view.phase == Phase::Connected).await;
        assert_eq!(approved.diagram.unwrap().title, "Projeto");
        assert_eq!(approved.peer.as_deref(), Some("Ana"));
        assert!(submit(
            guest_tx.clone(),
            Command::Edit {
                diagram: diagram("Sem edição")
            }
        )
        .await
        .is_err());
        let position = Some(Position { x: 21.0, y: -117.0 });
        submit(guest_tx.clone(), Command::Cursor { position })
            .await
            .unwrap();
        wait(&owner, |view| view.cursor == position).await;
        submit(host_tx.clone(), Command::Cursor { position })
            .await
            .unwrap();
        wait(&guest, |view| view.cursor == position).await;
        submit(
            host_tx.clone(),
            Command::Edit {
                diagram: diagram("Ana editou"),
            },
        )
        .await
        .unwrap();
        wait(&guest, |view| view.revision == 2).await;
        submit(host_tx, Command::PassEdit).await.unwrap();
        wait(&guest, |view| view.can_edit).await;
        submit(
            guest_tx.clone(),
            Command::Edit {
                diagram: diagram("Bia editou"),
            },
        )
        .await
        .unwrap();
        let edit = wait(&owner, |view| view.revision == 1).await;
        assert_eq!(edit.diagram.unwrap().title, "Bia editou");
        submit(guest_tx, Command::End).await.unwrap();
        guest.end(visitor.id).unwrap();
        wait(&owner, |view| {
            view.phase == Phase::Ended && view.cursor.is_none()
        })
        .await;
    }
}
