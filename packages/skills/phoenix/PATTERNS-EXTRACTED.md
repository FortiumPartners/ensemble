# Phoenix Framework Patterns - Extracted from elixir-phoenix-expert.yaml

**Source Agent**: `agents/yaml/elixir-phoenix-expert.yaml` (16KB, 363 lines)
**Extraction Date**: 2025-10-22
**Target**: Skills-based framework architecture (TRD-032)

---

## Agent Overview

**Category**: Framework Specialist
**Version**: 1.0.1
**Mission**: Comprehensive Elixir and Phoenix development expertise for robust, scalable, fault-tolerant applications

### Core Strengths

- Phoenix web framework (≥1.7) - Controllers, contexts, views, routing
- Phoenix LiveView (≥0.18) - Real-time server-rendered UI with PubSub
- Elixir language (≥1.14) - Functional programming, pattern matching, protocols
- OTP patterns - GenServer, Supervisor, Agent, fault tolerance
- Ecto database toolkit (≥3.9) - Schemas, migrations, queries, changesets
- Phoenix Channels - Real-time bidirectional communication via WebSockets
- Oban (≥2.13) - Background job processing with reliability

---

## 1. Core Expertise Areas (7 areas)

### 1.1 Phoenix API Development (Priority: HIGH)

**Capabilities**:
- RESTful controllers with standard actions (index, show, create, update, delete)
- Phoenix contexts for business logic encapsulation
- Ecto schemas with validations and associations
- Resource-based routing with plug pipelines for auth/authz
- Security best practices (SQL injection prevention, XSS protection, CSRF tokens)
- Authentication (Guardian/Pow/phx.gen.auth)

**Implementation Patterns**:
```elixir
# RESTful Controller with CRUD
defmodule MyAppWeb.PostController do
  use MyAppWeb, :controller
  alias MyApp.Blog

  def index(conn, _params), do: render(conn, "index.json", posts: Blog.list_posts())
  def show(conn, %{"id" => id}), do: render(conn, "show.json", post: Blog.get_post!(id))
  def create(conn, %{"post" => post_params}), do: # ...
  def update(conn, %{"id" => id, "post" => post_params}), do: # ...
  def delete(conn, %{"id" => id}), do: # ...
end
```

---

### 1.2 OTP Patterns & Fault Tolerance (Priority: HIGH)

**Capabilities**:
- GenServer implementation (init, handle_call, handle_cast, handle_info)
- Supervisor trees with restart strategies (one_for_one, one_for_all, rest_for_one)
- Process patterns (Task, Agent, Registry)
- "Let it crash" philosophy for fault tolerance
- Proper timeout handling and supervision tree design

**Implementation Patterns**:
```elixir
# GenServer Pattern
defmodule MyApp.Cache do
  use GenServer

  def init(state), do: {:ok, state}
  def handle_call({:get, key}, _from, state), do: {:reply, Map.get(state, key), state}
  def handle_cast({:put, key, value}, state), do: {:noreply, Map.put(state, key, value)}
  def handle_info(:cleanup, state), do: {:noreply, %{}}
end

# Supervisor Tree
defmodule MyApp.Application do
  use Application

  def start(_type, _args) do
    children = [
      {MyApp.Cache, []},
      {Task.Supervisor, name: MyApp.TaskSupervisor}
    ]

    Supervisor.start_link(children, strategy: :one_for_one)
  end
end
```

---

### 1.3 Phoenix LiveView Development (Priority: HIGH)

**Capabilities**:
- Real-time server-rendered UI with lifecycle (mount, render, handle_event, handle_info)
- State management with socket assigns
- Real-time updates via Phoenix.PubSub
- Performance optimization (streams, temporary_assigns, <16ms render time)
- Accessibility compliance (WCAG 2.1 AA with semantic HTML and ARIA)

**Implementation Patterns**:
```elixir
# LiveView Component with Real-Time Updates
defmodule MyAppWeb.DashboardLive do
  use MyAppWeb, :live_view

  def mount(_params, _session, socket) do
    if connected?(socket) do
      Phoenix.PubSub.subscribe(MyApp.PubSub, "metrics:updates")
    end
    {:ok, assign(socket, :metrics, get_metrics())}
  end

  def handle_event("refresh", _params, socket) do
    {:noreply, assign(socket, :metrics, get_metrics())}
  end

  def handle_info({:metric_update, new_metrics}, socket) do
    {:noreply, assign(socket, :metrics, new_metrics)}
  end
end
```

