//! muda-based menu builder — used for the app menu bar, tray menus, the
//! **context menu popup** (see `webview::show_context_menu`), and (Windows
//! only) the native menu bar attached via `Menu::init_for_hwnd` (see
//! `build_windows_menu_bar` below).

use std::{cell::RefCell, rc::Rc};

use napi::bindgen_prelude::{Error, Result, Status};
use muda::{accelerator::Accelerator, AboutMetadata, Icon, Menu, MenuItem, PredefinedMenuItem, Submenu};

use crate::types::MenuItemOptions;

/// A currently-installed application menu, shared between whoever installs
/// it (`Application`/the prod launcher, at startup) and the `{ kind:
/// "appMenu" }` IPC handler in `webview.rs` (which replaces it whenever
/// `useAppMenu` posts a new declaration). `Rc<RefCell<..>>` rather than an
/// owned value for the same reason `window::SharedWindow` /
/// `webview::SharedWebview` are: more than one piece of code needs to see —
/// and, here, replace — the same live value.
pub(crate) type SharedMenu = Rc<RefCell<Option<Menu>>>;

/// A single top-level menu in `useAppMenu`'s wire payload (`{ kind:
/// "appMenu", menus }`, see `webview.rs`) — either a custom `{ label, items
/// }` submenu or a standard-role one (`role: "editMenu" | "windowMenu"`).
/// `items` reuses `MenuItemOptions`, the same wire shape the context-menu
/// popup already uses — its `role` field additionally accepts, here,
/// `AppMenuItemRole`'s vocabulary (quit/close/minimize/zoom/undo/redo/cut/
/// copy/paste/selectAll — see `predefined_localized` (macOS) /
/// `windows_role_item` (Windows)). Not `#[napi(object)]`: only ever
/// deserialized out of the IPC payload, never a direct napi function param.
#[derive(Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct AppMenuSpec {
  pub(crate) role: Option<String>,
  pub(crate) label: Option<String>,
  pub(crate) items: Option<Vec<MenuItemOptions>>,
}

pub(crate) fn build_menu(items: &[MenuItemOptions]) -> Result<Menu> {
  let menu = Menu::new();
  for item in items {
    append_item(&menu, item)?;
  }
  Ok(menu)
}

/// Inputs for the native "About <app>" panel. See `build_about_credits` and
/// `build_default_app_menu` for how these map onto muda's `AboutMetadata` —
/// macOS and Windows/Linux render different subsets of its fields.
#[cfg(target_os = "macos")]
pub(crate) struct AboutInfo<'a> {
  pub name: &'a str,
  pub icon_path: Option<&'a str>,
  pub version: Option<&'a str>,
  pub description: Option<&'a str>,
  pub copyright: Option<&'a str>,
  pub homepage: Option<&'a str>,
  pub authors: Option<&'a [String]>,
}

/// Owned counterpart of `AboutInfo` — needed wherever the about-metadata has
/// to outlive a single function call, unlike `AboutInfo`'s borrowed `&str`s.
/// Specifically: `webview::AppMenuContext` retains one of these for the
/// lifetime of the `Webview`, so a `{ kind: "appMenu" }` IPC message arriving
/// long after startup can still prepend the standard app-name submenu (see
/// `build_macos_app_menu_from_spec`) using the same info the startup default
/// menu was built from.
#[cfg(target_os = "macos")]
#[derive(Clone)]
pub(crate) struct AboutInfoOwned {
  pub name: String,
  pub icon_path: Option<String>,
  pub version: Option<String>,
  pub description: Option<String>,
  pub copyright: Option<String>,
  pub homepage: Option<String>,
  pub authors: Option<Vec<String>>,
}

#[cfg(target_os = "macos")]
impl AboutInfoOwned {
  pub(crate) fn as_ref(&self) -> AboutInfo<'_> {
    AboutInfo {
      name: &self.name,
      icon_path: self.icon_path.as_deref(),
      version: self.version.as_deref(),
      description: self.description.as_deref(),
      copyright: self.copyright.as_deref(),
      homepage: self.homepage.as_deref(),
      authors: self.authors.as_deref(),
    }
  }
}

