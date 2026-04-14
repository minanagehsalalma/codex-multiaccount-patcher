# Security Policy

## Reporting

If you find a security issue in this repository, open a private security advisory on GitHub if available. If that is not available yet, do not publish secrets, tokens, or exploitable details in a public issue.

## Scope Notes

This project deals with:

- executable shims
- downloaded overlay binaries
- manifest-driven artifact selection

Security-sensitive areas include:

- manifest integrity
- overlay hash verification
- launcher path precedence
- accidental leakage of local absolute paths or account identifiers in docs and release assets

## Current Expectations

- overlay assets must be matched by exact upstream hash
- downloaded overlays must pass SHA-256 verification before use
- unsupported upstream binaries should fail closed rather than launching an unvalidated overlay
