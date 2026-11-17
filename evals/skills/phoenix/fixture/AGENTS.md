# Tasker

Phoenix 1.7 app with Ecto (Postgres) and LiveView.

- The toolchain is pinned in `devbox.json`. Run every mix command through it: `devbox run mix ...`. A global Elixir is not supported here.
- Contexts live in `lib/tasker/`, the web layer in `lib/tasker_web/`.
- Dependencies are managed by the maintainers; do not add any.