/// Builds the standard macOS application menu bar (App / Edit / Window) for
/// `info.name`. macOS treats the menu bar's first submenu as the bold "app
/// menu" — that's what makes `About <name>` / `Quit <name>` appear under the
/// app name next to the apple logo. Callers install the result via
/// `Menu::init_for_nsapp()`.
///
/// `labels` supplies localized text for muda's predefined items, which are
/// hardcoded to English otherwise — see `crate::types::MenuLabels`. Any field
/// left `None` (or `labels` itself being `None`) falls back to muda's English
/// default for that item.
///
/// Assembled from `build_macos_app_submenu`/`build_macos_edit_submenu`/
/// `build_macos_window_submenu` below — the same three building blocks
/// `build_macos_app_menu_from_spec` (the `useAppMenu`-driven path) reuses for
/// its prepended app-name submenu and `'editMenu'`/`'windowMenu'` roles, kept
/// factored out so both paths render identical App/Edit/Window submenus.
#[cfg(target_os = "macos")]
pub(crate) fn build_default_app_menu(
  info: &AboutInfo,
  labels: Option<&crate::types::MenuLabels>,
) -> Result<Menu> {
  let menu = Menu::new();
  let app_menu = build_macos_app_submenu(info, labels)?;
  let edit_menu = build_macos_edit_submenu(labels)?;
  let window_menu = build_macos_window_submenu(labels)?;

  menu
    .append_items(&[&app_menu, &edit_menu, &window_menu])
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

  Ok(menu)
}

/// The bold "app name" submenu (About/Services/Hide/HideOthers/ShowAll/Quit)
/// — see `build_default_app_menu`'s doc comment.
#[cfg(target_os = "macos")]
fn build_macos_app_submenu(info: &AboutInfo, labels: Option<&crate::types::MenuLabels>) -> Result<Submenu> {
  let about_label = labels
    .and_then(|l| l.about.as_deref())
    .map(String::from)
    .unwrap_or_else(|| format!("About {}", info.name));
  // Provide explicit metadata so the standard About panel shows the product
  // name — without it macOS derives the panel from the running process, which
  // is the bundled `node` binary, and the panel reads "node". Likewise, the
  // panel only shows an icon if `icon` is `Some` — otherwise it falls back to
  // the bundle icon, which the bundled `node` process isn't associated with.
  let about_metadata = AboutMetadata {
    name: Some(info.name.to_string()),
    version: info.version.map(|s| s.to_string()),
    comments: info.description.map(|s| s.to_string()),
    copyright: info.copyright.map(|s| s.to_string()),
    website: info.homepage.map(|s| s.to_string()),
    authors: info.authors.map(|a| a.to_vec()),
    credits: build_about_credits(info.description, info.homepage),
    icon: info.icon_path.and_then(load_icon_rgba),
    ..Default::default()
  };

  let app_menu = Submenu::new(info.name, true);
  app_menu
    .append_items(&[
      &PredefinedMenuItem::about(Some(&about_label), Some(about_metadata)),
      &PredefinedMenuItem::separator(),
      &PredefinedMenuItem::services(labels.and_then(|l| l.services.as_deref())),
      &PredefinedMenuItem::separator(),
      &PredefinedMenuItem::hide(labels.and_then(|l| l.hide.as_deref())),
      &PredefinedMenuItem::hide_others(labels.and_then(|l| l.hide_others.as_deref())),
      &PredefinedMenuItem::show_all(labels.and_then(|l| l.show_all.as_deref())),
      &PredefinedMenuItem::separator(),
      &PredefinedMenuItem::quit(labels.and_then(|l| l.quit.as_deref())),
    ])
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

  Ok(app_menu)
}

