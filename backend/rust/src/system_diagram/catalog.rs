use super::ai::{self, Provider};
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, time::Duration};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModel {
    pub(super) id: String,
    pub(super) label: String,
    pub(super) reasoning_efforts: Vec<String>,
    pub(super) default_reasoning_effort: Option<String>,
}

pub(super) async fn models(provider: Provider) -> Result<Vec<AgentModel>> {
    let mut models = match provider {
        Provider::Claude => super::claude_catalog::models().await?,
        Provider::Codex | Provider::Gemini => {
            let dir = tempfile::tempdir().map_err(|_| catalog_error())?;
            let mut command = provider.command(dir.path())?;
            if matches!(provider, Provider::Codex) {
                command.args(["debug", "models"]);
            } else {
                command.args(["--list-models", "--output-format", "json"]);
            }
            let output = ai::run(provider, command, b"", Duration::from_secs(25)).await?;
            if matches!(provider, Provider::Codex) {
                codex_models(&output)?
            } else {
                gemini_models(&output)?
            }
        }
    };
    let mut seen = HashSet::new();
    models.retain_mut(|model| {
        model
            .reasoning_efforts
            .retain(|level| ai::valid_effort_id(level));
        model.default_reasoning_effort = model
            .default_reasoning_effort
            .take()
            .filter(|level| model.reasoning_efforts.contains(level));
        ai::valid_model_id(&model.id)
            && !model.label.trim().is_empty()
            && seen.insert(model.id.clone())
    });
    if models.is_empty() {
        return Err(catalog_error());
    }
    Ok(models)
}

fn catalog_error() -> AppError {
    AppError::new(
        "ai",
        "O cliente de IA não informou os modelos disponíveis. Confira a versão e a conexão.",
    )
}

#[derive(Deserialize)]
struct CodexCatalog {
    models: Vec<CodexModel>,
}

#[derive(Deserialize)]
struct CodexModel {
    slug: String,
    display_name: String,
    visibility: String,
    #[serde(default)]
    supported_reasoning_levels: Vec<CodexLevel>,
    default_reasoning_level: Option<String>,
}

#[derive(Deserialize)]
struct CodexLevel {
    effort: String,
}

fn codex_models(output: &str) -> Result<Vec<AgentModel>> {
    let catalog: CodexCatalog = serde_json::from_str(output).map_err(|_| catalog_error())?;
    Ok(catalog
        .models
        .into_iter()
        .filter(|model| model.visibility == "list")
        .map(|model| {
            let levels: Vec<_> = model
                .supported_reasoning_levels
                .into_iter()
                .map(|level| level.effort)
                .collect();
            AgentModel {
                id: model.slug,
                label: model.display_name,
                default_reasoning_effort: model
                    .default_reasoning_level
                    .filter(|level| levels.contains(level)),
                reasoning_efforts: levels,
            }
        })
        .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiModel {
    id: String,
    display_name: String,
}

fn gemini_models(output: &str) -> Result<Vec<AgentModel>> {
    let models: Vec<GeminiModel> = serde_json::from_str(output).map_err(|_| catalog_error())?;
    // Gemini CLI's model listing has no selectable effort for a single invocation.
    Ok(models
        .into_iter()
        .map(|model| AgentModel {
            id: model.id,
            label: model.display_name,
            reasoning_efforts: Vec::new(),
            default_reasoning_effort: None,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_keeps_visible_models_and_their_own_levels() {
        let models = codex_models(r#"{"models":[
            {"slug":"first","display_name":"First","visibility":"list","supported_reasoning_levels":[{"effort":"low"},{"effort":"ultra"}],"default_reasoning_level":"low"},
            {"slug":"internal","display_name":"Hidden","visibility":"hide"},
            {"slug":"second","display_name":"Second","visibility":"list","supported_reasoning_levels":[{"effort":"medium"}],"default_reasoning_level":"high"}
        ]}"#).unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].reasoning_efforts, ["low", "ultra"]);
        assert_eq!(models[0].default_reasoning_effort.as_deref(), Some("low"));
        assert_eq!(models[1].id, "second");
        assert_eq!(models[1].reasoning_efforts, ["medium"]);
        assert!(models[1].default_reasoning_effort.is_none());
    }

    #[test]
    fn gemini_returns_cli_models_with_automatic_reasoning() {
        let models = gemini_models(
            r#"[{"id":"gemini-example","displayName":"Gemini Example","contextLimits":{}}]"#,
        )
        .unwrap();
        assert_eq!(models[0].id, "gemini-example");
        assert_eq!(models[0].label, "Gemini Example");
        assert!(models[0].reasoning_efforts.is_empty());
        assert!(gemini_models("invalid response").is_err());
    }
}
