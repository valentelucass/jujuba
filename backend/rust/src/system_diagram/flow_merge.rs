use super::model::{Diagram, MAX_EDGES, MAX_NODES, MAX_NOTES};

pub(super) fn merge(current: &mut Diagram, before: &Diagram, after: &Diagram) {
    update(&mut current.title, &before.title, &after.title);
    update(&mut current.summary, &before.summary, &after.summary);
    update(
        &mut current.requirements,
        &before.requirements,
        &after.requirements,
    );
    update(
        &mut current.open_questions,
        &before.open_questions,
        &after.open_questions,
    );

    current.nodes.retain(|node| {
        !before.nodes.iter().any(|previous| previous.id == node.id)
            || after.nodes.iter().any(|edited| edited.id == node.id)
    });

    for edited in &after.nodes {
        let previous = before.nodes.iter().find(|node| node.id == edited.id);
        let has_room = current.nodes.len() < MAX_NODES;
        let target = current.nodes.iter_mut().find(|node| node.id == edited.id);
        match (previous, target) {
            (Some(previous), Some(target)) => {
                update(&mut target.label, &previous.label, &edited.label);
                update(&mut target.kind, &previous.kind, &edited.kind);
                update(&mut target.detail, &previous.detail, &edited.detail);
                update(&mut target.position, &previous.position, &edited.position);
            }
            (None, None) if has_room => current.nodes.push(edited.clone()),
            _ => {}
        }
    }

    current.notes.retain(|note| {
        !before.notes.iter().any(|previous| previous.id == note.id)
            || after.notes.iter().any(|edited| edited.id == note.id)
    });
    for edited in &after.notes {
        let previous = before.notes.iter().find(|note| note.id == edited.id);
        let has_room = current.notes.len() < MAX_NOTES;
        let target = current.notes.iter_mut().find(|note| note.id == edited.id);
        match (previous, target) {
            (Some(previous), Some(target)) => {
                update(&mut target.text, &previous.text, &edited.text);
                update(&mut target.position, &previous.position, &edited.position);
            }
            (None, None) if has_room => current.notes.push(edited.clone()),
            _ => {}
        }
    }
    let exists = |id: &str| current.nodes.iter().any(|node| node.id == id);
    current.edges.retain(|edge| {
        exists(&edge.from)
            && exists(&edge.to)
            && (!before.edges.contains(edge) || after.edges.contains(edge))
    });
    for edge in &after.edges {
        if current.edges.len() == MAX_EDGES {
            break;
        }
        if !before.edges.contains(edge)
            && !current.edges.contains(edge)
            && exists(&edge.from)
            && exists(&edge.to)
        {
            current.edges.push(edge.clone());
        }
    }
}

fn update<T: PartialEq + Clone>(value: &mut T, before: &T, after: &T) {
    if before != after {
        value.clone_from(after);
    }
}