/// The standard Edit submenu (Undo/Redo/sep/Cut/Copy/Paste/Select All) — see
/// `build_default_app_menu`'s doc comment.
#[cfg(target_os = "macos")]
fn build_macos_edit_submenu(labels: Option<&crate::types::MenuLabels>) -> Result<Submenu> {
  let edit_menu = Submenu::new(labels.and_then(|l| l.edit.as_deref()).unwrap_or("Edit"), true);
  edit_menu
    .append_items(&[
      &PredefinedMenuItem::undo(labels.and_then(|l| l.undo.as_deref())),
      &PredefinedMenuItem::redo(labels.and_then(|l| l.redo.as_deref())),
      &PredefinedMenuItem::separator(),
      &PredefinedMenuItem::cut(labels.and_then(|l| l.cut.as_deref())),
      &PredefinedMenuItem::copy(labels.and_then(|l| l.copy.as_deref())),
      &PredefinedMenuItem::paste(labels.and_then(|l| l.paste.as_deref())),
      &PredefinedMenuItem::select_all(labels.and_then(|l| l.select_all.as_deref())),
    ])
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

  Ok(edit_menu)
}

/// The standard Window submenu (Minimize/Zoom) — see `build_default_app_menu`'s
/// doc comment.
#[cfg(target_os = "macos")]
fn build_macos_window_submenu(labels: Option<&crate::types::MenuLabels>) -> Result<Submenu> {
  let window_menu = Submenu::new(
    labels.and_then(|l| l.window.as_deref()).unwrap_or("Window"),
    true,
  );
  window_menu
    .append_items(&[
      &PredefinedMenuItem::minimize(labels.and_then(|l| l.minimize.as_deref())),
      &PredefinedMenuItem::maximize(labels.and_then(|l| l.zoom.as_deref())),
    ])
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

  Ok(window_menu)
}

/// Builds a full menu bar from `useAppMenu`'s serialized spec (see
/// `webview.rs`'s `{ kind: "appMenu" }` IPC branch / `AppMenuSpec`).
///
/// **Design decision (v1): always prepends the standard app-name submenu**
/// (About/Services/Hide/Quit — `build_macos_app_submenu`) ahead of whatever
/// `menus` declares, exactly like the startup default menu always has one.
/// There's no way for an app to opt out or reposition it in this version —
/// doing so would mean supporting a menu-level `role: "appMenu"` so an app
/// could place/customize it explicitly, which v1 doesn't implement. Omitting
/// the app-name menu entirely isn't a realistic choice on macOS: without it
/// there's no `Quit <app>` and no `About <app>`, and Cmd+Q/Cmd+H stop
/// working, so "always prepend" was chosen over "never prepend" as the
/// safe default. Flagging this as the specific point the task asked to
/// flag explicitly.
///
/// Item-level roles (`quit`/`close`/`minimize`/`zoom`/`undo`/`redo`/`cut`/
/// `copy`/`paste`/`selectAll`) resolve to real muda `PredefinedMenuItem`s via
/// `predefined_localized` — same native, no-JS-involved behavior as the
/// startup default menu's Edit/Window items. Custom `{ id, label, action }`
/// items are plain `MenuItem`s; clicks on those reach JS via
/// `webview::poll_app_menu_events` (new — see that function's doc comment for
/// why macOS never needed a persistent poll before this feature).
#[cfg(target_os = "macos")]
pub(crate) fn build_macos_app_menu_from_spec(
  menus: &[crate::menu::AppMenuSpec],
  info: &AboutInfo,
  labels: Option<&crate::types::MenuLabels>,
) -> Result<Menu> {
  let menu = Menu::new();

  let app_menu = build_macos_app_submenu(info, labels)?;
  menu
    .append(&app_menu)
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

  for spec in menus {
    match spec.role.as_deref() {
      Some("editMenu") => {
        let sub = build_macos_edit_submenu(labels)?;
        menu
          .append(&sub)
          .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
      }
      Some("windowMenu") => {
        let sub = build_macos_window_submenu(labels)?;
        menu
          .append(&sub)
          .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
      }
      _ => {
        let label = spec.label.as_deref().unwrap_or("");
        let sub = Submenu::new(label, true);
        for item in spec.items.as_deref().unwrap_or(&[]) {
          append_app_menu_item_macos(&sub, item, labels)?;
        }
        menu
          .append(&sub)
          .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
      }
    }
  }

  Ok(menu)
}

