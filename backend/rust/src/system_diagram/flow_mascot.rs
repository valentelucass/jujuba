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
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MeetingKind {
    Kiss,
    Play,
    Bounce,
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
        self.id > 0 && valid_point(self.position)
    }
}

fn valid_point(position: Position) -> bool {
    (0.0..=1.0).contains(&position.x) && (0.0..=1.0).contains(&position.y)
}
