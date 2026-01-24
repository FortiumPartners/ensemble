# Multi-stage build for Rails API
FROM ruby:3.3-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache build-base postgresql-dev

# Copy Gemfile
COPY Gemfile Gemfile.lock ./
RUN bundle config set --local deployment 'true' && \
    bundle config set --local without 'development test' && \
    bundle install

# Production stage
FROM ruby:3.3-alpine

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache postgresql-client tzdata

# Copy gems from builder
COPY --from=builder /usr/local/bundle /usr/local/bundle

# Copy application code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S rails && \
    adduser -S -u 1001 rails && \
    chown -R rails:rails /app

USER rails

EXPOSE 3000

CMD ["bin/rails", "server", "-b", "0.0.0.0"]