/// Item-level role → muda `PredefinedMenuItem`, localized via `labels` (unlike
/// `predefined` below, which the pre-existing context-menu path uses and
/// always passes `None` — left as-is to avoid changing that feature's
/// behavior). `"close"` has no dedicated `MenuLabels` field (no
/// `menu-locales.json` entry — same known gap as `build_windows_menu_bar`'s
/// "File"/"Exit"), so it always falls back to muda's English default.
#[cfg(target_os = "macos")]
fn predefined_localized(role: &str, labels: Option<&crate::types::MenuLabels>) -> Option<PredefinedMenuItem> {
  match role {
    "quit" => Some(PredefinedMenuItem::quit(labels.and_then(|l| l.quit.as_deref()))),
    "close" => Some(PredefinedMenuItem::close_window(None)),
    "minimize" => Some(PredefinedMenuItem::minimize(labels.and_then(|l| l.minimize.as_deref()))),
    "zoom" => Some(PredefinedMenuItem::maximize(labels.and_then(|l| l.zoom.as_deref()))),
    "undo" => Some(PredefinedMenuItem::undo(labels.and_then(|l| l.undo.as_deref()))),
    "redo" => Some(PredefinedMenuItem::redo(labels.and_then(|l| l.redo.as_deref()))),
    "cut" => Some(PredefinedMenuItem::cut(labels.and_then(|l| l.cut.as_deref()))),
    "copy" => Some(PredefinedMenuItem::copy(labels.and_then(|l| l.copy.as_deref()))),
    "paste" => Some(PredefinedMenuItem::paste(labels.and_then(|l| l.paste.as_deref()))),
    "selectAll" => Some(PredefinedMenuItem::select_all(labels.and_then(|l| l.select_all.as_deref()))),
    _ => None,
  }
}

/// Recursive item builder for `build_macos_app_menu_from_spec` — mirrors
/// `append_submenu_item` below (the context-menu path's equivalent) but
/// resolves roles via `predefined_localized` instead of `predefined`, so
/// `useAppMenu`'s role items get real localized text.
#[cfg(target_os = "macos")]
fn append_app_menu_item_macos(
  sub: &Submenu,
  item: &MenuItemOptions,
  labels: Option<&crate::types::MenuLabels>,
) -> Result<()> {
  if item.separator.unwrap_or(false) {
    sub
      .append(&PredefinedMenuItem::separator())
      .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    return Ok(());
  }

  if let Some(role) = item.role.as_deref() {
    if let Some(predef) = predefined_localized(role, labels) {
      sub
        .append(&predef)
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
      return Ok(());
    }
  }

  let label = item.label.as_deref().unwrap_or("");
  let enabled = item.enabled.unwrap_or(true);
  let accelerator = item
    .accelerator
    .as_deref()
    .and_then(|s| s.parse::<Accelerator>().ok());

  if let Some(inner_items) = &item.submenu {
    let inner = Submenu::new(label, enabled);
    for c in inner_items {
      append_app_menu_item_macos(&inner, c, labels)?;
    }
    sub
      .append(&inner)
      .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  } else {
    let mi = if let Some(id) = &item.id {
      MenuItem::with_id(id.as_str(), label, enabled, accelerator)
    } else {
      MenuItem::new(label, enabled, accelerator)
    };
    sub
      .append(&mi)
      .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  }

  Ok(())
}

/// macOS's standard About panel ignores `comments`/`website`, so fold the
/// description and homepage into `credits` (the one free-text field it does
/// render). Windows/Linux ignore `credits` and read the structured fields
/// instead, so both paths stay populated.
#[cfg(target_os = "macos")]
fn build_about_credits(description: Option<&str>, homepage: Option<&str>) -> Option<String> {
  let mut lines: Vec<&str> = Vec::new();
  if let Some(d) = description {
    if !d.is_empty() {
      lines.push(d);
    }
  }
  if let Some(h) = homepage {
    if !h.is_empty() {
      lines.push(h);
    }
  }
  if lines.is_empty() {
    None
  } else {
    Some(lines.join("\n"))
  }
}

