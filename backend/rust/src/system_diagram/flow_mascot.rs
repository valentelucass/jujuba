use super::model::Position;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mascot {
    pub position: Position,
    pub hat: String,
    pub pose: Pose,
    pub flight: Option<Flight>,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Pose {
    Idle,
    Held,
    Wary,
    Scared,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Flight {
    pub velocity_x: f64,
    pub squash: f64,
    pub edge: Edge,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Edge {
    Top,
    Right,
    Bottom,
    Left,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meeting {
    pub id: u32,
    pub position: Position,
    pub kind: MeetingKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub impulse: Option<Impulse>,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MeetingKind {
    Kiss,
    Play,
    Bounce,
    Hug,
    Squeeze,
    Look,
    Dance,
    Push,
    Bump,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Impulse {
    pub direction: Position,
    pub strength: f64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Splat {
    pub id: u32,
    pub position: Position,
    pub edge: Edge,
    pub slide: f64,
    pub strength: f64,
}

impl Splat {
    pub fn valid(&self) -> bool {
        self.id > 0
            && valid_point(self.position)
            && (-1.0..=1.0).contains(&self.slide)
            && (0.0..=1.0).contains(&self.strength)
    }
}

impl Mascot {
    pub fn valid(&self) -> bool {
        valid_point(self.position)
            && !self.hat.is_empty()
            && self.hat.len() <= 24
            && self
                .hat
                .bytes()
                .all(|character| character.is_ascii_alphabetic())
            && self.flight.as_ref().is_none_or(|flight| {
                flight.velocity_x.abs() <= 3500.01 && (0.0..=1.0).contains(&flight.squash)
            })
    }
}

impl Meeting {
    pub fn valid(&self) -> bool {
        self.id > 0
            && valid_point(self.position)
            && self.impulse.is_none_or(|impulse| {
                matches!(self.kind, MeetingKind::Push | MeetingKind::Bump)
                    && (0.8..=1.01).contains(&impulse.direction.x.hypot(impulse.direction.y))
                    && (120.0..=1900.0).contains(&impulse.strength)
            })
    }
}

fn valid_point(position: Position) -> bool {
    (0.0..=1.0).contains(&position.x) && (0.0..=1.0).contains(&position.y)
}