---

### 1.4 Ecto Database Operations (Priority: HIGH)

**Capabilities**:
- Query optimization (N+1 prevention, preload vs join, subqueries, indexes)
- Changeset validations (validate_required, validate_format, custom validators)
- Migrations (idempotent, reversible, concurrent indexes)
- Database performance (composite indexes, prepared statements, connection pooling)

**Implementation Patterns**:
```elixir
# N+1 Prevention with Preload
def list_users_with_posts do
  User
  |> preload(:posts)
  |> Repo.all()
end

# Changeset Validation
def changeset(user, attrs) do
  user
  |> cast(attrs, [:email, :name])
  |> validate_required([:email, :name])
  |> validate_format(:email, ~r/@/)
  |> unique_constraint(:email)
end
```

---

### 1.5 Phoenix Channels & Real-Time Communication (Priority: MEDIUM)

**Capabilities**:
- Channel implementation with join authorization
- Phoenix.PubSub for cross-process communication
- Phoenix.Presence for user tracking
- Rate limiting
- Secure WebSocket connections with Phoenix.Token authentication

**Implementation Patterns**:
```elixir
# Phoenix Channel
defmodule MyAppWeb.RoomChannel do
  use MyAppWeb, :channel

  def join("room:" <> room_id, _params, socket) do
    if authorized?(socket, room_id) do
      {:ok, socket}
    else
      {:error, %{reason: "unauthorized"}}
    end
  end

  def handle_in("new_msg", %{"body" => body}, socket) do
    broadcast!(socket, "new_msg", %{body: body})
    {:noreply, socket}
  end
end
```

---

### 1.6 Background Job Processing with Oban (Priority: MEDIUM)

**Capabilities**:
- Oban worker implementation with perform callback
- Queue configuration with concurrency limits
- Retry strategies with exponential backoff
- Job scheduling (schedule_in, cron jobs)
- Unique jobs
- Monitoring via Oban Web UI and telemetry events

**Implementation Patterns**:
```elixir
# Oban Worker
defmodule MyApp.Workers.EmailWorker do
  use Oban.Worker, queue: :emails, max_attempts: 3

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"user_id" => user_id}}) do
    user = MyApp.Accounts.get_user!(user_id)
    MyApp.Mailer.send_welcome_email(user)
    :ok
  end
end

# Schedule Job
%{user_id: user.id}
|> MyApp.Workers.EmailWorker.new(schedule_in: 60)
|> Oban.insert()
```

---

### 1.7 Production Deployment & Optimization (Priority: MEDIUM)

**Capabilities**:
- Elixir releases with runtime configuration
- VM optimization (scheduler config, memory allocation, GC tuning)
- Health checks for load balancers
- Phoenix Telemetry instrumentation
- Distributed systems with Libcluster
- Deployment strategies (blue-green, canary, rolling)

**Implementation Patterns**:
```elixir
# Runtime Configuration (runtime.exs)
import Config

config :my_app, MyApp.Repo,
  url: System.get_env("DATABASE_URL"),
  pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10")

# Health Check Endpoint
defmodule MyAppWeb.HealthController do
  use MyAppWeb, :controller

  def check(conn, _params) do
    if MyApp.Repo.query("SELECT 1") do
      send_resp(conn, 200, "ok")
    else
      send_resp(conn, 503, "unhealthy")
    end
  end
end
```

---

## 2. Quality Standards

### 2.1 Documentation Standards

- **Module Documentation**: `@moduledoc` for all public modules with examples
- **Function Documentation**: `@doc` for all public functions with `@spec` type specifications
- **Inline Comments**: Comments for complex logic (pattern matching, OTP, LiveView state)

### 2.2 Testing Coverage Targets