/// Decodes a PNG at `path` into a `muda::Icon` for the About panel. Returns
/// `None` on any decode failure (unreadable file, unsupported color type,
/// etc.) — callers fall back to no icon rather than erroring out.
#[cfg(target_os = "macos")]
fn load_icon_rgba(path: &str) -> Option<Icon> {
  let file = std::fs::File::open(path).ok()?;
  let decoder = png::Decoder::new(file);
  let mut reader = decoder.read_info().ok()?;
  let mut buf = vec![0; reader.output_buffer_size()];
  let frame = reader.next_frame(&mut buf).ok()?;
  buf.truncate(frame.buffer_size());

  let info = reader.info();
  let (width, height) = (info.width, info.height);

  let rgba = match (info.color_type, info.bit_depth) {
    (png::ColorType::Rgba, png::BitDepth::Eight) => buf,
    (png::ColorType::Rgb, png::BitDepth::Eight) => {
      let mut out = Vec::with_capacity(buf.len() / 3 * 4);
      for chunk in buf.chunks_exact(3) {
        out.extend_from_slice(chunk);
        out.push(255);
      }
      out
    }
    _ => return None,
  };

  Icon::from_rgba(rgba, width, height).ok()
}

/// Windows only: stable item ids for `build_windows_menu_bar`'s custom
/// `MenuItem`s, shared with `webview::poll_menu_bar_events` (the event-loop
/// poll that dispatches clicks on these — see that function) so the builder
/// and the dispatcher never drift apart.
#[cfg(target_os = "windows")]
pub(crate) mod windows_menu_bar_ids {
  pub(crate) const EXIT: &str = "murasaki-menu-bar:exit";
  pub(crate) const UNDO: &str = "murasaki-menu-bar:undo";
  pub(crate) const REDO: &str = "murasaki-menu-bar:redo";
  pub(crate) const CUT: &str = "murasaki-menu-bar:cut";
  pub(crate) const COPY: &str = "murasaki-menu-bar:copy";
  pub(crate) const PASTE: &str = "murasaki-menu-bar:paste";
  pub(crate) const SELECT_ALL: &str = "murasaki-menu-bar:selectAll";
  pub(crate) const MINIMIZE: &str = "murasaki-menu-bar:minimize";
  /// Added for `useAppMenu`'s `role: "zoom"` item (toggle-maximize) — the
  /// startup default Windows bar has no Zoom item of its own (only
  /// Minimize), so this id is only ever produced by `windows_role_item`.
  pub(crate) const ZOOM: &str = "murasaki-menu-bar:zoom";
}

/// Builds the native Win32 menu bar (File / Edit / Window), attached via
/// `Menu::init_for_hwnd` (see `application.rs::create_window` and
/// `launcher.rs`'s `imp_win`). Windows has no "bold app name" menu concept
/// like macOS's app menu, so this is a plain top-level bar rather than
/// `build_default_app_menu`'s App/Edit/Window shape — just File/Edit/Window.
///
/// Every item here is a **custom** `MenuItem` with a stable id
/// (`windows_menu_bar_ids`), not a muda `PredefinedMenuItem` like the macOS
/// builder uses. On macOS, predefined Edit items (`copy:`/`paste:`/etc.) ride
/// Cocoa's responder chain into the focused `WKWebView`, which handles them
/// natively — Windows has no equivalent: muda's Windows `PredefinedMenuItem`s
/// for Undo/Redo/Cut/Copy/Paste/SelectAll target native Win32 edit controls,
/// which a WebView2 host window never is, so they'd be silent no-ops here.
/// Instead, clicks are picked up asynchronously via `muda::MenuEvent::receiver()`
/// (the menu bar is persistent, unlike the modal context-menu popup in
/// `webview.rs`) and mapped to `document.execCommand(...)` in the webview for
/// the Edit items, or handled natively (window/process) for Minimize/Exit —
/// see `webview::poll_menu_bar_events`.
///
/// `labels` mirrors macOS's `MenuLabels` (see that struct's doc comment and
/// `build_default_app_menu`), but `menu-locales.json` has no "File"/"Exit"
/// entry (only the macOS App/Edit/Window vocabulary) — "File" always falls
/// back to the English literal, and "Exit" reuses the localized `quit` label
/// (close enough: both mean "close the app"). Flagged here as a known gap
/// rather than blocking on adding new locale keys.
///
/// No keyboard accelerators are set on these items: muda's own docs note
/// accelerators are inert on Windows unless the host also runs
/// `TranslateAcceleratorW` against `Menu::haccel()` in its raw message loop,
/// which tao doesn't expose a hook for — so they'd show a shortcut hint that
/// doesn't actually fire. Left off rather than shipping a decorative-only,
/// possibly-misleading label.
#[cfg(target_os = "windows")]
pub(crate) fn build_windows_menu_bar(labels: Option<&crate::types::MenuLabels>) -> Result<Menu> {
  use windows_menu_bar_ids as ids;

  let menu = Menu::new();

  let file_menu = Submenu::new("File", true);
  let exit_label = labels.and_then(|l| l.quit.as_deref()).unwrap_or("Exit");
  file_menu
    .append(&MenuItem::with_id(ids::EXIT, exit_label, true, None))
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

  let edit_menu = build_windows_edit_submenu(labels)?;
  let window_menu = build_windows_window_submenu(labels)?;

  menu
    .append_items(&[&file_menu, &edit_menu, &window_menu])
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

  Ok(menu)
}

