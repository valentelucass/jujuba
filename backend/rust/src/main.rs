#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod catalog;
mod commands;
mod connection;
mod credentials;
mod edit;
mod editor;
mod engine_dashboard;
mod error;
mod models;
mod no_sql;
mod other_db;
mod records;
mod relationships;
mod sql_server;
mod system_diagram;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(connection::Connections::default())
        .manage(system_diagram::SelectedWorkspace::default())
        .manage(system_diagram::collaboration::FlowCollaboration::default())
        .setup(|app| {
            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(directory) = system_diagram::workspaces::directory(&app) {
                    app.state::<system_diagram::collaboration::FlowCollaboration>()
                        .restore_hosts(&directory);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connect,
            commands::choose_sqlite_file,
            commands::connect_nosql,
            commands::has_saved_uri,
            commands::forget_uri,
            commands::mongo_collections,
            commands::mongo_documents,
            commands::redis_keys,
            commands::redis_entry,
            commands::has_saved_password,
            commands::forget_password,
            commands::disconnect,
            commands::schemas,
            commands::tables,
            commands::structure,
            commands::records,
            commands::relationships,
            commands::database_diagram,
            commands::dashboard_overview,
            commands::dashboard_engine,
            commands::dashboard_storage,
            commands::dashboard_files,
            commands::dashboard_performance,
            commands::dashboard_live,
            commands::query_read,
            commands::update_cell,
            system_diagram::diagram_agent,
            system_diagram::diagram_choose_workspace,
            system_diagram::assistant_converse,
            system_diagram::diagram_open,
            system_diagram::diagram_save,
            system_diagram::diagram_markdown,
            system_diagram::diagram_png,
            system_diagram::diagram_scaffold,
            system_diagram::diagram_write_code,
            system_diagram::workspaces::flow_projects,
            system_diagram::workspaces::flow_project_load,
            system_diagram::workspaces::flow_project_create,
            system_diagram::workspaces::flow_project_link,
            system_diagram::collaboration::flow_project_remove,
            system_diagram::collaboration::flow_project_edit,
            system_diagram::collaboration::flow_collab_host,
            system_diagram::collaboration::flow_collab_join,
            system_diagram::collaboration::flow_collab_view,
            system_diagram::collaboration::flow_collab_command,
            system_diagram::collaboration::flow_collab_end,
        ])
        .build(tauri::generate_context!())
        .expect("iniciar o JujubaSQL")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } = event
            {
                let sessions = app.state::<system_diagram::collaboration::FlowCollaboration>();
                api.prevent_exit();
                if sessions.begin_shutdown() {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        app.state::<system_diagram::collaboration::FlowCollaboration>()
                            .shutdown()
                            .await;
                        app.exit(0);
                    });
                }
            }
        });
}
