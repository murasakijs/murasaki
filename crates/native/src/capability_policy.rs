//! Native enforcement for the versioned renderer capability policy.
//!
//! `capabilities` remains the compatibility permission-name projection used
//! by old applications and native menus. New builds additionally send this
//! JSON policy so commands which accept a target can be constrained to a
//! URL/path/window/host-permission allowlist. A missing policy is legacy and
//! therefore unscoped; a present policy is parsed strictly before the webview
//! is created, so malformed metadata can never silently widen privileges.

use serde::Deserialize;
use std::collections::{HashMap, HashSet};

const MAX_GRANTS: usize = 256;
const MAX_SCOPE_ENTRIES: usize = 256;
const MAX_SCOPE_STRING_BYTES: usize = 8 * 1024;

const KNOWN_CAPABILITIES: &[&str] = &[
    "app:quit",
    "dialog:openFile",
    "dialog:openDirectory",
    "dialog:saveFile",
    "dialog:message",
    "clipboard:readText",
    "clipboard:writeText",
    "clipboard:readImage",
    "clipboard:writeImage",
    "clipboard:writeHtml",
    "menu:application",
    "menu:context",
    "notification:show",
    "shell:openExternal",
    "shell:showItemInFolder",
    "shell:trashItem",
    "shell:openPath",
    "secureStorage:get",
    "secureStorage:set",
    "secureStorage:delete",
    "systemPermission:status",
    "systemPermission:request",
    "window:setTitle",
    "window:setSize",
    "window:minimize",
    "window:toggleMaximize",
    "window:show",
    "window:hide",
    "window:focus",
    "window:close",
    "window:setAlwaysOnTop",
    "window:isVisible",
    "window:isFocused",
    "window:isMaximized",
    "window:isMinimized",
    "window:getLabel",
    "window:open",
    "window:list",
    "window:manage",
    "globalShortcut:register",
    "globalShortcut:unregister",
    "tray:create",
    "tray:remove",
    "tray:setTooltip",
    "tray:setIcon",
    "tray:setMenu",
];

#[derive(Clone, Debug)]
pub(crate) struct CapabilityPolicy {
    mode: PolicyMode,
}

#[derive(Clone, Debug)]
enum PolicyMode {
    /// No `capabilityPolicy` field: keep pre-policy behavior. The legacy
    /// `capabilities` name list still controls whether a command is available.
    Legacy,
    V1(HashMap<String, Grant>),
}

#[derive(Clone, Debug)]
enum Grant {
    Unrestricted,
    Scoped {
        allow: Option<ScopeMatcher>,
        deny: Option<ScopeMatcher>,
    },
}

#[derive(Clone, Debug)]
enum ScopeMatcher {
    Urls(Vec<UrlPattern>),
    Paths(Vec<PathPattern>),
    Windows(HashSet<String>),
    Permissions(HashSet<String>),
}

#[derive(Clone, Debug)]
enum UrlPattern {
    Exact(url::Url),
    Subtree(url::Url),
}

