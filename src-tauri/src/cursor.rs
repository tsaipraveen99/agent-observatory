//! Read-only access to Cursor's local conversation store.
//!
//! The webview cannot query SQLite, so these two commands return raw rows;
//! all parsing and normalization lives in TypeScript where it is unit-tested.
//! The database is opened SQLITE_OPEN_READ_ONLY — this module cannot write.

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::PathBuf;

fn cursor_user_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    Ok(PathBuf::from(home).join("Library/Application Support/Cursor/User"))
}

fn open_db() -> Result<Connection, String> {
    let db = cursor_user_dir()?.join("globalStorage/state.vscdb");
    if !db.exists() {
        return Err("cursor-not-found".to_string());
    }
    Connection::open_with_flags(&db, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("open failed: {e}"))
}

fn workspace_folder(workspace_id: &str) -> Option<String> {
    if !workspace_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let path = cursor_user_dir()
        .ok()?
        .join("workspaceStorage")
        .join(workspace_id)
        .join("workspace.json");
    let text = std::fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    json.get("folder")?.as_str().map(|s| s.to_string())
}

#[derive(Serialize)]
pub struct CursorComposerHeader {
    pub composer_id: String,
    pub workspace_folder: Option<String>,
    pub created_at: Option<i64>,
    pub last_updated_at: Option<i64>,
    pub is_subagent: bool,
}

#[tauri::command]
pub fn cursor_headers() -> Result<Vec<CursorComposerHeader>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT composerId, workspaceId, createdAt, lastUpdatedAt, isSubagent \
             FROM composerHeaders WHERE isArchived IS NOT 1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(CursorComposerHeader {
                composer_id: row.get(0)?,
                workspace_folder: row
                    .get::<_, Option<String>>(1)?
                    .as_deref()
                    .and_then(workspace_folder),
                created_at: row.get(2)?,
                last_updated_at: row.get(3)?,
                is_subagent: row.get::<_, Option<i64>>(4)?.unwrap_or(0) == 1,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct CursorConversation {
    pub composer_data: Option<String>,
    pub bubbles: Vec<String>,
}

fn valid_composer_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

#[tauri::command]
pub fn cursor_conversation(composer_id: String) -> Result<CursorConversation, String> {
    if !valid_composer_id(&composer_id) {
        return Err("invalid composer id".to_string());
    }
    let conn = open_db()?;
    let composer_data: Option<String> = conn
        .query_row(
            "SELECT value FROM cursorDiskKV WHERE key = ?1",
            [format!("composerData:{composer_id}")],
            |row| row.get(0),
        )
        .ok();
    let mut stmt = conn
        .prepare("SELECT value FROM cursorDiskKV WHERE key LIKE ?1")
        .map_err(|e| e.to_string())?;
    let bubbles = stmt
        .query_map([format!("bubbleId:{composer_id}:%")], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(CursorConversation { composer_data, bubbles })
}
