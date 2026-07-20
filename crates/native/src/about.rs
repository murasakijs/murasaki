//! macOS configurable About panel.
//!
//! AppKit's standard About panel intentionally exposes only metadata. Once an
//! application asks for ordered buttons, detail rows, paragraph spacing, or an
//! explicit size, Murasaki crosses that narrow boundary with one retained
//! `NSWindow`. The rest of the application remains owned by tao/wry.

use std::cell::RefCell;

use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{AnyObject, NSObject},
    sel, DefinedClass, MainThreadOnly,
};
use objc2_app_kit::{
    NSApplication, NSBackingStoreType, NSButton, NSColor, NSFont, NSImageScaling, NSImageView,
    NSTextAlignment, NSTextField, NSView, NSWindow, NSWindowButton, NSWindowStyleMask,
    NSWindowTitleVisibility, NSWorkspace,
};
use objc2_foundation::{
    MainThreadMarker, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString, NSURL,
};

use crate::types::{AboutButtonOptions, AboutDetailOptions, AboutPanelOptions};

#[derive(Clone)]
pub(crate) struct AboutPresentation {
    pub name: String,
    pub version: Option<String>,
    pub fallback_description: Option<String>,
    pub options: AboutPanelOptions,
}

struct AboutPanelState {
    presentation: Option<AboutPresentation>,
    window: Option<Retained<NSWindow>>,
    link_targets: Vec<Retained<AboutLinkTarget>>,
}

thread_local! {
    static ABOUT_PANEL: RefCell<AboutPanelState> = const { RefCell::new(AboutPanelState {
        presentation: None,
        window: None,
        link_targets: Vec::new(),
    }) };
}

pub(crate) fn configure(presentation: Option<AboutPresentation>) {
    ABOUT_PANEL.with(|slot| {
        let mut state = slot.borrow_mut();
        if let Some(window) = state.window.take() {
            window.close();
        }
        state.link_targets.clear();
        state.presentation = presentation;
    });
}

pub(crate) fn show() {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    ABOUT_PANEL.with(|slot| {
        let mut state = slot.borrow_mut();
        if let Some(window) = state.window.as_ref() {
            window.makeKeyAndOrderFront(None);
            NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
            return;
        }
        let Some(presentation) = state.presentation.clone() else {
            return;
        };
        let (window, targets) = build_panel(&presentation, mtm);
        window.center();
        window.makeKeyAndOrderFront(None);
        NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
        state.link_targets = targets;
        state.window = Some(window);
    });
}

struct AboutLinkTargetIvars {
    url: Retained<NSURL>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = AboutLinkTargetIvars]
    struct AboutLinkTarget;

    impl AboutLinkTarget {
        #[unsafe(method(open:))]
        fn open(&self, _sender: &AnyObject) {
            let _ = NSWorkspace::sharedWorkspace().openURL(&self.ivars().url);
        }
    }

    unsafe impl NSObjectProtocol for AboutLinkTarget {}
);

impl AboutLinkTarget {
    fn new(url: Retained<NSURL>, mtm: MainThreadMarker) -> Retained<Self> {
        let target = mtm.alloc::<Self>().set_ivars(AboutLinkTargetIvars { url });
        unsafe { msg_send![super(target), init] }
    }
}