| Component | Minimum Coverage | Description |
|-----------|-----------------|-------------|
| Contexts | ≥80% | Phoenix contexts (business logic) |
| Controllers | ≥70% | Phoenix controllers with integration tests |
| LiveView | ≥60% | LiveView components with LiveViewTest helpers |
| Overall | ≥70% | Overall project test coverage |

### 2.3 Security Standards

- **SQL Injection Prevention**: 100% Ecto parameterization - no string interpolation
- **Input Validation**: All inputs validated via Ecto changesets
- **Authentication**: Guardian, Pow, or phx.gen.auth with password hashing

### 2.4 Performance Targets

| Metric | Target | Description |
|--------|--------|-------------|
| API Response Time | P95 <200ms | 95th percentile API response time |
| LiveView Render Time | <16ms | For 60 FPS rendering |
| Database Query Time | P95 <100ms | 95th percentile query time |

---

## 3. Code Examples from Agent

### Example 1: Ecto N+1 Query Prevention

**Anti-Pattern** (N+1 query problem):
```elixir
# Bad: N+1 query - separate query for each user's posts
def list_users_with_posts do
  users = Repo.all(User)
  # This triggers N separate queries when accessing posts
  Enum.map(users, fn user ->
    %{user: user, post_count: length(user.posts)}
  end)
end
```

**Best Practice** (Single query with preload):
```elixir
# Good: Preload association - single query with JOIN
def list_users_with_posts do
  users =
    User
    |> preload(:posts)
    |> Repo.all()

  Enum.map(users, fn user ->
    %{user: user, post_count: length(user.posts)}
  end)
end

# Alternative: Use join with select for aggregation
def list_users_with_post_count do
  from u in User,
    left_join: p in assoc(u, :posts),
    group_by: u.id,
    select: %{user: u, post_count: count(p.id)}
  |> Repo.all()
end
```

**Benefits**:
- Single query instead of N+1
- 100x+ performance improvement for large datasets
- Predictable database load

---

### Example 2: Phoenix LiveView Real-Time Updates with PubSub

**Anti-Pattern** (Polling-based updates):
```elixir
# Bad: Polling every 5 seconds
def mount(_params, _session, socket) do
  if connected?(socket) do
    Process.send_after(self(), :refresh, 5000)
  end
  {:ok, assign(socket, :metrics, get_metrics())}
end

def handle_info(:refresh, socket) do
  Process.send_after(self(), :refresh, 5000)
  {:noreply, assign(socket, :metrics, get_metrics())}
end
```

**Best Practice** (PubSub real-time updates):
```elixir
# Good: PubSub subscription for real-time updates
def mount(_params, _session, socket) do
  if connected?(socket) do
    Phoenix.PubSub.subscribe(MyApp.PubSub, "metrics:updates")
  end
  {:ok, assign(socket, :metrics, get_metrics())}
end

def handle_info({:metric_update, new_metrics}, socket) do
  {:noreply, assign(socket, :metrics, new_metrics)}
end

# In your context/service, broadcast when data changes:
def update_metrics(new_data) do
  metrics = save_metrics(new_data)
  Phoenix.PubSub.broadcast(
    MyApp.PubSub,
    "metrics:updates",
    {:metric_update, metrics}
  )
  {:ok, metrics}
end
```

**Benefits**:
- Instant updates via PubSub broadcast
- No polling overhead - push-based architecture
- Scales efficiently to thousands of connections
- Database queries only when data actually changes

---

## 4. Delegation & Integration Protocols

### 4.1 When to Use This Agent

**Detection Signals**:
- `mix.exs` file detected in project root
- Phoenix dependency in `mix.exs` (`{:phoenix, ~> 1.7}`)
- Task explicitly mentions Elixir, Phoenix, Ecto, OTP, LiveView, Channels
- User specifies Elixir/Phoenix as target framework
- Real-time features requiring WebSocket or PubSub
- Fault-tolerant systems requiring OTP patterns
- Background job processing with Oban

### 4.2 When to Delegate

**To postgresql-specialist**:
- Complex query optimization beyond standard Ecto patterns
- Database performance tuning (indexes, partitioning, materialized views)

**To infrastructure-specialist**:
- Production deployment automation to AWS/GCP/Azure
- Container orchestration with Kubernetes
- Load balancer and CDN configuration

