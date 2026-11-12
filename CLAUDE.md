# Germany by Numbers

See `CONTEXT.md` for the domain glossary and `README.md` for an overview.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues on `andreasadl-oss/germany-by-numbers` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## This repository is public

Everything here (code, docs, commit messages, issues, pull requests, workflow logs) can be read by anyone. Write it for a public audience:

- No outreach plans, private intentions or opinions about named people (who we plan to contact, show the site to, or ask for feedback).
- No personal details: email addresses, private names, contact information.
- No secrets: tokens, passwords, API keys, request headers. Destatis credentials live only in repository secrets (see `docs/DESTATIS_SETUP.md`).

Private planning stays in the maintainer's own notes, outside the repository.
