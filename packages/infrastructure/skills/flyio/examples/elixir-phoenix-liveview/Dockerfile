# Multi-stage build for Phoenix LiveView
FROM hexpm/elixir:1.16.0-erlang-26.2.1-alpine-3.18.4 AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache build-base git nodejs npm

# Install hex and rebar
RUN mix local.hex --force && \
    mix local.rebar --force

# Copy mix files
COPY mix.exs mix.lock ./
RUN mix deps.get --only prod
RUN mix deps.compile

# Copy assets
COPY assets assets
COPY priv priv

# Compile assets
RUN cd assets && npm install && npm run deploy
RUN mix phx.digest

# Copy application code
COPY lib lib
COPY config config

# Build release
RUN mix release

# Production stage
FROM alpine:3.18

RUN apk add --no-cache openssl ncurses-libs libstdc++

WORKDIR /app

# Copy release from builder
COPY --from=builder /app/_build/prod/rel/myapp ./

RUN addgroup -g 1001 -S phoenix && \
    adduser -S -u 1001 phoenix && \
    chown -R phoenix:phoenix /app

USER phoenix

EXPOSE 4000

CMD ["/app/bin/server"]
