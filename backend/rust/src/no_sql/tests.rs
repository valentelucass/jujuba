use super::*;
use crate::{connection::Connections, models::Scope};

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
}

#[test]
fn validates_extended_json_and_preserves_binary_key_identity() {
    let filter =
        parse_filter(r#"{"_id":{"$oid":"655f0d3fd0ec202ca591c43d"},"valor":{"$gte":5}}"#).unwrap();
    assert!(matches!(filter.get("_id"), Some(Bson::ObjectId(_))));
    assert!(parse_filter("[]").is_err());
    assert!(parse_filter("{").is_err());
    assert_eq!(preview(b"\xffa", 40), "0xff61");
    assert_eq!(preview("ação".as_bytes(), 2), "a…");
}

#[test]
#[ignore = "requer MongoDB de teste local"]
fn opens_mongodb_and_filters_a_collection() {
    runtime().block_on(async {
        let uri = std::env::var("JUJUBA_TEST_MONGO_URI").unwrap();
        assert!(uri.starts_with("mongodb://127.0.0.1:"));
        let seed = Client::with_uri_str(&uri).await.unwrap();
        let name = format!("jujuba_test_{}", std::process::id());
        let database = seed.database(&name);
        let items = database.collection::<Document>("pedidos");
        items
            .insert_many([
                doc! { "_id": 1, "cliente": "Ana" },
                doc! { "_id": 2, "cliente": "Bia" },
            ])
            .await
            .unwrap();

        let connections = Connections::default();
        let active = connections
            .connect_nosql(Engine::Mongodb, uri)
            .await
            .unwrap();
        assert!(active.databases.contains(&name));
        let scope = Scope {
            session: active.session,
            database: name,
        };
        let connection = connections.no_sql(&scope).await.unwrap();
        assert_eq!(
            connection.collections(&scope.database).await.unwrap(),
            ["pedidos"]
        );
        let page = connection
            .documents(&scope.database, "pedidos", r#"{"cliente":"Ana"}"#, 0)
            .await
            .unwrap();
        assert_eq!(page.documents.len(), 1);
        assert!(page.documents[0].json.contains("Ana"));
        assert!(!page.has_next);

        connections.disconnect().await;
        assert!(connections.no_sql(&scope).await.is_err());
        database.drop().await.unwrap();
    });
}

#[test]
#[ignore = "requer Redis de teste local"]
fn opens_redis_and_reads_keys_values_and_expiration() {
    runtime().block_on(async {
        let uri = std::env::var("JUJUBA_TEST_REDIS_URI").unwrap();
        assert!(uri.starts_with("redis://127.0.0.1:"));
        let connections = Connections::default();
        let active = connections.connect_nosql(Engine::Redis, uri).await.unwrap();
        let scope = Scope {
            session: active.session,
            database: active.databases[0].clone(),
        };
        let session = connections.no_sql(&scope).await.unwrap();
        let NoSqlSession::Redis(manager) = session.as_ref() else {
            panic!("Esperava Redis")
        };
        let mut manager = manager.clone();
        let prefix = format!("jujuba:{}:", std::process::id());
        let key = format!("{prefix}nome");
        let hashed = format!("{prefix}hash");
        let sorted = format!("{prefix}zset");
        let stream = format!("{prefix}stream");
        let binary = [prefix.as_bytes(), b"\xff"].concat();
        let _: () = redis::pipe()
            .cmd("SETEX")
            .arg(&key)
            .arg(120)
            .arg("Ana")
            .ignore()
            .cmd("HSET")
            .arg(&hashed)
            .arg("cliente")
            .arg("Bia")
            .ignore()
            .cmd("ZADD")
            .arg(&sorted)
            .arg(2)
            .arg("Bia")
            .ignore()
            .cmd("XADD")
            .arg(&stream)
            .arg("*")
            .arg("cliente")
            .arg("Bia")
            .ignore()
            .cmd("SET")
            .arg(&binary)
            .arg("binário")
            .ignore()
            .query_async(&mut manager)
            .await
            .unwrap();

        let page = session
            .redis_keys("0", &format!("{prefix}*"))
            .await
            .unwrap();
        assert_eq!(page.keys.len(), 5);
        let entry = session.redis_entry(&STANDARD.encode(&key)).await.unwrap();
        assert_eq!(entry.kind, "string");
        assert_eq!(entry.value, json!("Ana"));
        assert!((1..=120).contains(&entry.ttl));
        let entry = session
            .redis_entry(&STANDARD.encode(&hashed))
            .await
            .unwrap();
        assert_eq!(entry.value, json!([{"campo":"cliente","valor":"Bia"}]));
        let entry = session
            .redis_entry(&STANDARD.encode(&sorted))
            .await
            .unwrap();
        assert_eq!(entry.value, json!([{"membro":"Bia","pontuação":"2"}]));
        let entry = session
            .redis_entry(&STANDARD.encode(&stream))
            .await
            .unwrap();
        assert_eq!(entry.value[0]["campos"][0]["valor"], "Bia");
        let entry = session
            .redis_entry(&STANDARD.encode(&binary))
            .await
            .unwrap();
        assert_eq!(entry.value, "binário");
        let _: i64 = redis::cmd("DEL")
            .arg(&key)
            .arg(&hashed)
            .arg(&sorted)
            .arg(&stream)
            .arg(binary)
            .query_async(&mut manager)
            .await
            .unwrap();
    });
}
