use super::{
    announce_room, apply_edit, change, disconnected, encode, incoming, matches_token,
    new_invitation, operation_unavailable, read_packet, record_invitation, reject, send_packet_ref,
    valid_position, ChildDrag, Command, Connection, Diagram, Endpoint, Guest, Inbox, Mascot,
    Meeting, Packet, Phase, Position, RecvStream, Result, SendStream, SharedProject, Sharing,
    Splat, View, Visitor, APPROVAL_TIME, APP_VERSION,
};
use crate::system_diagram::flow_mascot::DragKind;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    future::pending,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    sync::mpsc,
    task::JoinSet,
    time::{sleep_until, timeout, Instant},
};
use uuid::Uuid;

const MAX_GUESTS: usize = 7;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Member {
    id: Uuid,
    name: String,
    version: Option<String>,
    group: bool,
    cursor: Option<Position>,
    mascot: Option<Arc<Mascot>>,
    meeting: Option<Meeting>,
    splats: VecDeque<Splat>,
}

impl Member {
    fn new(id: Uuid, name: String, version: Option<String>, group: bool) -> Self {
        Self {
            id,
            name,
            version,
            group,
            cursor: None,
            mascot: None,
            meeting: None,
            splats: VecDeque::new(),
        }
    }

    fn apply(&mut self, event: MemberEvent) {
        match event {
            MemberEvent::Cursor { position } => self.cursor = position,
            MemberEvent::Mascot { mascot } => {
                self.mascot = mascot.map(Arc::new);
                if self.mascot.is_none() {
                    self.meeting = None;
                    self.splats.clear();
                }
            }
            MemberEvent::Meeting { meeting } => self.meeting = Some(meeting),
            MemberEvent::Splat { splat } => {
                if self.splats.len() == 16 {
                    self.splats.pop_front();
                }
                self.splats.push_back(splat);
            }
            MemberEvent::Joined { .. } | MemberEvent::Left => {}
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(super) enum MemberEvent {
    Joined { member: Member },
    Left,
    Cursor { position: Option<Position> },
    Mascot { mascot: Option<Mascot> },
    Meeting { meeting: Meeting },
    Splat { splat: Splat },
}

#[derive(Clone, Serialize)]
pub(super) struct ApprovalRequest {
    id: Uuid,
    peer: String,
    version: Option<String>,
}

#[derive(Clone, Serialize)]
pub(super) struct RoutedDrag {
    sequence: u64,
    from: Uuid,
    drag: ChildDrag,
}

pub(super) fn receive_drag(view: &mut View, from: Uuid, drag: ChildDrag) {
    if view.child_drags.len() == 64 {
        view.child_drags.pop_front();
    }
    view.child_drags.push_back(RoutedDrag {
        sequence: view.live_version.wrapping_add(1),
        from,
        drag,
    });
}

pub(super) fn receive_member(view: &mut View, id: Uuid, event: MemberEvent) {
    match event {
        MemberEvent::Joined { member } if member.id == id && Some(id) != view.self_id => {
            if let Some(existing) = view.members.iter_mut().find(|entry| entry.id == id) {
                *existing = member;
            } else if view.members.len() <= MAX_GUESTS {
                view.members.push(member);
            }
        }
        MemberEvent::Left => view.members.retain(|member| member.id != id),
        event => {
            if let Some(member) = view.members.iter_mut().find(|entry| entry.id == id) {
                member.apply(event);
            }
        }
    }
    if let Some(first) = view.members.first() {
        view.cursor = first.cursor;
        view.mascot.clone_from(&first.mascot);
        view.mascot_meeting.clone_from(&first.meeting);
        view.mascot_splats.clone_from(&first.splats);
    } else {
        view.cursor = None;
        view.mascot = None;
        view.mascot_meeting = None;
        view.mascot_splats.clear();
    }
    view.mascot_version = view.mascot_version.wrapping_add(1);
}

struct Pending {
    id: Uuid,
    deadline: Instant,
    connection: Connection,
    send: SendStream,
    recv: RecvStream,
    visitor: Visitor,
    token: Uuid,
}

struct Link {
    writer: mpsc::Sender<Arc<Packet>>,
    connection: Connection,
    acknowledged: u64,
    group: bool,
    mascots: bool,
}

enum Incoming {
    Packet(Uuid, Packet),
    Left(Uuid),
}

struct Host {
    project: SharedProject,
    sharing: Sharing,
    diagram: Diagram,
    invitation: Option<(Uuid, Instant)>,
    local: Member,
    state: Arc<Mutex<View>>,
    links: BTreeMap<Uuid, Link>,
    pending: VecDeque<Pending>,
    drags: HashMap<(Uuid, u32), Uuid>,
    tasks: JoinSet<()>,
    inbox: mpsc::Sender<Incoming>,
}

pub(super) async fn host(
    endpoint: Endpoint,
    sharing: Sharing,
    diagram: Diagram,
    project: SharedProject,
    invitation: Option<(Uuid, Instant)>,
    state: Arc<Mutex<View>>,
    mut commands: Inbox,
) -> Result<()> {
    let id = state.lock().map_err(|_| disconnected())?.id;
    let (inbox, mut updates) = mpsc::channel(128);
    let mut room = Host {
        project,
        diagram,
        invitation,
        local: Member::new(id, sharing.name.clone(), Some(APP_VERSION.into()), true),
        sharing,
        state,
        links: BTreeMap::new(),
        pending: VecDeque::new(),
        drags: HashMap::new(),
        tasks: JoinSet::new(),
        inbox,
    };
    room.update_view(&endpoint);
    let mut next = std::pin::pin!(incoming(&endpoint));
    loop {
        let deadline = room
            .pending
            .front()
            .map(|request| request.deadline)
            .into_iter()
            .chain(room.invitation.map(|(_, limit)| limit))
            .min();
        tokio::select! {
            result = &mut next => {
                let (connection, mut send, recv, visitor) = result?;
                next.set(incoming(&endpoint));
                let identity = connection.remote_id();
                let saved = room.sharing.guests.iter().find(|guest|
                    guest.id == identity && matches_token(visitor.token, guest.ticket)).cloned();
                let invitation = room.invitation.filter(|(token, expires)|
                    Instant::now() < *expires && matches_token(visitor.token, *token));
                if room.links.len() + room.pending.len() >= MAX_GUESTS
                    || room.links.values().any(|link| link.connection.remote_id() == identity)
                    || room.pending.iter().any(|request| request.connection.remote_id() == identity)
                    || (saved.is_none() && invitation.is_none()) {
                    reject(connection, send);
                    continue;
                }
                if announce_room(&mut send, &room.sharing.name, visitor.version.is_some()).await.is_err() {
                    continue;
                }
                let request = Pending { id: Uuid::new_v4(), deadline: Instant::now() + APPROVAL_TIME,
                    connection, send, recv, visitor, token: invitation.map(|value| value.0).unwrap_or_default() };
                if let Some(saved) = saved {
                    room.connect(request, Some(saved), &endpoint);
                } else {
                    room.pending.push_back(request);
                    room.update_view(&endpoint);
                }
            }
            request = commands.recv() => {
                let request = request.ok_or_else(disconnected)?;
                if matches!(request.command, Command::End) {
                    room.end().await;
                    let _ = request.response.send(Ok(()));
                    return Ok(());
                }
                let result = room.command(request.command, &endpoint);
                let _ = request.response.send(result);
            }
            update = updates.recv() => match update {
                Some(Incoming::Packet(peer, packet)) => room.packet(peer, packet, &endpoint),
                Some(Incoming::Left(peer)) => room.remove(peer, &endpoint),
                None => return Err(disconnected()),
            },
            _ = next_deadline(deadline) => {
                if room.invitation.is_some_and(|(_, expires)| expires <= Instant::now()) { room.invitation = None; }
                while room.pending.front().is_some_and(|request| request.deadline <= Instant::now()) {
                    if let Some(request) = room.pending.pop_front() { reject(request.connection, request.send); }
                }
                room.update_view(&endpoint);
            }
            _ = room.tasks.join_next(), if !room.tasks.is_empty() => {}
        }
    }
}

async fn next_deadline(deadline: Option<Instant>) {
    match deadline {
        Some(deadline) => sleep_until(deadline).await,
        None => pending().await,
    }
}

impl Host {
    fn update_view(&self, endpoint: &Endpoint) {
        change(&self.state, |view| {
            view.self_id = Some(self.local.id);
            view.code = self
                .invitation
                .map(|(token, _)| encode(endpoint.id(), token));
            view.approval = self.pending.front().map(|request| ApprovalRequest {
                id: request.id,
                peer: request.visitor.name.clone(),
                version: request.visitor.version.clone(),
            });
            view.phase = if !self.links.is_empty() {
                Phase::Connected
            } else if view.approval.is_some() {
                Phase::Approval
            } else if self.invitation.is_some() {
                Phase::Inviting
            } else {
                Phase::Available
            };
            view.can_edit = true;
            view.mascot_supported = self.links.values().any(|link| link.mascots);
            let joined = view
                .members
                .first()
                .map(|member| (member.name.clone(), member.version.clone()));
            let peer = joined.or_else(|| {
                view.approval
                    .as_ref()
                    .map(|approval| (approval.peer.clone(), approval.version.clone()))
            });
            (view.peer, view.peer_version) =
                peer.map_or((None, None), |(name, version)| (Some(name), version));
            view.trusted_guests = self
                .sharing
                .guests
                .iter()
                .map(|guest| guest.name.clone())
                .collect();
            view.trusted_peer = view.trusted_guests.first().cloned();
        });
    }

    fn connect(&mut self, request: Pending, saved: Option<Guest>, endpoint: &Endpoint) {
        let Pending {
            id,
            connection,
            send,
            recv,
            visitor,
            ..
        } = request;
        let Visitor {
            name,
            version,
            mascots,
            group,
            ..
        } = visitor;
        let member = Member::new(
            id,
            saved
                .as_ref()
                .map(|guest| guest.name.clone())
                .unwrap_or(name),
            version,
            group,
        );
        // The first packet is the accepted snapshot. The worker preserves ordering for later edits.
        let (writer, outbox) = mpsc::channel(96);
        enqueue(
            &writer,
            Packet::Accepted {
                name: self.sharing.name.clone(),
                diagram: self.diagram.clone(),
                return_code: saved.map(|guest| encode(endpoint.id(), guest.ticket)),
                mascots,
                version: Some(APP_VERSION.into()),
                you: group.then_some(id),
            },
        );
        if group {
            let view = self.state.lock().unwrap_or_else(|error| error.into_inner());
            for current in std::iter::once(&self.local).chain(&view.members) {
                enqueue(
                    &writer,
                    Packet::Member {
                        id: current.id,
                        event: MemberEvent::Joined {
                            member: current.clone(),
                        },
                    },
                );
            }
        }
        self.presence(id, MemberEvent::Joined { member });
        self.tasks.spawn(peer_io(
            id,
            connection.clone(),
            send,
            recv,
            outbox,
            self.inbox.clone(),
        ));
        self.links.insert(
            id,
            Link {
                writer,
                connection,
                acknowledged: 0,
                group,
                mascots,
            },
        );
        self.update_view(endpoint);
    }

    fn request(&mut self, expected: Option<Uuid>) -> Result<Pending> {
        if self
            .pending
            .front()
            .is_none_or(|next| expected.is_some_and(|id| id != next.id))
        {
            return Err(operation_unavailable());
        }
        self.pending.pop_front().ok_or_else(operation_unavailable)
    }

    fn command(&mut self, command: Command, endpoint: &Endpoint) -> Result<()> {
        match command {
            Command::Invite => {
                self.invitation =
                    record_invitation(&self.project, &mut self.sharing, Some(new_invitation()))?;
                self.update_view(endpoint);
            }
            Command::Accept { remember, request } => {
                let request = self.request(request)?;
                if self.invitation.is_none_or(|(token, expires)| {
                    token != request.token || expires <= Instant::now()
                }) {
                    reject(request.connection, request.send);
                    self.update_view(endpoint);
                    return Err(operation_unavailable());
                }
                let mut saved = None;
                if remember {
                    let guest = Guest {
                        id: request.connection.remote_id(),
                        name: request.visitor.name.clone(),
                        ticket: Uuid::new_v4(),
                    };
                    let previous = self.sharing.guests.clone();
                    self.sharing.guests.retain(|entry| entry.id != guest.id);
                    self.sharing.guests.push(guest.clone());
                    if super::flow_access::write(
                        &self.project.directory,
                        self.project.id,
                        &self.sharing,
                    )
                    .is_ok()
                    {
                        saved = Some(guest);
                    } else {
                        self.sharing.guests = previous;
                        change(&self.state, |view| {
                            view.message = Some(
                                "A pessoa entrou, mas não foi possível salvar o acesso.".into(),
                            )
                        });
                    }
                }
                self.connect(request, saved, endpoint);
            }
            Command::Reject { request } => {
                let request = self.request(request)?;
                reject(request.connection, request.send);
                self.update_view(endpoint);
            }
            Command::Revoke => {
                let previous = std::mem::take(&mut self.sharing.guests);
                if let Err(error) = super::flow_access::write(
                    &self.project.directory,
                    self.project.id,
                    &self.sharing,
                ) {
                    self.sharing.guests = previous;
                    return Err(error);
                }
                self.update_view(endpoint);
            }
            Command::Edit { before, diagram } => {
                apply_edit(
                    &self.state,
                    Some(&self.project),
                    &mut self.diagram,
                    &before,
                    &diagram,
                )?;
                self.send_snapshots();
            }
            Command::ChildDrag { owner, drag } => self.drag(self.local.id, owner, drag)?,
            command => {
                let event = match command {
                    Command::Cursor { position } if valid_position(position) => {
                        MemberEvent::Cursor { position }
                    }
                    Command::Mascot { mascot } if mascot.as_ref().is_none_or(Mascot::valid) => {
                        MemberEvent::Mascot { mascot }
                    }
                    Command::MascotMeeting { meeting } if meeting.valid() => {
                        MemberEvent::Meeting { meeting }
                    }
                    Command::MascotSplat { splat } if splat.valid() => MemberEvent::Splat { splat },
                    _ => return Err(operation_unavailable()),
                };
                self.presence(self.local.id, event);
            }
        }
        Ok(())
    }

    fn send_snapshots(&self) {
        for link in self.links.values() {
            forward(
                link,
                &Arc::new(Packet::Snapshot {
                    diagram: self.diagram.clone(),
                    acknowledged: link.acknowledged,
                }),
            );
        }
    }

    fn packet(&mut self, peer: Uuid, packet: Packet, endpoint: &Endpoint) {
        let Some(link) = self.links.get_mut(&peer) else {
            return;
        };
        match packet {
            Packet::Bye => self.remove(peer, endpoint),
            Packet::Edit { before, diagram } => {
                if apply_edit(
                    &self.state,
                    Some(&self.project),
                    &mut self.diagram,
                    &before,
                    &diagram,
                )
                .is_ok()
                {
                    link.acknowledged += 1;
                    self.send_snapshots();
                } else {
                    link.connection.close(0u8.into(), b"edit");
                }
            }
            Packet::Cursor { position } if valid_position(position) => {
                self.presence(peer, MemberEvent::Cursor { position })
            }
            Packet::Mascot { mascot }
                if link.mascots && mascot.as_ref().is_none_or(Mascot::valid) =>
            {
                self.presence(peer, MemberEvent::Mascot { mascot })
            }
            Packet::MascotMeeting { meeting } if link.mascots && meeting.valid() => {
                self.presence(peer, MemberEvent::Meeting { meeting })
            }
            Packet::MascotSplat { splat } if link.mascots && splat.valid() => {
                self.presence(peer, MemberEvent::Splat { splat })
            }
            Packet::ChildDrag { owner, drag, .. } if link.group => {
                let _ = self.drag(peer, owner, drag);
            }
            _ => {}
        }
    }

    fn presence(&mut self, id: Uuid, event: MemberEvent) {
        if matches!(event, MemberEvent::Mascot { mascot: None }) {
            self.drags
                .retain(|(owner, _), picker| *owner != id && *picker != id);
        }
        if id == self.local.id {
            self.local.apply(event.clone());
        } else {
            change(&self.state, |view| receive_member(view, id, event.clone()));
        }
        let legacy = (id == self.local.id)
            .then(|| match &event {
                MemberEvent::Cursor { position } => Some(Packet::Cursor {
                    position: *position,
                }),
                MemberEvent::Mascot { mascot } => Some(Packet::Mascot {
                    mascot: mascot.clone(),
                }),
                MemberEvent::Meeting { meeting } => Some(Packet::MascotMeeting {
                    meeting: meeting.clone(),
                }),
                MemberEvent::Splat { splat } => Some(Packet::MascotSplat {
                    splat: splat.clone(),
                }),
                _ => None,
            })
            .flatten()
            .map(Arc::new);
        let packet = Arc::new(Packet::Member { id, event });
        for (peer, link) in &self.links {
            if *peer == id {
                continue;
            }
            if link.group {
                forward(link, &packet);
            } else if let Some(packet) = &legacy {
                if link.mascots || matches!(packet.as_ref(), Packet::Cursor { .. }) {
                    forward(link, packet);
                }
            }
        }
    }

    fn drag(&mut self, from: Uuid, owner: Uuid, drag: ChildDrag) -> Result<()> {
        if from == owner
            || !drag.valid()
            || (owner != self.local.id && self.links.get(&owner).is_none_or(|link| !link.group))
        {
            return Err(operation_unavailable());
        }
        let key = (owner, drag.id);
        match drag.kind {
            DragKind::Grab => {
                let exists = if owner == self.local.id {
                    self.local.mascot.clone()
                } else {
                    self.state.lock().ok().and_then(|view| {
                        view.members
                            .iter()
                            .find(|member| member.id == owner)?
                            .mascot
                            .clone()
                    })
                };
                if exists
                    .as_ref()
                    .and_then(|mascot| mascot.scene.as_ref())
                    .is_none_or(|scene| {
                        !scene.young.iter().any(|child| {
                            child.id == drag.id
                                && !child.held
                                && matches!(
                                    child.phase,
                                    crate::system_diagram::flow_mascot::YoungPhase::Young
                                )
                        })
                    })
                    || self.drags.contains_key(&key)
                    || self.drags.values().any(|picker| *picker == from)
                {
                    return Err(operation_unavailable());
                }
                self.drags.insert(key, from);
            }
            DragKind::Move | DragKind::Release => {
                if self.drags.get(&key) != Some(&from) {
                    return Err(operation_unavailable());
                }
                if matches!(drag.kind, DragKind::Release) {
                    self.drags.remove(&key);
                }
            }
        }
        if owner == self.local.id {
            change(&self.state, |view| receive_drag(view, from, drag));
        } else if let Some(link) = self.links.get(&owner) {
            forward(
                link,
                &Arc::new(Packet::ChildDrag {
                    owner,
                    from: Some(from),
                    drag,
                }),
            );
        }
        Ok(())
    }

    fn remove(&mut self, id: Uuid, endpoint: &Endpoint) {
        if self.links.remove(&id).is_some() {
            self.drags
                .retain(|(owner, _), picker| *owner != id && *picker != id);
            self.presence(id, MemberEvent::Left);
            self.update_view(endpoint);
        }
    }

    async fn end(&mut self) {
        for link in self.links.values() {
            enqueue(&link.writer, Packet::Bye);
        }
        for request in self.pending.drain(..) {
            reject(request.connection, request.send);
        }
        let _ = timeout(Duration::from_millis(650), async {
            while self.tasks.join_next().await.is_some() {}
        })
        .await;
    }
}

fn enqueue(writer: &mpsc::Sender<Arc<Packet>>, packet: Packet) {
    let _ = writer.try_send(Arc::new(packet));
}

fn forward(link: &Link, packet: &Arc<Packet>) {
    if let Err(mpsc::error::TrySendError::Full(_)) = link.writer.try_send(packet.clone()) {
        link.connection.close(0u8.into(), b"buffer");
    }
}

async fn peer_io(
    id: Uuid,
    _connection: Connection,
    mut send: SendStream,
    mut recv: RecvStream,
    mut outbox: mpsc::Receiver<Arc<Packet>>,
    inbox: mpsc::Sender<Incoming>,
) {
    let read = async {
        while let Ok(packet) = read_packet(&mut recv).await {
            if matches!(packet, Packet::Bye)
                || inbox.send(Incoming::Packet(id, packet)).await.is_err()
            {
                break;
            }
        }
    };
    let write = async {
        while let Some(packet) = outbox.recv().await {
            if send_packet_ref(&mut send, &packet).await.is_err() {
                break;
            }
            if matches!(packet.as_ref(), Packet::Bye) {
                let _ = send.finish();
                let _ = timeout(Duration::from_millis(500), send.stopped()).await;
                break;
            }
        }
    };
    tokio::select! { _ = read => {}, _ = write => {} }
    let _ = inbox.send(Incoming::Left(id)).await;
}