/// The Edit submenu (Undo/Redo/sep/Cut/Copy/Paste/Select All) — factored out
/// of `build_windows_menu_bar` so `build_windows_app_menu_from_spec`'s
/// `role: "editMenu"` can reuse it verbatim (same ids, so
/// `webview::poll_menu_bar_events` handles clicks on it identically whether
/// it came from the startup bar or an app-declared one).
#[cfg(target_os = "windows")]
fn build_windows_edit_submenu(labels: Option<&crate::types::MenuLabels>) -> Result<Submenu> {
  use windows_menu_bar_ids as ids;

  let edit_menu = Submenu::new(labels.and_then(|l| l.edit.as_deref()).unwrap_or("Edit"), true);
  edit_menu
    .append_items(&[
      &MenuItem::with_id(ids::UNDO, labels.and_then(|l| l.undo.as_deref()).unwrap_or("Undo"), true, None),
      &MenuItem::with_id(ids::REDO, labels.and_then(|l| l.redo.as_deref()).unwrap_or("Redo"), true, None),
      &PredefinedMenuItem::separator(),
      &MenuItem::with_id(ids::CUT, labels.and_then(|l| l.cut.as_deref()).unwrap_or("Cut"), true, None),
      &MenuItem::with_id(ids::COPY, labels.and_then(|l| l.copy.as_deref()).unwrap_or("Copy"), true, None),
      &MenuItem::with_id(ids::PASTE, labels.and_then(|l| l.paste.as_deref()).unwrap_or("Paste"), true, None),
      &MenuItem::with_id(
        ids::SELECT_ALL,
        labels.and_then(|l| l.select_all.as_deref()).unwrap_or("Select All"),
        true,
        None,
      ),
    ])
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

  Ok(edit_menu)
}

/// The Window submenu (Minimize) — factored out of `build_windows_menu_bar`,
/// same reasoning as `build_windows_edit_submenu` above.
#[cfg(target_os = "windows")]
fn build_windows_window_submenu(labels: Option<&crate::types::MenuLabels>) -> Result<Submenu> {
  use windows_menu_bar_ids as ids;

  let window_menu = Submenu::new(labels.and_then(|l| l.window.as_deref()).unwrap_or("Window"), true);
  window_menu
    .append(&MenuItem::with_id(
      ids::MINIMIZE,
      labels.and_then(|l| l.minimize.as_deref()).unwrap_or("Minimize"),
      true,
      None,
    ))
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

  Ok(window_menu)
}

/// Builds a full menu bar from `useAppMenu`'s serialized spec — the Windows
/// counterpart of `build_macos_app_menu_from_spec`. No app-name submenu to
/// prepend here (Windows has no such concept — see `build_windows_menu_bar`'s
/// doc comment), so this just renders `menus` in order.
#[cfg(target_os = "windows")]
pub(crate) fn build_windows_app_menu_from_spec(
  menus: &[crate::menu::AppMenuSpec],
  labels: Option<&crate::types::MenuLabels>,
) -> Result<Menu> {
  let menu = Menu::new();

  for spec in menus {
    match spec.role.as_deref() {
      Some("editMenu") => {
        let sub = build_windows_edit_submenu(labels)?;
        menu
          .append(&sub)
          .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
      }
      Some("windowMenu") => {
        let sub = build_windows_window_submenu(labels)?;
        menu
          .append(&sub)
          .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
      }
      _ => {
        let label = spec.label.as_deref().unwrap_or("");
        let sub = Submenu::new(label, true);
        for item in spec.items.as_deref().unwrap_or(&[]) {
          append_app_menu_item_windows(&sub, item, labels)?;
        }
        menu
          .append(&sub)
          .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
      }
    }
  }

  Ok(menu)
}

