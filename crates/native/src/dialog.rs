//! Native file dialogs via rfd.

use napi::bindgen_prelude::Result;
use napi_derive::napi;
use rfd::FileDialog;

use crate::types::{OpenFileOptions, SaveFileOptions};

#[napi(js_name = "openFileDialog")]
pub fn open_file_dialog(opts: Option<OpenFileOptions>) -> Result<Vec<String>> {
  let opts = opts.unwrap_or(OpenFileOptions {
    title: None,
    default_path: None,
    filters: None,
    multiple: None,
  });

  let mut dialog = FileDialog::new();
  if let Some(t) = opts.title {
    dialog = dialog.set_title(t);
  }
  if let Some(p) = opts.default_path {
    dialog = dialog.set_directory(p);
  }
  if let Some(fs) = opts.filters {
    for f in fs {
      let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
      dialog = dialog.add_filter(&f.name, &exts);
    }
  }

  let picks = if opts.multiple.unwrap_or(false) {
    dialog
      .pick_files()
      .unwrap_or_default()
      .into_iter()
      .map(|p| p.display().to_string())
      .collect()
  } else {
    dialog
      .pick_file()
      .into_iter()
      .map(|p| p.display().to_string())
      .collect()
  };

  Ok(picks)
}

#[napi(js_name = "openDirectoryDialog")]
pub fn open_directory_dialog(opts: Option<OpenFileOptions>) -> Result<Option<String>> {
  let opts = opts.unwrap_or(OpenFileOptions {
    title: None,
    default_path: None,
    filters: None,
    multiple: None,
  });

  let mut dialog = FileDialog::new();
  if let Some(t) = opts.title {
    dialog = dialog.set_title(t);
  }
  if let Some(p) = opts.default_path {
    dialog = dialog.set_directory(p);
  }

  Ok(dialog.pick_folder().map(|p| p.display().to_string()))
}

#[napi(js_name = "saveFileDialog")]
pub fn save_file_dialog(opts: Option<SaveFileOptions>) -> Result<Option<String>> {
  let opts = opts.unwrap_or(SaveFileOptions {
    title: None,
    default_path: None,
    default_name: None,
    filters: None,
  });

  let mut dialog = FileDialog::new();
  if let Some(t) = opts.title {
    dialog = dialog.set_title(t);
  }
  if let Some(p) = opts.default_path {
    dialog = dialog.set_directory(p);
  }
  if let Some(n) = opts.default_name {
    dialog = dialog.set_file_name(n);
  }
  if let Some(fs) = opts.filters {
    for f in fs {
      let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
      dialog = dialog.add_filter(&f.name, &exts);
    }
  }

  Ok(dialog.save_file().map(|p| p.display().to_string()))
}
