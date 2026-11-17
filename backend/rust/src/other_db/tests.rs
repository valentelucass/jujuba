use super::*;
use crate::models::{Authentication, Filter, RecordsInput, Scope, Sort, TableScope};

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
}

async fn check_catalog(session: &OtherSession, database: &str, schema: &str) {
    assert!(session
        .schemas(database)
        .await
        .unwrap()
        .contains(&schema.to_owned()));
    let tables = session.tables(database, Some(schema)).await.unwrap();
    let orders = tables.iter().find(|table| table.name == "orders").unwrap();
    let customers = tables
        .iter()
        .find(|table| table.name == "customers")
        .unwrap();
    let structure = session.structure(database, customers.id).await.unwrap();
    assert_eq!(structure.columns.len(), 2);
    assert_eq!(structure.columns[0].name, "id");
    assert!(structure.columns[0].primary_key);
    assert_eq!(structure.columns[1].name, "name");
    assert!(!structure.columns[1].editable);

    let page = session
        .records(
            database,
            RecordsInput {
                table: TableScope {
                    scope: Scope {
                        session: 1,
                        database: database.into(),
                    },
                    table_id: customers.id,
                },
                page: 0,
                page_size: 25,
                sort: Some(Sort {
                    column_id: structure.columns[1].id,
                    descending: false,
                }),
                filter: Some(Filter {
                    column_id: structure.columns[1].id,
                    text: "Ana".into(),
                }),
            },
        )
        .await
        .unwrap();
    assert_eq!(page.rows, vec![vec![Some("1".into()), Some("Ana".into())]]);
    assert!(page.stable_order);
    assert!(!page.has_next);

    let diagram = session.diagram(database).await.unwrap();
    let dashboard = crate::engine_dashboard::sql(session.client(database).await.unwrap())
        .await
        .unwrap();
    let report = serde_json::to_value(dashboard).unwrap();
    assert!(report["metrics"][0]["value"].as_u64().unwrap() >= 2);
    assert!(report["metrics"]
        .as_array()
        .unwrap()
        .iter()
        .any(|metric| metric["unit"] == "bytes" && metric["value"].as_u64().unwrap() > 0));
    assert!(diagram.tables.iter().any(|table| table.id == orders.id));
    assert!(diagram
        .relationships
        .iter()
        .any(|fk| fk.source.id == orders.id
            && fk.target.id == customers.id
            && fk.columns[0].source == "customer_id"
            && fk.columns[0].target == "id"));
    assert!(!session
        .relationships(database, orders.id)
        .await
        .unwrap()
        .is_empty());

    let result = session
        .read(database, "SELECT id, name FROM customers ORDER BY id")
        .await
        .unwrap();
    assert_eq!(result.columns, ["id", "name"]);
    assert_eq!(result.rows[1], [Some("2".into()), Some("Bia".into())]);
    let empty = session
        .read(database, "SELECT name FROM customers WHERE id = 0")
        .await
        .unwrap();
    assert_eq!(empty.columns, ["name"]);
    assert!(empty.rows.is_empty());
    assert!(session
        .read(database, "SELECT 1; DELETE FROM customers")
        .await
        .is_err());
}

fn input(engine: Engine) -> ConnectInput {
    ConnectInput {
        engine,
        database: None,
        path: None,
        host: "127.0.0.1".into(),
        port: 0,
        transport: Transport::Network,
        instance: None,
        authentication: Authentication::Sql,
        username: None,
        password: None,
    }
}

#[test]
fn opens_a_sqlite_file_and_reads_its_catalog() {
    runtime().block_on(async {
        let path = std::env::temp_dir().join(format!("jujuba-catalog-{}.sqlite", std::process::id()));
        let pool = SqlitePoolOptions::new().max_connections(1)
            .connect_with(SqliteConnectOptions::new().filename(&path).create_if_missing(true)).await.unwrap();
        sqlx::raw_sql("CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
            CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers);
            CREATE INDEX order_customer ON orders(customer_id);
            INSERT INTO customers VALUES (1, 'Ana'), (2, 'Bia');
            INSERT INTO orders VALUES (1, 1);").execute(&pool).await.unwrap();
        pool.close().await;
        let (session, _, _, databases) = OtherSession::connect(ConnectInput {
            path: Some(path.to_string_lossy().into_owned()), ..input(Engine::Sqlite)
        }).await.unwrap();
        check_catalog(&session, &databases[0], "main").await;
        let tables = session.tables(&databases[0], Some("main")).await.unwrap();
        let orders = tables.iter().find(|table| table.name == "orders").unwrap();
        let structure = session.structure(&databases[0], orders.id).await.unwrap();
        assert_eq!(structure.indexes[0].name, "order_customer");

        if let Pools::Sqlite(pool) = &session.pools {
            assert!(sqlx::query("DELETE FROM customers").execute(pool).await.is_err());
            pool.close().await;
        }
        std::fs::remove_file(path).unwrap();
    });
}

#[test]
#[ignore = "requer um MySQL de teste local com as tabelas customers e orders"]
fn reads_a_mysql_database() {
    check_server(Engine::Mysql, "MYSQL", "jujuba_test");
}

#[test]
#[ignore = "requer um PostgreSQL de teste local com as tabelas customers e orders"]
fn reads_a_postgres_database() {
    check_server(Engine::Postgres, "POSTGRES", "public");
}

fn check_server(engine: Engine, prefix: &str, schema: &str) {
    let setting = |name| std::env::var(format!("JUJUBA_TEST_{prefix}_{name}")).unwrap();
    runtime().block_on(async {
        let (session, _, _, databases) = OtherSession::connect(ConnectInput {
            database: Some("postgres".into()),
            port: setting("PORT").parse().unwrap(),
            username: Some(setting("USER")),
            password: Some(setting("PASSWORD")),
            ..input(engine)
        })
        .await
        .unwrap();
        assert!(databases.contains(&"jujuba_test".to_owned()));
        check_catalog(&session, "jujuba_test", schema).await;
    });
}
