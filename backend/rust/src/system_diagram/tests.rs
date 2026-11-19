use super::{
    files::{self, CodeFile, ProjectCode},
    model::{Diagram, Edge, Kind, Node, Note, Position},
};

#[test]
fn accepts_legacy_mascots_and_validates_custom_color() {
    let mut mascot: super::flow_mascot::Mascot = serde_json::from_value(serde_json::json!({
        "position": { "x": 0.3, "y": 0.6 }, "hat": "none", "pose": "idle"
    })).unwrap();
    assert!(mascot.valid());
    assert!(serde_json::to_value(&mascot).unwrap().get("color").is_none());
    mascot.color = Some("#AA31eF".into());
    assert!(mascot.valid());
    mascot.color = Some("#abé12".into());
    assert!(!mascot.valid());
}

fn example() -> Diagram {
    let node = |id: &str, kind, label: &str| Node {
        id: id.into(),
        kind,
        label: label.into(),
        detail: "Regra da etapa".into(),
        position: None,
    };
    let edge = |from: &str, to: &str, label: &str| Edge {
        from: from.into(),
        to: to.into(),
        label: label.into(),
    };
    Diagram {
        title: "Cadastro".into(),
        summary: "Verificar dados do cadastro".into(),
        nodes: vec![
            node("start", Kind::Start, "Início"),
            node("form", Kind::Action, "Preencher"),
            node("check", Kind::Decision, "Está completo?"),
            node("end", Kind::End, "Salvo"),
        ],
        edges: vec![
            edge("start", "form", ""),
            edge("form", "check", ""),
            edge("check", "form", "Não"),
            edge("check", "end", "Sim"),
        ],
        requirements: vec!["Validar os campos".into()],
        open_questions: vec![],
        notes: Vec::new(),
    }
}

#[test]
fn permits_retry_paths_and_rejects_unreachable_or_ambiguous_decisions() {
    let mut flow = example();
    flow.validate().unwrap();
    let markdown = flow.markdown();
    assert!(markdown.contains("n2 -->|\"Não\"| n1"));
    assert!(markdown.contains("Validar os campos"));
    flow.edges[3].label = "Não".into();
    assert!(flow.validate().is_err());
    flow.edges.pop();
    assert!(flow.validate().is_err());
}

#[test]
fn opens_saved_file_and_detects_external_edits() {
    let target = tempfile::tempdir().unwrap();
    let path = target.path().join("cadastro.jujuba.json");
    let first = files::save(&path, None, example()).unwrap();
    assert_eq!(
        files::open_current(&first).unwrap().diagram.title,
        "Cadastro"
    );
    assert!(files::open_current(&first)
        .unwrap()
        .diagram
        .notes
        .is_empty());
    assert!(files::save(&path, None, example()).is_err());
    let mut revised = example();
    revised.title = "Cadastro v2".into();
    revised.nodes[1].position = Some(Position { x: -75.5, y: 240.0 });
    revised.edges.clear();
    revised.notes.push(Note {
        id: "nota-a".into(),
        text: "Revisar após aprovação\nProcurar histórico".into(),
        position: Position { x: 243.0, y: -31.0 },
    });
    assert!(revised.validate().is_err());
    let second = files::save(&path, Some(first.clone()), revised).unwrap();
    assert!(files::open_current(&first).is_err());
    let reopened = files::open_current(&second).unwrap().diagram;
    assert_eq!(reopened.title, "Cadastro v2");
    assert_eq!(
        reopened.nodes[1].position,
        Some(Position { x: -75.5, y: 240.0 })
    );
    assert!(reopened.edges.is_empty());
    assert_eq!(reopened.notes[0].position, Position { x: 243.0, y: -31.0 });
    assert_eq!(
        reopened.notes[0].text,
        "Revisar após aprovação\nProcurar histórico"
    );
    assert!(reopened
        .markdown()
        .contains("## Notas\n\n    Revisar após aprovação"));
}

#[test]
fn creates_separate_project_folders_and_only_valid_relative_files() {
    let target = tempfile::tempdir().unwrap();
    let code = |path: &str| ProjectCode {
        files: vec![CodeFile {
            path: path.into(),
            content: "conteúdo".into(),
        }],
    };
    let first = code("src/index.html").save(target.path()).unwrap();
    let second = code("README.md").save(target.path()).unwrap();
    assert_ne!(first, second);
    assert!(target
        .path()
        .join("sistema-gerado/src/index.html")
        .is_file());
    for path in [
        "../fora.txt",
        "C:/fora.txt",
        "/fora.txt",
        "app/..",
        "app/AUX.md",
        "file.txt:stream",
        ".git/config",
    ] {
        assert!(code(path).validate().is_err(), "{path}");
    }
}

#[test]
#[ignore = "requer Codex instalado e autenticado com ChatGPT"]
fn generates_a_real_flow_and_reads_it_back_to_generate_files() {
    let provider = super::ai::Provider::Codex;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        super::ai::check(provider).await.unwrap();
        let flow = super::ai::converse(provider, super::ai::AssistantRequest {
            screen: "Diagramas de sistema".into(), history: Vec::new(), diagram: None, options: None,
            documents: vec![serde_json::from_value(serde_json::json!({
                "name": "cadastro.md",
                "text": "Começa exibindo formulário de nome. A pessoa preenche. Decisão se o nome foi informado. Se não, retorna ao formulário. Se sim, mostra a saudação e finaliza."
            })).unwrap()],
            prompt: "Construa um fluxograma com os requisitos do documento anexado. Use de quatro a seis nós.".into(),
        }, None).await.unwrap().diagram.unwrap();
        assert!(flow.nodes.iter().any(|node| node.kind == Kind::Decision));
        let destination = tempfile::tempdir().unwrap();
        let path = destination.path().join("cadastro.jujuba.json");
        let project = files::save(&path, None, flow).unwrap();
        let flow = files::open_current(&project).unwrap().diagram;
        let code = super::ai::scaffold(provider, flow,
            "Implementação pequena. Use HTML, CSS e JavaScript simples em index.html e instruções em README.md. Limite-se a esses dois arquivos.".into(), None).await.unwrap();
        assert!(code.files.iter().any(|file| file.path == "index.html" && !file.content.is_empty()));
        code.save(destination.path()).unwrap();
        assert!(destination.path().join("sistema-gerado/index.html").is_file());
        let workspace = destination.path().join("sistema-gerado");
        let chat = super::ai::converse(provider, super::ai::AssistantRequest {
            screen: "Diagramas de sistema".into(), history: Vec::new(), documents: Vec::new(), diagram: None, options: None,
            prompt: "Crie neste projeto um arquivo validacao.txt contendo exatamente JUJUBA_OK em uma linha. Use as ferramentas e faça a alteração agora.".into(),
        }, Some(&workspace)).await.unwrap();
        assert!(chat.project_task, "{}", chat.reply);
        assert_eq!(std::fs::read_to_string(workspace.join("validacao.txt")).unwrap().trim(), "JUJUBA_OK");
    });
}