**To code-reviewer**:
- Security review of authentication/authorization implementation
- Code quality review after implementation

**To test-runner**:
- Executing comprehensive test suites with coverage analysis

**To playwright-tester**:
- E2E testing of Phoenix LiveView components
- Accessibility validation (WCAG 2.1 AA)

### 4.3 Handoff Protocols

**Receives Handoffs From**:
- `ensemble-orchestrator`: Task delegation with TRD reference
- `tech-lead-orchestrator`: TRD implementation tasks with quality gates
- `backend-developer`: General backend tasks requiring Elixir/Phoenix expertise

**Hands Off To**:
- `code-reviewer`: Implementation files for security/quality review
- `test-runner`: Test execution with ExUnit coverage requirements (≥80%)
- `playwright-tester`: LiveView E2E test with accessibility validation
- `postgresql-specialist`: Complex query optimization with Ecto context

**Collaborates With**:
- `infrastructure-specialist`: Production deployment with Elixir configuration
- `postgresql-specialist`: Database optimization and query performance
- `nestjs-backend-expert`: Pattern sharing for multi-framework projects

---

## 5. Tool Permissions

**Required Tools**:
- `Read` - Read project files and dependencies
- `Write` - Create new Phoenix files (controllers, contexts, LiveViews)
- `Edit` - Modify existing Phoenix code
- `Grep` - Search for patterns in codebase
- `Glob` - Find files matching patterns
- `Bash` - Execute mix commands (mix test, mix format, mix deps.get)
- `Task` - Delegate to specialized agents

---

## 6. Boundaries (Does NOT Handle)

**Out of Scope**:
- ❌ Nerves (embedded systems) → requires specialized embedded expertise
- ❌ Broadway (data processing pipelines) → requires stream processing specialist
- ❌ Custom Erlang protocols → requires low-level Erlang expertise
- ❌ Complex distributed consensus (Raft, Paxos) → escalate to distributed systems architect
- ❌ Low-level BEAM VM optimization beyond standard flags → escalate to human expert
- ❌ Complex query optimization → delegate to postgresql-specialist

---

## 7. Pattern Extraction Summary

### Core Patterns Identified (7 categories):

1. ✅ **Phoenix API Development** - RESTful controllers, contexts, schemas, security
2. ✅ **OTP Patterns & Fault Tolerance** - GenServer, Supervisors, "let it crash"
3. ✅ **Phoenix LiveView Development** - Real-time UI, PubSub, performance
4. ✅ **Ecto Database Operations** - N+1 prevention, changesets, migrations
5. ✅ **Phoenix Channels** - Real-time communication, WebSockets, Presence
6. ✅ **Background Jobs (Oban)** - Workers, scheduling, retry strategies
7. ✅ **Production Deployment** - Releases, VM optimization, monitoring

### Quality Standards Identified:

- ✅ **Testing Coverage**: Contexts ≥80%, Controllers ≥70%, LiveView ≥60%, Overall ≥70%
- ✅ **Security**: 100% Ecto parameterization, input validation, authentication
- ✅ **Performance**: API <200ms (P95), LiveView <16ms, Queries <100ms (P95)
- ✅ **Documentation**: @moduledoc, @doc, @spec, inline comments

### Code Examples Identified:

- ✅ **2 Anti-Pattern vs Best Practice Examples** with benefits
- ✅ **N+1 Query Prevention** - Performance-critical pattern
- ✅ **LiveView Real-Time Updates** - Architecture-critical pattern

---

## Next Steps (TRD-032)

1. ✅ **Pattern Extraction Complete** - All 7 core expertise areas documented
2. ⏳ **Create SKILL.md** - Quick reference guide (~20KB, <100KB target)
3. ⏳ **Create REFERENCE.md** - Comprehensive guide (~50KB, <500KB target)

**Target Feature Parity**: ≥95% coverage of all patterns, examples, and quality standards from the original agent.

---

**Extraction Status**: ✅ **COMPLETE**

**Total Patterns**: 7 core expertise areas + 4 quality standard categories + 2 code examples

**Ready for**: SKILL.md and REFERENCE.md creation
