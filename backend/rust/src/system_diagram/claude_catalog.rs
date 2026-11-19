use super::{
    ai::{run, Provider},
    catalog::AgentModel,
};
use crate::error::{AppError, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

const REQUEST_ID: &str = "jujubasql-models";

pub(super) async fn models() -> Result<Vec<AgentModel>> {
    let directory = tempfile::tempdir().map_err(|_| catalog_error())?;
    let mut command = Provider::Claude.command(directory.path())?;
    command.args([
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--safe-mode",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--tools",
        "",
    ]);
    // The SDK handshake reports the account's model picker before any chat turn.
    let initialize = json!({
        "type": "control_request",
        "request_id": REQUEST_ID,
        "request": { "subtype": "initialize" }
    });
    let input = format!("{initialize}\n");
    let output = run(
        Provider::Claude,
        command,
        input.as_bytes(),
        Duration::from_secs(20),
    )
    .await?;
    parse_models(&output)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeModel {
    value: String,
    display_name: String,
    supports_effort: Option<bool>,
    #[serde(default)]
    supported_effort_levels: Vec<String>,
}

fn parse_models(output: &str) -> Result<Vec<AgentModel>> {
    for line in output.lines() {
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let response = &event["response"];
        if event["type"] != "control_response" || response["request_id"] != REQUEST_ID {
            continue;
        }
        if response["subtype"] != "success" {
            return Err(catalog_error());
        }
        let entries: Vec<ClaudeModel> =
            serde_json::from_value(response["response"]["models"].clone())
                .map_err(|_| catalog_error())?;
        let models = entries
            .into_iter()
            .filter(|model| !model.value.is_empty() && !model.display_name.is_empty())
            .map(|model| AgentModel {
                id: model.value,
                label: model.display_name,
                reasoning_efforts: if model.supports_effort == Some(false) {
                    Vec::new()
                } else {
                    model.supported_effort_levels
                },
                default_reasoning_effort: None,
            })
            .collect();
        return Ok(models);
    }
    Err(catalog_error())
}

fn catalog_error() -> AppError {
    AppError::new("ai", "Não foi possível ler os modelos do Claude Code.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_the_matching_handshake_and_each_models_own_efforts() {
        let output = concat!(
            "{\"type\":\"system\",\"subtype\":\"init\"}\n",
            "{\"type\":\"control_response\",\"response\":{\"request_id\":\"other\",\"subtype\":\"error\"}}\n",
            r#"{"type":"control_response","response":{"request_id":"jujubasql-models","subtype":"success","response":{"models":[{"value":"opus[1m]","displayName":"Opus","supportedEffortLevels":["high","max"]},{"value":"haiku","displayName":"Haiku","supportsEffort":false}]}}}"#
        );
        let models = parse_models(output).unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "opus[1m]");
        assert_eq!(models[0].reasoning_efforts, ["high", "max"]);
        assert!(models[1].reasoning_efforts.is_empty());
        assert!(parse_models(r#"{"type":"result"}"#).is_err());
    }
}
