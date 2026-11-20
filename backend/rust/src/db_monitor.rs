use serde::Serialize;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseMonitor {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sql_server: Option<SqlServerSessions>,
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

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub database: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_request_end: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<IndexUsage>,
    pub name: String,
    pub metric: String,
    pub value: u64,
    pub unit: String,
    pub window: String,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlServerSessions {
    pub host_memory_low: Option<bool>,
    pub process_memory_low: Option<bool>,
    pub waiting_for_memory: Option<u64>,
    pub full_visibility: bool,
    pub database_count: Option<u64>,
    pub instance_count: Option<u64>,
    pub instance_rows: Vec<Activity>,
    pub objects_available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexUsage {
    pub reads: u64,
    pub updates: u64,
    pub last_access: Option<String>,
}
