//! muda-based menu builder — used for the app menu bar, tray menus, and
//! the **context menu popup** (see `webview::show_context_menu`).

use napi::bindgen_prelude::{Error, Result, Status};
use muda::{accelerator::Accelerator, AboutMetadata, Icon, Menu, MenuItem, PredefinedMenuItem, Submenu};

use crate::types::MenuItemOptions;

pub(crate) fn build_menu(items: &[MenuItemOptions]) -> Result<Menu> {
  let menu = Menu::new();
  for item in items {
    append_item(&menu, item)?;
  }
  Ok(menu)
}

/// Builds the standard macOS application menu bar (App / Edit / Window) for
/// `app_name`. macOS treats the menu bar's first submenu as the bold "app
/// menu" — that's what makes `About <app_name>` / `Quit <app_name>` appear
/// under the app name next to the apple logo. Callers install the result via
/// `Menu::init_for_nsapp()`.
#[cfg(target_os = "macos")]
pub(crate) fn build_default_app_menu(app_name: &str, icon_path: Option<&str>) -> Result<Menu> {
  let menu = Menu::new();
  let about_label = format!("About {app_name}");
  // Provide explicit metadata so the standard About panel shows the product
  // name — without it macOS derives the panel from the running process, which
  // is the bundled `node` binary, and the panel reads "node". Likewise, the
  // panel only shows an icon if `icon` is `Some` — otherwise it falls back to
  // the bundle icon, which the bundled `node` process isn't associated with.
  let about_metadata = AboutMetadata {
    name: Some(app_name.to_string()),
    icon: icon_path.and_then(load_icon_rgba),
    ..Default::default()
  };

  let app_menu = Submenu::new(app_name, true);
  app_menu
    .append_items(&[
      &PredefinedMenuItem::about(Some(&about_label), Some(about_metadata)),
      &PredefinedMenuItem::separator(),
      &PredefinedMenuItem::services(None),
      &PredefinedMenuItem::separator(),
      &PredefinedMenuItem::hide(None),
      &PredefinedMenuItem::hide_others(None),
      &PredefinedMenuItem::show_all(None),
      &PredefinedMenuItem::separator(),
      &PredefinedMenuItem::quit(None),
    ])
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

  let edit_menu = Submenu::new("Edit", true);
  edit_menu
    .append_items(&[
      &PredefinedMenuItem::undo(None),
      &PredefinedMenuItem::redo(None),
      &PredefinedMenuItem::separator(),
      &PredefinedMenuItem::cut(None),
      &PredefinedMenuItem::copy(None),
      &PredefinedMenuItem::paste(None),
      &PredefinedMenuItem::select_all(None),
    ])
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

  let window_menu = Submenu::new("Window", true);
  window_menu
    .append_items(&[
      &PredefinedMenuItem::minimize(None),
      &PredefinedMenuItem::maximize(None),
    ])
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

  menu
    .append_items(&[&app_menu, &edit_menu, &window_menu])
    .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

  Ok(menu)
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