/// Item-level role → a custom `MenuItem` with a stable id, localized via
/// `labels`. `"quit"` and `"close"` both map to `windows_menu_bar_ids::EXIT`
/// (the same id/behavior the startup bar's File > Exit uses) — a deliberate
/// v1 simplification: murasaki is single-window today, so "close the window"
/// and "quit the app" are the same outcome. `"close"` has no dedicated
/// `MenuLabels` field (same known gap noted on `build_windows_menu_bar`), so
/// it falls back to the localized `quit` label, then the English literal.
#[cfg(target_os = "windows")]
fn windows_role_item(role: &str, labels: Option<&crate::types::MenuLabels>) -> Option<MenuItem> {
  use windows_menu_bar_ids as ids;

  match role {
    "undo" => Some(MenuItem::with_id(ids::UNDO, labels.and_then(|l| l.undo.as_deref()).unwrap_or("Undo"), true, None)),
    "redo" => Some(MenuItem::with_id(ids::REDO, labels.and_then(|l| l.redo.as_deref()).unwrap_or("Redo"), true, None)),
    "cut" => Some(MenuItem::with_id(ids::CUT, labels.and_then(|l| l.cut.as_deref()).unwrap_or("Cut"), true, None)),
    "copy" => Some(MenuItem::with_id(ids::COPY, labels.and_then(|l| l.copy.as_deref()).unwrap_or("Copy"), true, None)),
    "paste" => Some(MenuItem::with_id(ids::PASTE, labels.and_then(|l| l.paste.as_deref()).unwrap_or("Paste"), true, None)),
    "selectAll" => Some(MenuItem::with_id(
      ids::SELECT_ALL,
      labels.and_then(|l| l.select_all.as_deref()).unwrap_or("Select All"),
      true,
      None,
    )),
    "minimize" => Some(MenuItem::with_id(
      ids::MINIMIZE,
      labels.and_then(|l| l.minimize.as_deref()).unwrap_or("Minimize"),
      true,
      None,
    )),
    "zoom" => Some(MenuItem::with_id(ids::ZOOM, labels.and_then(|l| l.zoom.as_deref()).unwrap_or("Zoom"), true, None)),
    "quit" => Some(MenuItem::with_id(ids::EXIT, labels.and_then(|l| l.quit.as_deref()).unwrap_or("Quit"), true, None)),
    "close" => Some(MenuItem::with_id(ids::EXIT, labels.and_then(|l| l.quit.as_deref()).unwrap_or("Close"), true, None)),
    _ => None,
  }
}

/// Recursive item builder for `build_windows_app_menu_from_spec` — mirrors
/// `append_submenu_item` below (the context-menu path's equivalent) but
/// resolves roles via `windows_role_item` instead of `predefined` (Windows
/// `PredefinedMenuItem`s don't work here — see `build_windows_menu_bar`'s
/// doc comment).
#[cfg(target_os = "windows")]
fn append_app_menu_item_windows(
  sub: &Submenu,
  item: &MenuItemOptions,
  labels: Option<&crate::types::MenuLabels>,
) -> Result<()> {
  if item.separator.unwrap_or(false) {
    sub
      .append(&PredefinedMenuItem::separator())
      .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    return Ok(());
  }

  if let Some(role) = item.role.as_deref() {
    if let Some(mi) = windows_role_item(role, labels) {
      sub
        .append(&mi)
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
      return Ok(());
    }
  }

  let label = item.label.as_deref().unwrap_or("");
  let enabled = item.enabled.unwrap_or(true);
  let accelerator = item
    .accelerator
    .as_deref()
    .and_then(|s| s.parse::<Accelerator>().ok());

  if let Some(inner_items) = &item.submenu {
    let inner = Submenu::new(label, enabled);
    for c in inner_items {
      append_app_menu_item_windows(&inner, c, labels)?;
    }
    sub
      .append(&inner)
      .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  } else {
    let mi = if let Some(id) = &item.id {
      MenuItem::with_id(id.as_str(), label, enabled, accelerator)
    } else {
      MenuItem::new(label, enabled, accelerator)
    };
    sub
      .append(&mi)
      .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  }

  Ok(())
}

