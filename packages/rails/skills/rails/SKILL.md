---
name: rails
description: "Use when working in a Ruby on Rails 7+ app (Gemfile with rails, app/ layout, Active Record, jobs); not for non-Rails Ruby or Sinatra."
metadata:
  version: "2.0.0"
---

# Rails conventions

Follow the existing app: check `Gemfile.lock` for Rails version, test framework (RSpec vs Minitest), job backend, and whether service objects/serializers are already in use.

Gotchas:
- Keep controllers thin; put logic in models or the repo's existing service/query-object layer.
- Schema changes: reversible migrations only; add indexes and foreign keys with the column; never edit a migration that has shipped. Use `strong_migrations` rules if installed.
- Strong parameters at the controller boundary; no `permit!`.
- Avoid N+1: `includes`/`preload`; verify with `bullet` if present.
- Background jobs must be idempotent and take IDs, not records.
- Validations in the model are not a substitute for DB constraints.
- Tests: use the repo's factory approach; request specs over controller specs.
- Run `bin/rails test` or `bundle exec rspec` and `rubocop` before finishing.
