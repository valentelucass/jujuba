use super::model::Position;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mascot {
    pub position: Position,
    pub hat: String,
    pub pose: Pose,
    pub flight: Option<Flight>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scene: Option<Scene>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Scene {
    pub epoch: u32,
    pub origin: Position,
    pub toy: Option<Toy>,
    pub clone: Option<Companion>,
    pub young: Vec<Young>,
    pub hits: Vec<TargetHit>,
    #[serde(default)]
    pub sounds: Vec<SceneSound>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub burst: Option<GooBurst>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct GooBurst {
    pub id: u32,
    pub point: Position,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub members: Option<Vec<Uuid>>,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SceneSoundKind {
    Throw,
    SlimeKick,
    BounceOffWall,
    Hatch,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SceneSound {
    pub id: u32,
    pub kind: SceneSoundKind,
    pub strength: f64,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToyKind {
    Blaster,
    Bow,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Toy {
    pub epoch: u32,
    pub kind: ToyKind,
    pub anchor: Position,
    pub direction: Position,
    pub shoulder: Position,
    pub hand: Position,
    pub stretch: f64,
    pub boost: f64,
    pub power: f64,
    pub shots: Vec<Shot>,
    pub sparks: Vec<Spark>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Shot {
    pub id: u32,
    pub point: Position,
    pub direction: Position,
    pub power: f64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Spark {
    pub id: u32,
    pub point: Position,
    pub kind: SparkKind,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SparkKind {
    Muzzle,
    Impact,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Companion {
    pub point: Position,
    pub hat: String,
    pub pose: Pose,
    pub flight: Option<Flight>,
    pub greeting: Option<MeetingKind>,
    pub direction: Option<Position>,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum YoungPhase {
    Egg,
    Young,
    Popping,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Young {
    pub id: u32,
    pub point: Position,
    pub phase: YoungPhase,
    pub rotation: f64,
    pub squash: f64,
    pub held: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dissolving: Option<DissolvingBody>,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DissolvingBody {
    Egg,
    Young,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct TargetHit {
    pub id: u32,
    pub target: String,
    pub impulse: Impulse,
    pub pop: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peer: Option<Uuid>,
}

fn valid_direction(direction: Position) -> bool {
    (0.8..=1.01).contains(&direction.x.hypot(direction.y))
}

fn valid_hat(hat: &str) -> bool {
    !hat.is_empty() && hat.len() <= 24 && hat.bytes().all(|c| c.is_ascii_alphabetic())
}

fn valid_flight(flight: &Flight) -> bool {
    flight.velocity_x.abs() <= 3500.01 && (0.0..=1.0).contains(&flight.squash)
}

impl Scene {
    fn valid(&self) -> bool {
        self.epoch > 0
            && valid_point(self.origin)
            && self.young.len() <= 100
            && self.hits.len() <= 16
            && self.sounds.len() <= 16
            && self.burst.as_ref().is_none_or(|burst| {
                burst.id > 0
                    && valid_point(burst.point)
                    && burst
                        .members
                        .as_ref()
                        .is_none_or(|members| members.len() <= 7)
            })
            && self
                .sounds
                .iter()
                .all(|sound| sound.id > 0 && (0.0..=1.5).contains(&sound.strength))
            && self.toy.as_ref().is_none_or(Toy::valid)
            && self.clone.as_ref().is_none_or(|pet| {
                valid_point(pet.point)
                    && valid_hat(&pet.hat)
                    && pet.flight.as_ref().is_none_or(valid_flight)
                    && pet.direction.is_none_or(valid_direction)
            })
            && self.young.iter().all(|child| {
                child.id > 0
                    && valid_point(child.point)
                    && child.rotation.abs() <= 90.0
                    && (0.0..=1.0).contains(&child.squash)
                    && (child.dissolving.is_none() || matches!(child.phase, YoungPhase::Popping))
            })
            && self.hits.iter().all(|hit| {
                hit.id > 0
                    && hit.impulse.valid()
                    && (matches!(hit.target.as_str(), "main" | "clone")
                        || hit
                            .target
                            .strip_prefix("young:")
                            .and_then(|id| id.parse::<u32>().ok())
                            .is_some_and(|id| id > 0))
            })
    }
}

impl Toy {
    fn valid(&self) -> bool {
        self.epoch > 0
            && valid_point(self.anchor)
            && valid_point(self.shoulder)
            && valid_point(self.hand)
            && valid_direction(self.direction)
            && (0.0..=1.0).contains(&self.stretch)
            && (0.0..=1.0).contains(&self.boost)
            && (0.0..=1.91).contains(&self.power)
            && self.shots.len() <= 8
            && self.sparks.len() <= 16
            && self.shots.iter().all(|shot| {
                shot.id > 0
                    && valid_point(shot.point)
                    && valid_direction(shot.direction)
                    && (0.0..=1.91).contains(&shot.power)
            })
            && self
                .sparks
                .iter()
                .all(|spark| spark.id > 0 && valid_point(spark.point))
    }
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peer: Option<Uuid>,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DragKind {
    Grab,
    Move,
    Release,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ChildDrag {
    pub id: u32,
    pub kind: DragKind,
    pub point: Position,
    #[serde(default)]
    pub velocity: Option<Position>,
}

impl ChildDrag {
    pub fn valid(&self) -> bool {
        self.id > 0
            && valid_point(self.point)
            && self
                .velocity
                .is_none_or(|velocity| velocity.x.abs() <= 8.0 && velocity.y.abs() <= 8.0)
    }
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
            && valid_hat(&self.hat)
            && self.flight.as_ref().is_none_or(valid_flight)
            && self.scene.as_ref().is_none_or(Scene::valid)
    }
}

impl Impulse {
    fn valid(&self) -> bool {
        valid_direction(self.direction) && (120.0..=1900.0).contains(&self.strength)
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