fn build_panel(
    presentation: &AboutPresentation,
    mtm: MainThreadMarker,
) -> (Retained<NSWindow>, Vec<Retained<AboutLinkTarget>>) {
    let options = &presentation.options;
    let paragraphs = options
        .paragraphs
        .clone()
        .unwrap_or_else(|| presentation.fallback_description.iter().cloned().collect());
    let details = options.details.clone().unwrap_or_default();
    let buttons = options.buttons.clone().unwrap_or_default();
    let includes_version = details
        .iter()
        .any(|row| row.label.eq_ignore_ascii_case("version"));
    let detail_row_count =
        details.len() + usize::from(presentation.version.is_some() && !includes_version);
    let width = f64::from(options.width.unwrap_or(480).clamp(360, 900));
    let paragraph_spacing = f64::from(options.paragraph_spacing.unwrap_or(12).clamp(0, 48));
    let calculated_height = 330.0
        + paragraphs.len() as f64 * (48.0 + paragraph_spacing)
        + detail_row_count as f64 * 28.0
        + if buttons.is_empty() { 0.0 } else { 68.0 };
    let height = f64::from(
        options
            .height
            .unwrap_or(calculated_height as i32)
            .clamp(320, 1_000),
    );
    let bounds = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(width, height));
    let window = unsafe {
        NSWindow::initWithContentRect_styleMask_backing_defer(
            mtm.alloc::<NSWindow>(),
            bounds,
            NSWindowStyleMask::Titled
                | NSWindowStyleMask::Closable
                | NSWindowStyleMask::Miniaturizable
                | NSWindowStyleMask::Resizable,
            NSBackingStoreType::Buffered,
            false,
        )
    };
    unsafe { window.setReleasedWhenClosed(false) };
    if let Some(button) = window.standardWindowButton(NSWindowButton::MiniaturizeButton) {
        button.setEnabled(false);
    }
    if let Some(button) = window.standardWindowButton(NSWindowButton::ZoomButton) {
        button.setEnabled(false);
    }
    window.setTitle(&NSString::from_str(&format!("About {}", presentation.name)));
    window.setTitleVisibility(NSWindowTitleVisibility::Hidden);
    window.setContentSize(NSSize::new(width, height));
    window.setContentMinSize(NSSize::new(width, height));
    window.setContentMaxSize(NSSize::new(width, height));

    let content = NSView::initWithFrame(mtm.alloc::<NSView>(), bounds);
    window.setContentView(Some(&content));

    let horizontal_padding = 36.0;
    let content_width = width - horizontal_padding * 2.0;
    let mut top = 32.0;

    let app = NSApplication::sharedApplication(mtm);
    if let Some(image) = app.applicationIconImage() {
        let icon_size = 136.0;
        let image_view = NSImageView::imageViewWithImage(&image, mtm);
        image_view.setImageScaling(NSImageScaling::ScaleProportionallyUpOrDown);
        image_view.setFrame(frame_from_top(
            height,
            (width - icon_size) / 2.0,
            top,
            icon_size,
            icon_size,
        ));
        content.addSubview(&image_view);
        top += icon_size + 24.0;
    }

    let display_name = options.name.as_deref().unwrap_or(&presentation.name);
    let name = centered_label(display_name, 34.0, true, mtm);
    name.setFrame(frame_from_top(
        height,
        horizontal_padding,
        top,
        content_width,
        44.0,
    ));
    content.addSubview(&name);
    top += 52.0;

    for paragraph in &paragraphs {
        let label = centered_wrapping_label(paragraph, 15.0, mtm);
        label.setFrame(frame_from_top(
            height,
            horizontal_padding,
            top,
            content_width,
            48.0,
        ));
        content.addSubview(&label);
        top += 48.0 + paragraph_spacing;
    }

    if paragraphs.is_empty() {
        top += 8.0;
    }

    let mut link_targets = Vec::new();
    let mut rows = details;
    if let Some(version) = presentation.version.as_ref() {
        let has_version = rows
            .iter()
            .any(|row| row.label.eq_ignore_ascii_case("version"));
        if !has_version {
            rows.insert(
                0,
                AboutDetailOptions {
                    label: "Version".to_string(),
                    value: version.clone(),
                    href: None,
                },
            );
        }
    }
    if !rows.is_empty() {
        top += 10.0;
    }
    for row in &rows {
        add_detail_row(
            &content,
            row,
            height,
            horizontal_padding,
            top,
            content_width,
            mtm,
            &mut link_targets,
        );
        top += 28.0;
    }

    if !buttons.is_empty() {
        add_buttons(&content, &buttons, width, 34.0, mtm, &mut link_targets);
    }

    (window, link_targets)
}

fn centered_label(
    value: &str,
    font_size: f64,
    bold: bool,
    mtm: MainThreadMarker,
) -> Retained<NSTextField> {
    let label = NSTextField::labelWithString(&NSString::from_str(value), mtm);
    label.setAlignment(NSTextAlignment::Center);
    let font = if bold {
        NSFont::boldSystemFontOfSize(font_size)
    } else {
        NSFont::systemFontOfSize(font_size)
    };
    label.setFont(Some(&font));
    label
}

