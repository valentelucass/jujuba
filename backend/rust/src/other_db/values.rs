use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use sqlx::{
    mysql::MySqlRow, postgres::PgRow, sqlite::SqliteRow, types::Json, Column, Row, TypeInfo,
    ValueRef,
};
use std::fmt::Write;

macro_rules! text {
    ($row:expr, $index:expr, $type:ty) => {
        $row.try_get::<$type, _>($index)
            .ok()
            .map(|value| value.to_string())
    };
}

fn preview(text: String) -> String {
    text.chars().take(2048).collect()
}

fn hex(bytes: Vec<u8>) -> String {
    let mut text = String::from("0x");
    for byte in bytes.into_iter().take(1023) {
        let _ = write!(text, "{byte:02x}");
    }
    text
}

pub(super) fn mysql(row: &MySqlRow, index: usize) -> Option<String> {
    if row.try_get_raw(index).ok()?.is_null() {
        return None;
    }
    let kind = row.columns()[index].type_info().name();
    let value = match kind {
        "BOOLEAN" => text!(row, index, bool),
        "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "BIGINT" => text!(row, index, i64),
        "TINYINT UNSIGNED" | "SMALLINT UNSIGNED" | "MEDIUMINT UNSIGNED" | "INT UNSIGNED"
        | "BIGINT UNSIGNED" | "BIT" | "YEAR" => text!(row, index, u64),
        "FLOAT" => text!(row, index, f32),
        "DOUBLE" => text!(row, index, f64),
        "DECIMAL" => text!(row, index, bigdecimal::BigDecimal),
        "DATE" => text!(row, index, NaiveDate),
        "TIME" => text!(row, index, sqlx::mysql::types::MySqlTime),
        "DATETIME" | "TIMESTAMP" => text!(row, index, NaiveDateTime),
        "JSON" => row
            .try_get::<Json<serde_json::Value>, _>(index)
            .ok()
            .map(|json| json.0.to_string()),
        "GEOMETRY" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB" | "TINYBLOB" | "BINARY" | "VARBINARY" => {
            row.try_get_unchecked::<Vec<u8>, _>(index).ok().map(hex)
        }
        _ => row.try_get_unchecked::<String, _>(index).ok(),
    };
    Some(preview(value.unwrap_or_else(|| format!("[{kind}]"))))
}

pub(super) fn postgres(row: &PgRow, index: usize) -> Option<String> {
    if row.try_get_raw(index).ok()?.is_null() {
        return None;
    }
    let kind = row.columns()[index].type_info().name();
    let value = match kind {
        "BOOL" => text!(row, index, bool),
        "INT2" => text!(row, index, i16),
        "INT4" => text!(row, index, i32),
        "INT8" => text!(row, index, i64),
        "OID" => row
            .try_get::<sqlx::postgres::types::Oid, _>(index)
            .ok()
            .map(|oid| oid.0.to_string()),
        "FLOAT4" => text!(row, index, f32),
        "FLOAT8" => text!(row, index, f64),
        "NUMERIC" => text!(row, index, bigdecimal::BigDecimal),
        "DATE" => text!(row, index, NaiveDate),
        "TIME" => text!(row, index, NaiveTime),
        "TIMESTAMP" => text!(row, index, NaiveDateTime),
        "TIMESTAMPTZ" => text!(row, index, DateTime<Utc>),
        "UUID" => text!(row, index, uuid::Uuid),
        "JSON" | "JSONB" => row
            .try_get::<Json<serde_json::Value>, _>(index)
            .ok()
            .map(|json| json.0.to_string()),
        "BYTEA" => row.try_get::<Vec<u8>, _>(index).ok().map(hex),
        "TEXT" | "VARCHAR" | "BPCHAR" | "NAME" | "UNKNOWN" => text!(row, index, String),
        _ => None,
    };
    Some(preview(value.unwrap_or_else(|| format!("[{kind}]"))))
}

pub(super) fn sqlite(row: &SqliteRow, index: usize) -> Option<String> {
    let raw = row.try_get_raw(index).ok()?;
    if raw.is_null() {
        return None;
    }
    let kind = raw.type_info();
    let value = match kind.name() {
        "INTEGER" | "BOOLEAN" | "INT4" => text!(row, index, i64),
        "REAL" => text!(row, index, f64),
        "BLOB" => row.try_get::<Vec<u8>, _>(index).ok().map(hex),
        _ => row.try_get_unchecked::<String, _>(index).ok(),
    };
    Some(preview(
        value.unwrap_or_else(|| format!("[{}]", kind.name())),
    ))
}
