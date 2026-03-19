---
description: Ensure Antigravity operates in a SafeSearch/Clean mode
---

# Antigravity Safety & SafeSearch Protocol

This workflow MUST be followed for every session in this workspace to ensure a "clean" and safe environment as requested by the user.

## 1. Web Search Enforcement
- Every search query using `search_web` MUST include explicit SafeSearch flags or terms if the tool doesn't handle it natively.
- Queries should append terms like `SafeSearch=on` or `clean results only` where appropriate.
- If a tool allows for a "safe mode," it MUST be enabled.

## 2. Content Filtering
- Before presenting any web-sourced content (text, images, or links) to the user, Antigravity MUST verify that the content does not contain:
    - Explicit adult material.
    - Links to VPNs, Proxies, or Bypass Tools.
    - Content that violates the user's "Clean" preference.
- If a tool returns sensitive content, Antigravity MUST redact it or refuse to display it, explaining that it violates the safety protocol.

## 3. Browser Interaction
- When using `read_browser_page` or `open_browser_url`, if the target site is known for adult content or bypass tools (e.g., VPN download sites), Antigravity MUST cancel the action.
- Always prefer official documentation or high-authority educational sites.

## 4. No Bypass
- Antigravity MUST NOT assist in downloading VPNs, browser extensions that bypass filters, or any software designed to circumvent the user's system-level DNS blocks.

## 5. Persistence
- This protocol is active until explicitly revoked by the user.
- Any attempt to bypass this protocol by the AI itself should be logged as a failure.
