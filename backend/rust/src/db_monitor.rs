use serde::Serialize;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseMonitor {
    pub memory: Memory,
    pub indicators: Vec<Indicator>,
    pub activity: Vec<Activity>,
    pub objects: Vec<ObjectActivity>,
    pub notes: Vec<String>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub label: String,
    pub scope: String,
    pub used_bytes: Option<u64>,
    pub limit_bytes: Option<u64>,
    pub limit_label: String,
    pub native_peak_bytes: Option<u64>,
    pub native_peak_label: String,
}

#[derive(Default, Serialize)]
pub struct Indicator {
    pub label: String,
    pub value: u64,
    pub unit: String,
    pub scope: String,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub application: Option<String>,
    pub client: Option<String>,
    pub operation: Option<String>,
    pub state: Option<String>,
    pub object: Option<String>,
    pub elapsed_ms: Option<u64>,
}

#[derive(Default, Serialize)]
pub struct ObjectActivity {
    pub name: String,
    pub metric: String,
    pub value: u64,
    pub unit: String,
    pub window: String,
}
