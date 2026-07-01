# Security Policy

We take the security of Murasaki seriously. Thank you for helping keep the
project and its users safe.

## Supported versions

Murasaki is in **pre-1.0 development**. We support the **latest published
minor version** on npm with security fixes. Older `0.x` versions are not
patched — please upgrade to the latest `0.x` before reporting issues.

| Version    | Supported          |
| ---------- | ------------------ |
| `latest`   | ✅ Yes              |
| Older 0.x  | ❌ No — please upgrade |

Once we reach 1.0, we will publish a longer support window and update
this document.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub
issues, discussions, or pull requests.** Public disclosure without a fix
puts users at risk.

You have two private channels:

### 1. GitHub Security Advisories (preferred)

Open a private advisory at:
**https://github.com/murasakijs/murasaki/security/advisories/new**

This is the fastest path — it puts your report directly in front of
maintainers with the right context and lets us coordinate a fix + CVE
without any information leaking.

### 2. Email

If GitHub advisories aren't practical for you, email:
**murasaki@ichi10.com**

Use a clear subject line like `[security] <short summary>`.

### What to include

Whatever information you have:

- A description of the issue and the impact.
- Steps to reproduce, ideally a minimal proof of concept.
- Which version(s) of murasaki are affected.
- Which platform(s) (macOS / Windows / Linux) you observed it on.
- Any suggested mitigations or fixes you've considered.

You do not need to have all of these — a partial report is better than
no report.

## What to expect

- **Acknowledgement within 72 hours.** We'll confirm receipt and open a
  private advisory (if you haven't already).
- **Assessment within 7 days.** We'll evaluate impact and reach out with
  clarifying questions.
- **Fix + coordinated disclosure.** Once a patch is ready, we'll publish
  the fixed version to npm, request a CVE (if warranted), and publish
  the advisory. If you want credit, we'll add you to the advisory.
- **Please don't publicly disclose the issue until the fix ships**, so
  users have a chance to upgrade.

## Scope

**In scope:**

- The `murasaki` npm package and the reference runtime it ships.
- The `create-murasaki` scaffolder.
- The default template shipped by `create-murasaki`.
- CLI subcommands (`dev`, `build`, `bundle`, `installer`) including the
  cross-compile download pipeline.

**Out of scope (report upstream instead):**

- Bugs in Node.js itself → https://github.com/nodejs/node/security
- Bugs in `@webviewjs/webview`, `wry`, `tao`, or platform WebViews.
- Bugs in third-party packages your own app depends on.
- Vulnerabilities in an app *built with* murasaki whose root cause is in
  the app's own code (though we're happy to help you triage).

If you're not sure where a report belongs, send it to us anyway — we'll
route it if needed.

## Preferred languages

We prefer reports in **English** or **Japanese**.

Thank you for helping keep Murasaki safe. 🦋