fn append_item(menu: &Menu, item: &MenuItemOptions) -> Result<()> {
  if item.separator.unwrap_or(false) {
    menu
      .append(&PredefinedMenuItem::separator())
      .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    return Ok(());
  }

  if let Some(role) = item.role.as_deref() {
    if let Some(predef) = predefined(role) {
      menu
        .append(&predef)
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
      return Ok(());
    }
  }

  let label = item.label.as_deref().unwrap_or("");
  let enabled = item.enabled.unwrap_or(true);
  let accelerator = item
    .accelerator
    .as_deref()
    .and_then(|s| s.parse::<Accelerator>().ok());

  if let Some(sub_items) = &item.submenu {
    let sub = Submenu::new(label, enabled);
    for child in sub_items {
      append_submenu_item(&sub, child)?;
    }
    menu
      .append(&sub)
      .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  } else {
    let mi = if let Some(id) = &item.id {
      MenuItem::with_id(id.as_str(), label, enabled, accelerator)
    } else {
      MenuItem::new(label, enabled, accelerator)
    };
    menu
      .append(&mi)
      .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  }

  Ok(())
}

fn append_submenu_item(sub: &Submenu, item: &MenuItemOptions) -> Result<()> {
  if item.separator.unwrap_or(false) {
    sub
      .append(&PredefinedMenuItem::separator())
      .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
    return Ok(());
  }

  if let Some(role) = item.role.as_deref() {
    if let Some(predef) = predefined(role) {
      sub
        .append(&predef)
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
      return Ok(());
    }
  }

  let label = item.label.as_deref().unwrap_or("");
  let enabled = item.enabled.unwrap_or(true);
  let accelerator = item
    .accelerator
    .as_deref()
    .and_then(|s| s.parse::<Accelerator>().ok());

  if let Some(inner_items) = &item.submenu {
    let inner = Submenu::new(label, enabled);
    for c in inner_items {
      append_submenu_item(&inner, c)?;
    }
    sub
      .append(&inner)
      .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  } else {
    let mi = if let Some(id) = &item.id {
      MenuItem::with_id(id.as_str(), label, enabled, accelerator)
    } else {
      MenuItem::new(label, enabled, accelerator)
    };
    sub
      .append(&mi)
      .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
  }

  Ok(())
}

fn predefined(role: &str) -> Option<PredefinedMenuItem> {
  match role {
    "about" => Some(PredefinedMenuItem::about(None, None)),
    "copy" => Some(PredefinedMenuItem::copy(None)),
    "cut" => Some(PredefinedMenuItem::cut(None)),
    "paste" => Some(PredefinedMenuItem::paste(None)),
    "selectAll" | "select-all" => Some(PredefinedMenuItem::select_all(None)),
    "undo" => Some(PredefinedMenuItem::undo(None)),
    "redo" => Some(PredefinedMenuItem::redo(None)),
    "quit" => Some(PredefinedMenuItem::quit(None)),
    "hide" => Some(PredefinedMenuItem::hide(None)),
    "hideOthers" | "hide-others" => Some(PredefinedMenuItem::hide_others(None)),
    "showAll" | "show-all" => Some(PredefinedMenuItem::show_all(None)),
    "services" => Some(PredefinedMenuItem::services(None)),
    "minimize" => Some(PredefinedMenuItem::minimize(None)),
    "maximize" => Some(PredefinedMenuItem::maximize(None)),
    "closeWindow" | "close-window" => Some(PredefinedMenuItem::close_window(None)),
    "fullscreen" | "toggleFullscreen" => Some(PredefinedMenuItem::fullscreen(None)),
    "separator" => Some(PredefinedMenuItem::separator()),
    _ => None,
  }
}
