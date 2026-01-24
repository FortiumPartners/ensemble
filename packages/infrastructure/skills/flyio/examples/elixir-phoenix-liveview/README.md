# Phoenix LiveView - Fly.io Deployment

Production-ready Phoenix LiveView application with real-time features.

## Features
- ✅ Phoenix 1.7 with LiveView
- ✅ WebSocket support
- ✅ Distributed Erlang clustering
- ✅ PubSub for real-time updates
- ✅ Release-based deployment

## Quick Start

```bash
# Create PostgreSQL
flyctl postgres create --name phoenix-db
flyctl postgres attach phoenix-db

# Set secrets
flyctl secrets set SECRET_KEY_BASE=$(mix phx.gen.secret)

# Deploy
./deploy.sh
```

## Clustering

Phoenix apps automatically cluster on Fly.io using libcluster.

## Resources
- [Phoenix Documentation](https://hexdocs.pm/phoenix/)
- [Fly.io Elixir Guide](https://fly.io/docs/languages-and-frameworks/elixir/)