fn centered_wrapping_label(
    value: &str,
    font_size: f64,
    mtm: MainThreadMarker,
) -> Retained<NSTextField> {
    let label = NSTextField::wrappingLabelWithString(&NSString::from_str(value), mtm);
    label.setAlignment(NSTextAlignment::Center);
    label.setMaximumNumberOfLines(3);
    label.setFont(Some(&NSFont::systemFontOfSize(font_size)));
    label
}

#[allow(clippy::too_many_arguments)]
fn add_detail_row(
    content: &NSView,
    row: &AboutDetailOptions,
    height: f64,
    x: f64,
    top: f64,
    width: f64,
    mtm: MainThreadMarker,
    targets: &mut Vec<Retained<AboutLinkTarget>>,
) {
    let label_width = width * 0.46;
    let label = NSTextField::labelWithString(&NSString::from_str(&row.label), mtm);
    label.setAlignment(NSTextAlignment::Right);
    label.setFont(Some(&NSFont::systemFontOfSize(14.0)));
    label.setFrame(frame_from_top(height, x, top, label_width, 24.0));
    content.addSubview(&label);

    let value_x = x + label_width + 12.0;
    if let Some(href) = row.href.as_deref() {
        if let Some((button, target)) = link_button(&row.value, href, mtm) {
            button.setBordered(false);
            button.setContentTintColor(Some(&NSColor::linkColor()));
            button.setAlignment(NSTextAlignment::Left);
            button.setFrame(frame_from_top(
                height,
                value_x,
                top - 2.0,
                width - label_width - 12.0,
                28.0,
            ));
            content.addSubview(&button);
            targets.push(target);
            return;
        }
    }
    let value = NSTextField::labelWithString(&NSString::from_str(&row.value), mtm);
    value.setAlignment(NSTextAlignment::Left);
    value.setFont(Some(&NSFont::monospacedSystemFontOfSize_weight(14.0, 0.0)));
    value.setFrame(frame_from_top(
        height,
        value_x,
        top,
        width - label_width - 12.0,
        24.0,
    ));
    content.addSubview(&value);
}

fn add_buttons(
    content: &NSView,
    buttons: &[AboutButtonOptions],
    width: f64,
    bottom: f64,
    mtm: MainThreadMarker,
    targets: &mut Vec<Retained<AboutLinkTarget>>,
) {
    let gap = 10.0;
    let widths: Vec<f64> = buttons
        .iter()
        .map(|button| (button.label.chars().count() as f64 * 8.5 + 34.0).clamp(86.0, 180.0))
        .collect();
    let total_width = widths.iter().sum::<f64>() + gap * (buttons.len().saturating_sub(1) as f64);
    let mut x = ((width - total_width) / 2.0).max(16.0);
    for (button, button_width) in buttons.iter().zip(widths) {
        if let Some((view, target)) = link_button(&button.label, &button.href, mtm) {
            view.setFrame(NSRect::new(
                NSPoint::new(x, bottom),
                NSSize::new(button_width, 34.0),
            ));
            content.addSubview(&view);
            targets.push(target);
            x += button_width + gap;
        }
    }
}

fn link_button(
    label: &str,
    href: &str,
    mtm: MainThreadMarker,
) -> Option<(Retained<NSButton>, Retained<AboutLinkTarget>)> {
    let parsed = url::Url::parse(href).ok()?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return None;
    }
    let url = NSURL::URLWithString(&NSString::from_str(parsed.as_str()))?;
    let target = AboutLinkTarget::new(url, mtm);
    let button = unsafe {
        NSButton::buttonWithTitle_target_action(
            &NSString::from_str(label),
            Some(&target),
            Some(sel!(open:)),
            mtm,
        )
    };
    Some((button, target))
}

fn frame_from_top(content_height: f64, x: f64, top: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(
        NSPoint::new(x, content_height - top - height),
        NSSize::new(width, height),
    )
}
