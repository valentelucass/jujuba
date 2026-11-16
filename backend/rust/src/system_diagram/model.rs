use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fmt::Write,
};

pub const MAX_NODES: usize = 24;
pub const MAX_EDGES: usize = 48;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagram {
    pub title: String,
    pub summary: String,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    #[serde(default)]
    pub requirements: Vec<String>,
    #[serde(default)]
    pub open_questions: Vec<String>,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Start,
    Action,
    Decision,
    End,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    pub kind: Kind,
    pub label: String,
    #[serde(default)]
    pub detail: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<Position>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Edge {
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub label: String,
}

impl Diagram {
    pub fn validate_draft(&self) -> Result<()> {
        self.validate_flow(false)
    }

    pub fn validate(&self) -> Result<()> {
        self.validate_flow(true)
    }

    fn validate_flow(&self, complete: bool) -> Result<()> {
        if self.title.len() > 120
            || (complete && self.title.trim().is_empty())
            || self.summary.len() > 2400
            || self.nodes.len() > MAX_NODES
            || self.edges.len() > MAX_EDGES
            || !list(&self.requirements)
            || !list(&self.open_questions)
        {
            return Err(invalid("Confira o título e o tamanho do diagrama."));
        }

        let mut kinds = HashMap::new();
        let mut start = None;
        let mut ends = Vec::new();
        for node in &self.nodes {
            let id = node.id.as_str();
            if id.is_empty()
                || id.len() > 40
                || !id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
                || node.label.len() > 140
                || (complete && node.label.trim().is_empty())
                || node
                    .position
                    .is_some_and(|p| !([-p.x, p.x, -p.y, p.y].iter().all(|n| *n <= 100_000.0)))
                || node.detail.len() > 900
                || kinds.insert(id, node.kind).is_some()
            {
                return Err(invalid(
                    "As etapas precisam de nomes válidos e identificadores distintos.",
                ));
            }
            match node.kind {
                Kind::Start if start.replace(id).is_some() && complete => {
                    return Err(invalid("Use apenas um início."))
                }
                Kind::End => ends.push(id),
                _ => {}
            }
        }
        let mut forward: HashMap<&str, Vec<&str>> = HashMap::new();
        let mut reverse: HashMap<&str, Vec<&str>> = HashMap::new();
        let mut decisions: HashMap<&str, HashSet<String>> = HashMap::new();
        let mut transitions = HashSet::new();
        for edge in &self.edges {
            let (from, to) = (edge.from.as_str(), edge.to.as_str());
            let label = edge.label.trim();
            if !kinds.contains_key(from)
                || !kinds.contains_key(to)
                || from == to
                || label.len() > 120
                || (complete
                    && (kinds.get(to) == Some(&Kind::Start)
                        || kinds.get(from) == Some(&Kind::End)
                        || !transitions.insert((from, to, label))))
            {
                return Err(invalid(
                    "Confira as conexões entre as etapas e remova as conexões repetidas.",
                ));
            }
            if complete
                && kinds.get(from) == Some(&Kind::Decision)
                && (label.is_empty()
                    || !decisions
                        .entry(from)
                        .or_default()
                        .insert(label.to_lowercase()))
            {
                return Err(invalid("Dê um nome diferente a cada saída de uma decisão."));
            }
            forward.entry(from).or_default().push(to);
            reverse.entry(to).or_default().push(from);
        }

        if !complete {
            return Ok(());
        }
        let start = start.ok_or_else(|| invalid("Adicione um início ao fluxo."))?;
        if ends.is_empty() {
            return Err(invalid("Adicione um fim ao fluxo."));
        }
        for (id, kind) in &kinds {
            let count = forward.get(id).map_or(0, Vec::len);
            match kind {
                Kind::Start | Kind::Action if count != 1 => return Err(invalid(
                    "O início e cada ação precisam de uma saída. Use uma decisão para ramificar.",
                )),
                Kind::Decision if count < 2 => {
                    return Err(invalid("Cada decisão precisa de pelo menos duas saídas."))
                }
                _ => {}
            }
        }

        if reach(&forward, vec![start]) != kinds.len() {
            return Err(invalid(
                "Todas as etapas precisam ser alcançáveis a partir do início.",
            ));
        }
        if reach(&reverse, ends) != kinds.len() {
            return Err(invalid("Cada etapa precisa ter um caminho até um fim."));
        }
        Ok(())
    }

    pub fn markdown(&self) -> String {
        let mut out = format!(
            "# {}\n\n{}\n\n## Fluxo\n\n```mermaid\nflowchart TD\n",
            one_line(&self.title),
            self.summary.trim()
        );
        let ids: HashMap<_, _> = self
            .nodes
            .iter()
            .enumerate()
            .map(|(i, node)| (node.id.as_str(), i))
            .collect();
        for (index, node) in self.nodes.iter().enumerate() {
            let label = mermaid_label(&node.label);
            let shape = match node.kind {
                Kind::Start | Kind::End => format!("([\"{label}\"])"),
                Kind::Decision => format!("{{\"{label}\"}}"),
                Kind::Action => format!("[\"{label}\"]"),
            };
            let _ = writeln!(out, "  n{index}{shape}");
        }
        for edge in &self.edges {
            let from = ids[edge.from.as_str()];
            let to = ids[edge.to.as_str()];
            if edge.label.trim().is_empty() {
                let _ = writeln!(out, "  n{from} --> n{to}");
            } else {
                let _ = writeln!(
                    out,
                    "  n{from} -->|\"{}\"| n{to}",
                    mermaid_label(&edge.label)
                );
            }
        }
        out.push_str("```\n\n## Etapas\n");
        for node in &self.nodes {
            let _ = writeln!(out, "- **{}**", one_line(&node.label));
            if !node.detail.trim().is_empty() {
                let _ = writeln!(out, "  {}", one_line(&node.detail));
            }
        }
        for (heading, entries) in [
            ("Requisitos", &self.requirements),
            ("Questões em aberto", &self.open_questions),
        ] {
            if !entries.is_empty() {
                let _ = writeln!(out, "\n## {heading}\n");
                for item in entries {
                    let _ = writeln!(out, "- {}", one_line(item));
                }
            }
        }
        out
    }
}

pub fn invalid(message: &'static str) -> AppError {
    AppError::new("input", message)
}

fn text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.contains('\0')
}
fn list(values: &[String]) -> bool {
    values.len() <= 16 && values.iter().all(|item| text(item, 450))
}
fn one_line(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn mermaid_label(value: &str) -> String {
    let mut label = String::new();
    for c in one_line(value).chars() {
        if matches!(c, '#' | '"' | '\'' | '|' | '<' | '>' | '&' | '`') {
            let _ = write!(label, "#{};", c as u32);
        } else {
            label.push(c);
        }
    }
    label
}

fn reach<'a>(adjacent: &HashMap<&'a str, Vec<&'a str>>, mut pending: Vec<&'a str>) -> usize {
    let mut visited = HashSet::new();
    while let Some(node) = pending.pop() {
        if visited.insert(node) {
            if let Some(neighbors) = adjacent.get(node) {
                pending.extend(neighbors);
            }
        }
    }
    visited.len()
}