#[derive(Clone, Debug)]
struct PathPattern {
    path: NormalizedPath,
    subtree: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct NormalizedPath {
    root: PathRoot,
    components: Vec<String>,
    case_insensitive: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum PathRoot {
    Posix,
    Drive(char),
    Unc(String, String),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PolicyWire {
    version: u32,
    grants: Vec<GrantWire>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum GrantWire {
    Name(String),
    Scoped(ScopedGrantWire),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ScopedGrantWire {
    permission: String,
    #[serde(default)]
    allow: Option<ScopeWire>,
    #[serde(default)]
    deny: Option<ScopeWire>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ScopeWire {
    #[serde(default)]
    urls: Option<Vec<String>>,
    #[serde(default)]
    paths: Option<Vec<String>>,
    #[serde(default)]
    windows: Option<Vec<String>>,
    #[serde(default)]
    permissions: Option<Vec<String>>,
}

pub(crate) enum CapabilityResource<'a> {
    Url(&'a url::Url),
    Path(&'a str),
    Window(&'a str),
    Permission(&'a str),
}

impl CapabilityPolicy {
    pub(crate) fn parse(raw: Option<&str>) -> Result<Self, String> {
        let Some(raw) = raw else {
            return Ok(Self {
                mode: PolicyMode::Legacy,
            });
        };
        if raw.len() > MAX_SCOPE_STRING_BYTES * MAX_SCOPE_ENTRIES {
            return Err("capabilityPolicy exceeds the maximum size".to_string());
        }
        let wire: PolicyWire = serde_json::from_str(raw)
            .map_err(|error| format!("invalid capabilityPolicy JSON: {error}"))?;
        if wire.version != 1 {
            return Err(format!(
                "unsupported capabilityPolicy version {}",
                wire.version
            ));
        }
        if wire.grants.len() > MAX_GRANTS {
            return Err(format!(
                "capabilityPolicy exceeds the maximum of {MAX_GRANTS} grants"
            ));
        }

        let mut grants = HashMap::with_capacity(wire.grants.len());
        for wire_grant in wire.grants {
            let (permission, grant) = match wire_grant {
                GrantWire::Name(permission) => {
                    validate_capability_name(&permission)?;
                    (permission, Grant::Unrestricted)
                }
                GrantWire::Scoped(scoped) => {
                    validate_capability_name(&scoped.permission)?;
                    if scoped.allow.is_none() && scoped.deny.is_none() {
                        return Err(format!(
                            "scoped capability {} must define allow or deny",
                            scoped.permission,
                        ));
                    }
                    let allow = scoped
                        .allow
                        .map(|scope| parse_scope(&scoped.permission, scope))
                        .transpose()?;
                    let deny = scoped
                        .deny
                        .map(|scope| parse_scope(&scoped.permission, scope))
                        .transpose()?;
                    (scoped.permission, Grant::Scoped { allow, deny })
                }
            };
            if grants.insert(permission.clone(), grant).is_some() {
                return Err(format!(
                    "capabilityPolicy contains duplicate grant {permission}"
                ));
            }
        }
        Ok(Self {
            mode: PolicyMode::V1(grants),
        })
    }

    /// A v1 policy is authoritative for grant membership. Intersecting it with
    /// the legacy names prevents inconsistent/tampered metadata from granting a
    /// command through only one of the two representations.
    pub(crate) fn grants_permission(&self, permission: &str) -> bool {
        match &self.mode {
            PolicyMode::Legacy => true,
            PolicyMode::V1(grants) => grants.contains_key(permission),
        }
    }

    pub(crate) fn allows(&self, permission: &str, resource: CapabilityResource<'_>) -> bool {
        // Absolute/non-traversing paths are mandatory even for a legacy string
        // grant. Otherwise an old unscoped grant could bypass the new baseline
        // safety property before the OS shell receives the target.
        if let CapabilityResource::Path(value) = resource {
            if NormalizedPath::parse(value).is_err() {
                return false;
            }
        }
        let PolicyMode::V1(grants) = &self.mode else {
            return true;
        };
        match grants.get(permission) {
            Some(Grant::Unrestricted) => true,
            Some(Grant::Scoped { allow, deny }) => {
                if deny.as_ref().is_some_and(|scope| scope.matches(&resource)) {
                    return false;
                }
                allow.as_ref().is_none_or(|scope| scope.matches(&resource))
            }
            None => false,
        }
    }
}

impl ScopeMatcher {
    fn matches(&self, resource: &CapabilityResource<'_>) -> bool {
        match (self, resource) {
            (Self::Urls(patterns), CapabilityResource::Url(value)) => {
                patterns.iter().any(|pattern| pattern.matches(value))
            }
            (Self::Paths(patterns), CapabilityResource::Path(value)) => {
                let Ok(value) = NormalizedPath::parse(value) else {
                    return false;
                };
                patterns.iter().any(|pattern| pattern.matches(&value))
            }
            (Self::Windows(values), CapabilityResource::Window(value))
            | (Self::Permissions(values), CapabilityResource::Permission(value)) => {
                values.contains(*value)
            }
            _ => false,
        }
    }
}

impl UrlPattern {
    fn parse(raw: &str) -> Result<Self, String> {
        validate_scope_string(raw, "URL pattern")?;
        let subtree = raw.ends_with("/**");
        let candidate = if subtree { &raw[..raw.len() - 2] } else { raw };
        if candidate.contains('*') {
            return Err("URL patterns support only a trailing /** wildcard".to_string());
        }
        // Remove only `**`, preserving the slash as a normal URL path boundary.
        let parsed = url::Url::parse(candidate)
            .map_err(|_| format!("invalid absolute URL pattern {raw:?}"))?;
        if !matches!(parsed.scheme(), "http" | "https" | "mailto" | "tel")
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err(
                "URL patterns support only credential-free http, https, mailto, and tel URLs"
                    .to_string(),
            );
        }
        if subtree {
            if !matches!(parsed.scheme(), "http" | "https") {
                return Err("URL wildcards are supported only for http and https URLs".to_string());
            }
            if parsed.query().is_some() || parsed.fragment().is_some() {
                return Err("URL subtree patterns cannot contain a query or fragment".to_string());
            }
            Ok(Self::Subtree(parsed))
        } else {
            Ok(Self::Exact(parsed))
        }
    }

    fn matches(&self, value: &url::Url) -> bool {
        if !value.username().is_empty() || value.password().is_some() {
            return false;
        }
        match self {
            Self::Exact(pattern) => pattern == value,
            Self::Subtree(pattern) => {
                if pattern.scheme() != value.scheme()
                    || pattern.host_str() != value.host_str()
                    || pattern.port_or_known_default() != value.port_or_known_default()
                {
                    return false;
                }
                let base = pattern.path().trim_end_matches('/');
                let path = value.path();
                base.is_empty()
                    || path == base
                    || path
                        .strip_prefix(base)
                        .is_some_and(|rest| rest.starts_with('/'))
            }
        }
    }
}

impl PathPattern {
    fn parse(raw: &str) -> Result<Self, String> {
        validate_scope_string(raw, "path pattern")?;
        let subtree = raw.ends_with("/**") || raw.ends_with("\\**");
        let candidate = if subtree { &raw[..raw.len() - 3] } else { raw };
        if candidate.contains('*') {
            return Err("path patterns support only a trailing /** wildcard".to_string());
        }
        Ok(Self {
            path: NormalizedPath::parse(candidate)?,
            subtree,
        })
    }

    fn matches(&self, value: &NormalizedPath) -> bool {
        if self.path.root != value.root || self.path.case_insensitive != value.case_insensitive {
            return false;
        }
        if self.subtree {
            value.components.starts_with(&self.path.components)
        } else {
            self.path.components == value.components
        }
    }
}

impl NormalizedPath {
    fn parse(raw: &str) -> Result<Self, String> {
        validate_scope_string(raw, "path")?;
        let normalized = raw.replace('\\', "/");
        let (root, raw_components, case_insensitive): (PathRoot, Vec<&str>, bool) =
            if raw.starts_with("\\\\") {
                let rest = normalized.trim_start_matches('/');
                let root_parts: Vec<_> = rest.split('/').filter(|part| !part.is_empty()).collect();
                let server = root_parts
                    .first()
                    .ok_or_else(|| "UNC path requires a server and share".to_string())?;
                let share = root_parts
                    .get(1)
                    .ok_or_else(|| "UNC path requires a server and share".to_string())?;
                (
                    PathRoot::Unc(server.to_ascii_lowercase(), share.to_ascii_lowercase()),
                    root_parts.into_iter().skip(2).collect(),
                    true,
                )
            } else if normalized.as_bytes().get(1) == Some(&b':')
                && normalized
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_alphabetic)
                && normalized.as_bytes().get(2) == Some(&b'/')
            {
                (
                    PathRoot::Drive(normalized.as_bytes()[0].to_ascii_lowercase() as char),
                    normalized[3..]
                        .split('/')
                        .filter(|part| !part.is_empty())
                        .collect(),
                    true,
                )
            } else if let Some(rest) = normalized.strip_prefix('/') {
                (
                    PathRoot::Posix,
                    rest.split('/').filter(|part| !part.is_empty()).collect(),
                    false,
                )
            } else {
                return Err(format!("path must be absolute: {raw:?}"));
            };

        let mut components = Vec::new();
        for component in raw_components {
            match component {
                "." => continue,
                ".." => return Err("path traversal segments are not allowed".to_string()),
                _ => components.push(if case_insensitive {
                    component.to_ascii_lowercase()
                } else {
                    component.to_string()
                }),
            }
        }
        Ok(Self {
            root,
            components,
            case_insensitive,
        })
    }
}

fn parse_scope(permission: &str, wire: ScopeWire) -> Result<ScopeMatcher, String> {
    let provided = [
        wire.urls.is_some(),
        wire.paths.is_some(),
        wire.windows.is_some(),
        wire.permissions.is_some(),
    ]
    .into_iter()
    .filter(|provided| *provided)
    .count();
    if provided != 1 {
        return Err(format!(
            "scope for {permission} must contain exactly one resource field"
        ));
    }
    match permission {
        "shell:openExternal" => {
            parse_entries(wire.urls, "urls", UrlPattern::parse).map(ScopeMatcher::Urls)
        }
        "shell:showItemInFolder" | "shell:trashItem" | "shell:openPath" => {
            parse_entries(wire.paths, "paths", PathPattern::parse).map(ScopeMatcher::Paths)
        }
        "window:open" | "window:manage" => parse_exact_entries(wire.windows, "windows", |value| {
            crate::window::validate_window_label(value)
        })
        .map(ScopeMatcher::Windows),
        "systemPermission:status" | "systemPermission:request" => {
            parse_exact_entries(wire.permissions, "permissions", |value| {
                if crate::system_permission::NAMES.contains(&value) {
                    Ok(())
                } else {
                    Err(format!("unknown system permission {value:?}"))
                }
            })
            .map(ScopeMatcher::Permissions)
        }
        _ => Err(format!(
            "capability {permission} does not support value scopes"
        )),
    }
}

fn parse_entries<T>(
    entries: Option<Vec<String>>,
    name: &str,
    parse: impl Fn(&str) -> Result<T, String>,
) -> Result<Vec<T>, String> {
    let entries = entries.ok_or_else(|| format!("scope for this capability requires {name}"))?;
    validate_entry_list(&entries, name)?;
    entries.iter().map(|value| parse(value)).collect()
}

fn parse_exact_entries(
    entries: Option<Vec<String>>,
    name: &str,
    validate: impl Fn(&str) -> Result<(), String>,
) -> Result<HashSet<String>, String> {
    let entries = entries.ok_or_else(|| format!("scope for this capability requires {name}"))?;
    validate_entry_list(&entries, name)?;
    for value in &entries {
        validate(value)?;
    }
    Ok(entries.into_iter().collect())
}

fn validate_entry_list(entries: &[String], name: &str) -> Result<(), String> {
    if entries.is_empty() || entries.len() > MAX_SCOPE_ENTRIES {
        return Err(format!("{name} must contain 1-{MAX_SCOPE_ENTRIES} entries"));
    }
    let mut seen = HashSet::with_capacity(entries.len());
    for entry in entries {
        validate_scope_string(entry, name)?;
        if !seen.insert(entry) {
            return Err(format!("{name} entries must be unique"));
        }
    }
    Ok(())
}

fn validate_scope_string(value: &str, name: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > MAX_SCOPE_STRING_BYTES || value.contains('\0') {
        return Err(format!(
            "{name} must be a non-empty string no longer than {MAX_SCOPE_STRING_BYTES} bytes"
        ));
    }
    Ok(())
}

fn validate_capability_name(permission: &str) -> Result<(), String> {
    if KNOWN_CAPABILITIES.contains(&permission) {
        Ok(())
    } else {
        Err(format!("unknown native capability {permission:?}"))
    }
}

#[cfg(test)]
mod tests {
    use super::{CapabilityPolicy, CapabilityResource};

    fn parse(grants: &str) -> CapabilityPolicy {
        CapabilityPolicy::parse(Some(grants)).unwrap()
    }

    #[test]
    fn exact_urls_and_subtrees_respect_origin_and_path_boundaries() {
        let policy = parse(
            r#"{"version":1,"grants":[
      {"permission":"shell:openExternal","allow":{"urls":[
        "https://example.com/exact?x=1",
        "https://docs.example.com/guide/**"
      ]}}
    ]}"#,
        );
        let allowed = |raw: &str| {
            let url = url::Url::parse(raw).unwrap();
            policy.allows("shell:openExternal", CapabilityResource::Url(&url))
        };
        assert!(allowed("https://example.com/exact?x=1"));
        assert!(!allowed("https://example.com/exact?x=2"));
        assert!(!allowed("https://example.com/exact?x=1#fragment"));
        assert!(allowed("https://docs.example.com/guide"));
        assert!(allowed("https://docs.example.com/guide/setup"));
        assert!(!allowed("https://docs.example.com/guides"));
        assert!(!allowed("https://docs.example.com.evil.test/guide/setup"));
        assert!(!allowed("http://docs.example.com/guide/setup"));
    }

    #[test]
    fn path_subtrees_require_absolute_non_traversing_boundary_matches() {
        let policy = parse(
            r#"{"version":1,"grants":[
      {"permission":"shell:showItemInFolder","allow":{"paths":[
        "/Users/example/Documents/**", "/Users/example/exact.txt",
        "C:\\\\Users\\\\example\\\\Downloads\\\\**"
      ]}}
    ]}"#,
        );
        let allowed =
            |path: &str| policy.allows("shell:showItemInFolder", CapabilityResource::Path(path));
        assert!(allowed("/Users/example/Documents"));
        assert!(allowed("/Users/example/Documents/report.pdf"));
        assert!(allowed("/Users/example/exact.txt"));
        assert!(!allowed("/Users/example/exact.txt.bak"));
        assert!(!allowed("/Users/example/Documents-old/report.pdf"));
        assert!(!allowed("/Users/example/Documents/../Secrets/key"));
        assert!(!allowed("Users/example/Documents/report.pdf"));
        assert!(allowed(r"c:\users\EXAMPLE\downloads\report.pdf"));
        assert!(!allowed(r"c:\users\example\downloads-old\report.pdf"));
    }

    #[test]
    fn trash_item_and_open_path_are_path_scoped_exactly_like_show_item_in_folder() {
        for permission in ["shell:trashItem", "shell:openPath"] {
            let policy = CapabilityPolicy::parse(Some(&format!(
                r#"{{"version":1,"grants":[{{"permission":"{permission}","allow":{{"paths":["/Users/example/Downloads/**"]}}}}]}}"#,
            )))
            .unwrap();
            assert!(policy.allows(
                permission,
                CapabilityResource::Path("/Users/example/Downloads/file.txt")
            ));
            assert!(!policy.allows(
                permission,
                CapabilityResource::Path("/Users/example/Documents/file.txt")
            ));
            assert!(!policy.allows(
                permission,
                CapabilityResource::Path("/Users/example/Downloads/../Secrets/key")
            ));
        }
    }

    #[test]
    fn window_labels_and_permission_names_are_exact() {
        let policy = parse(
            r#"{"version":1,"grants":[
      {"permission":"window:open","allow":{"windows":["settings"]}},
      {"permission":"window:manage","allow":{"windows":["preview"]}},
      {"permission":"systemPermission:request","allow":{"permissions":["camera"]}}
    ]}"#,
        );
        assert!(policy.allows("window:open", CapabilityResource::Window("settings")));
        assert!(!policy.allows("window:open", CapabilityResource::Window("settings2")));
        assert!(policy.allows("window:manage", CapabilityResource::Window("preview")));
        assert!(!policy.allows("window:manage", CapabilityResource::Window("settings")));
        assert!(policy.allows(
            "systemPermission:request",
            CapabilityResource::Permission("camera")
        ));
        assert!(!policy.allows(
            "systemPermission:request",
            CapabilityResource::Permission("microphone")
        ));
        assert!(!policy.allows(
            "systemPermission:status",
            CapabilityResource::Permission("camera")
        ));
    }

    #[test]
    fn deny_precedes_allow_and_deny_only_means_other_values_remain_allowed() {
        let policy = parse(
            r#"{"version":1,"grants":[
      {"permission":"shell:openExternal",
       "allow":{"urls":["https://example.com/**"]},
       "deny":{"urls":["https://example.com/admin/**"]}},
      {"permission":"window:manage","deny":{"windows":["main"]}}
    ]}"#,
        );
        let url = |raw: &str| url::Url::parse(raw).unwrap();
        assert!(policy.allows(
            "shell:openExternal",
            CapabilityResource::Url(&url("https://example.com/docs")),
        ));
        assert!(!policy.allows(
            "shell:openExternal",
            CapabilityResource::Url(&url("https://example.com/admin/users")),
        ));
        assert!(!policy.allows(
            "shell:openExternal",
            CapabilityResource::Url(&url("https://other.example/docs")),
        ));
        assert!(!policy.allows("window:manage", CapabilityResource::Window("main")));
        assert!(policy.allows("window:manage", CapabilityResource::Window("settings")));
    }

    #[test]
    fn legacy_string_grants_and_missing_policy_are_unrestricted() {
        let policy = parse(r#"{"version":1,"grants":["shell:openExternal","secureStorage:get"]}"#);
        let url = url::Url::parse("https://any.example/path").unwrap();
        assert!(policy.allows("shell:openExternal", CapabilityResource::Url(&url)));
        assert!(policy.grants_permission("shell:openExternal"));
        assert!(policy.grants_permission("secureStorage:get"));
        assert!(!policy.grants_permission("app:quit"));

        let legacy = CapabilityPolicy::parse(None).unwrap();
        assert!(legacy.grants_permission("app:quit"));
        assert!(legacy.allows("window:open", CapabilityResource::Window("anything")));
    }

    #[test]
    fn malformed_or_ambiguous_policies_fail_closed_during_parsing() {
        for raw in [
            "not-json",
            r#"{"version":2,"grants":[]}"#,
            r#"{"version":1,"grants":["unknown:permission"]}"#,
            r#"{"version":1,"grants":[{"permission":"window:open"}]}"#,
            r#"{"version":1,"grants":[{"permission":"window:open","allow":{"windows":[]}}]}"#,
            r#"{"version":1,"grants":[{"permission":"window:open","allow":{"windows":["../bad"]}}]}"#,
            r#"{"version":1,"grants":[{"permission":"window:open","allow":{"paths":["/tmp"]}}]}"#,
            r#"{"version":1,"grants":[{"permission":"shell:showItemInFolder","allow":{"paths":["../relative"]}}]}"#,
            r#"{"version":1,"grants":[{"permission":"shell:openExternal","allow":{"urls":["https://example.com/*"]}}]}"#,
            r#"{"version":1,"grants":[{"permission":"shell:openExternal","allow":{"urls":["https://example.com/foo*/**"]}}]}"#,
            r#"{"version":1,"grants":[{"permission":"shell:openExternal","allow":{"urls":["https://example.com/path?next=/**"]}}]}"#,
            r#"{"version":1,"grants":[{"permission":"shell:showItemInFolder","allow":{"paths":["/tmp/*/safe/**"]}}]}"#,
            r#"{"version":1,"grants":["app:quit","app:quit"]}"#,
            r#"{"version":1,"grants":[],"unexpected":true}"#,
        ] {
            assert!(CapabilityPolicy::parse(Some(raw)).is_err(), "{raw}");
        }
    }
}
