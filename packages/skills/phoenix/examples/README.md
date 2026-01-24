# Phoenix Framework Examples

**Purpose**: Real-world, production-ready code examples demonstrating Phoenix and Elixir patterns.

**Coverage**: Complete implementations of common Phoenix use cases with best practices.

---

## Available Examples

| Example | Purpose | Lines | Key Patterns |
|---------|---------|-------|--------------|
| `blog-post-crud.example.ex` | Complete CRUD with associations | 535 | Context, N+1 prevention, filtering, PubSub |
| `real-time-chat.example.ex` | Real-time chat application | 536 | LiveView, Channels, Presence, real-time updates |
| `background-jobs.example.ex` | Background job processing | 595 | Oban workers, scheduling, retry strategies, cron |

**Total**: 3 comprehensive examples, 1,666 lines of production-ready code

---

## Example 1: Blog Post CRUD

**File**: `blog-post-crud.example.ex`

### What It Demonstrates

- **Phoenix Contexts**: Business logic encapsulation
- **Ecto Schemas**: Associations (belongs_to, has_many, many_to_many)
- **N+1 Prevention**: Preload and join strategies
- **Advanced Queries**: Filtering, pagination, search, subqueries
- **RESTful Controllers**: Complete CRUD operations
- **Authorization**: User-based permissions
- **PubSub Broadcasting**: Real-time updates
- **JSON Views**: API response formatting

### Key Features

#### Schema with Associations
```elixir
schema "posts" do
  field :title, :string
  field :slug, :string
  field :published, :boolean

  belongs_to :author, MyApp.Accounts.User
  has_many :comments, MyApp.Blog.Comment
  many_to_many :tags, MyApp.Blog.Tag, join_through: "posts_tags"

  timestamps()
end
```

#### N+1 Prevention
```elixir
# Bad: N+1 query
def list_posts_bad do
  posts = Repo.all(Post)
  # Each access to post.author triggers a query
end

# Good: Preload associations
def list_posts do
  Post
  |> preload([:author, :tags])
  |> Repo.all()
end
```

#### Advanced Filtering
```elixir
def filter_posts(filters \\ %{}) do
  Post
  |> filter_by_author(filters)
  |> filter_by_published(filters)
  |> filter_by_tags(filters)
  |> filter_by_date_range(filters)
  |> order_posts(filters)
  |> paginate_posts(filters)
  |> Repo.all()
end
```

#### Subquery for Aggregation
```elixir
# Get posts with comment count (no N+1)
comment_count_subquery =
  from c in Comment,
    group_by: c.post_id,
    select: %{post_id: c.post_id, count: count(c.id)}

from(p in Post,
  left_join: cc in subquery(comment_count_subquery),
  on: cc.post_id == p.id,
  select: %{post: p, comment_count: coalesce(cc.count, 0)}
)
```

#### PubSub Broadcasting
```elixir
defp broadcast_post_created({:ok, post} = result) do
  Phoenix.PubSub.broadcast(MyApp.PubSub, "posts", {:post_created, post})
  result
end
```

### Use Cases

- Blog platforms
- Content management systems
- News websites
- Documentation sites
- Any CRUD application with relationships

---

## Example 2: Real-Time Chat

**File**: `real-time-chat.example.ex`

### What It Demonstrates

- **Phoenix LiveView**: Real-time server-rendered UI
- **Phoenix Channels**: WebSocket communication
- **Phoenix Presence**: User tracking and status
- **Streams**: Performance optimization for large lists
- **PubSub**: Real-time message broadcasting
- **Typing Indicators**: Live user activity tracking
- **User Authorization**: Room access control

### Key Features

#### LiveView with Real-Time Updates
```elixir
def mount(%{"id" => room_id}, session, socket) do
  if connected?(socket) do
    # Subscribe to room updates
    Phoenix.PubSub.subscribe(MyApp.PubSub, "room:#{room_id}")

    # Track user presence
    {:ok, _} = Presence.track_user(room_id, user.id, user.name)

    {:ok, initialize_socket(socket, room_id, user)}
  else
    {:ok, initialize_socket(socket, room_id, user)}
  end
end
```

#### Presence Tracking
```elixir
defmodule MyAppWeb.Presence do
  use Phoenix.Presence,
    otp_app: :my_app,
    pubsub_server: MyApp.PubSub

  def track_user(room_id, user_id, user_name) do
    track(
      self(),
      "room:#{room_id}",
      user_id,
      %{
        online_at: System.system_time(:second),
        name: user_name,
        typing: false
      }
    )
  end

  def list_users(room_id) do
    list("room:#{room_id}")
    |> Enum.map(fn {user_id, %{metas: [meta | _]}} ->
      %{id: user_id, name: meta.name, typing: meta.typing}
    end)
  end
end
```

#### Typing Indicators
```elixir
def handle_event("typing", _params, socket) do
  Presence.update_typing_status(socket.assigns.room.id, user_id, true)
  Process.send_after(self(), :typing_timeout, 3000)
  {:noreply, socket}
end

def handle_info(:typing_timeout, socket) do
  Presence.update_typing_status(socket.assigns.room.id, user_id, false)
  {:noreply, socket}
end
```

#### Streams for Performance
```elixir
# Use streams instead of assigns for large message lists
socket
|> stream(:messages, messages, dom_id: &"message-#{&1.id}")

# Insert new message at end
{:noreply, stream_insert(socket, :messages, message, at: -1)}
```

#### Channel Alternative (WebSocket)
```elixir
defmodule MyAppWeb.RoomChannel do
  use MyAppWeb, :channel

  def join("room:" <> room_id, _params, socket) do
    if authorized?(socket, room_id) do
      send(self(), :after_join)
      {:ok, assign(socket, :room_id, room_id)}
    else
      {:error, %{reason: "unauthorized"}}
    end
  end

  def handle_in("new_msg", %{"body" => body}, socket) do
    message = create_message(body, socket)
    broadcast!(socket, "new_msg", message)
    {:reply, {:ok, %{id: message.id}}, socket}
  end
end
```

### Use Cases

- Chat applications
- Collaboration tools
- Live customer support
- Gaming lobbies
- Real-time dashboards
- Multiplayer applications

---

## Example 3: Background Jobs with Oban

**File**: `background-jobs.example.ex`

### What It Demonstrates

- **Oban Workers**: Reliable background job processing
- **Retry Strategies**: Exponential backoff with jitter
- **Job Scheduling**: Immediate, delayed, and scheduled
- **Cron Jobs**: Periodic task execution
- **Unique Jobs**: Prevent duplicate processing
- **Batch Processing**: Chunking large datasets
- **Error Handling**: Snooze, cancel, and retry patterns
- **Telemetry**: Job monitoring and logging

### Key Features

#### Email Worker with Retry
```elixir
defmodule MyApp.Workers.EmailWorker do
  use Oban.Worker,
    queue: :emails,
    max_attempts: 3,
    priority: 1,
    unique: [period: 60, fields: [:args]]

  def perform(%Oban.Job{args: %{"type" => "welcome", "user_id" => user_id}}) do
    user = Accounts.get_user!(user_id)
    Mailer.send_welcome_email(user)
    :ok
  end
end
```

#### API Worker with Exponential Backoff
```elixir
def perform(%Oban.Job{args: args, attempt: attempt}) do
  case ExternalAPI.sync_user(user_id) do
    {:ok, _data} ->
      :ok

    {:error, :rate_limited} ->
      # Exponential backoff with jitter
      backoff = :math.pow(2, attempt) + :rand.uniform(1000)
      {:snooze, backoff}

    {:error, :not_found} ->
      # Permanent error - don't retry
      {:cancel, "user not found"}
  end
end
```

#### Batch Processing
```elixir
def perform(%Oban.Job{args: %{"batch_id" => batch_id}}) do
  items = Batches.get_batch_items(batch_id)

  # Process in chunks to avoid memory issues
  items
  |> Enum.chunk_every(100)
  |> Enum.each(fn chunk ->
    chunk
    |> Task.async_stream(&process_item/1,
      max_concurrency: 10,
      timeout: 30_000
    )
    |> Enum.to_list()
  end)

  :ok
end
```

#### Cron Jobs Configuration
```elixir
# config/config.exs
config :my_app, Oban,
  repo: MyApp.Repo,
  queues: [default: 10, emails: 20, reports: 5],
  plugins: [
    {Oban.Plugins.Cron,
     crontab: [
       {"0 2 * * *", MyApp.Workers.DailyReportWorker},     # Daily at 2 AM
       {"*/15 * * * *", MyApp.Workers.CacheWarmerWorker},  # Every 15 min
       {"0 0 * * 0", MyApp.Workers.WeeklyDigestWorker},    # Sunday midnight
       {"0 3 1 * *", MyApp.Workers.MonthlyInvoiceWorker}   # 1st of month 3 AM
     ]}
  ]
```

#### Job Scheduling Patterns
```elixir
# Immediate job
%{user_id: user.id}
|> EmailWorker.new()
|> Oban.insert()

# Delayed job (1 hour)
%{user_id: user.id}
|> EmailWorker.new(schedule_in: 3600)
|> Oban.insert()

# Scheduled at specific time
%{user_id: user.id}
|> EmailWorker.new(scheduled_at: ~U[2025-12-25 09:00:00Z])
|> Oban.insert()

# Unique job (prevent duplicates within 24 hours)
%{user_id: user.id}
|> EmailWorker.new(
  unique: [period: 86400, fields: [:user_id]]
)
|> Oban.insert()

# High priority job
%{user_id: user.id}
|> EmailWorker.new(priority: 0)
|> Oban.insert()
```

#### Telemetry Monitoring
```elixir
defmodule MyApp.ObanTelemetry do
  def handle_event([:oban, :job, :start], _measurements, %{job: job}, _config) do
    Logger.info("Starting job: #{job.worker} (attempt #{job.attempt})")
  end

  def handle_event([:oban, :job, :stop], %{duration: duration}, %{job: job}, _config) do
    duration_ms = System.convert_time_unit(duration, :native, :millisecond)
    Logger.info("Completed job: #{job.worker} in #{duration_ms}ms")
  end

  def handle_event([:oban, :job, :exception], _measurements, %{job: job, reason: reason}, _config) do
    Logger.error("Job failed: #{job.worker} - #{inspect(reason)}")
  end
end
```

### Use Cases

- Email delivery
- Image/video processing
- Data imports/exports
- API integrations
- Report generation
- Scheduled notifications
- Data cleanup tasks
- Webhook deliveries
- Analytics processing

---

## Pattern Coverage

### Phoenix Patterns

- ✅ Phoenix Contexts for business logic
- ✅ RESTful Controllers with CRUD
- ✅ Phoenix LiveView with real-time updates
- ✅ Phoenix Channels for WebSocket communication
- ✅ Phoenix Presence for user tracking
- ✅ JSON Views for API responses
- ✅ Authorization and access control

### Ecto Patterns

- ✅ Schemas with associations (belongs_to, has_many, many_to_many)
- ✅ Changesets with validations
- ✅ N+1 query prevention (preload, join)
- ✅ Advanced queries (filters, pagination, search)
- ✅ Subqueries for aggregation
- ✅ Migrations with indexes

### OTP Patterns

- ✅ Oban workers for background jobs
- ✅ PubSub for real-time broadcasting
- ✅ Presence for distributed user tracking
- ✅ Task.async_stream for parallel processing

### Production Patterns

- ✅ Error handling and retry strategies
- ✅ Exponential backoff with jitter
- ✅ Rate limiting awareness
- ✅ Batch processing for large datasets
- ✅ Cron jobs for periodic tasks
- ✅ Telemetry for monitoring
- ✅ Authorization checks
- ✅ Input validation

---

## Testing Examples

Each example includes test patterns (see `templates/test.template.exs`):

### Context Tests
```elixir
test "create_post/1 with valid data creates a post" do
  attrs = %{title: "Title", body: "Body", author_id: author.id}
  assert {:ok, %Post{} = post} = Blog.create_post(attrs)
  assert post.title == "Title"
end
```

### Controller Tests
```elixir
test "creates post when data is valid", %{conn: conn} do
  conn = post(conn, ~p"/api/posts", post: @create_attrs)
  assert %{"id" => id} = json_response(conn, 201)["data"]
end
```

### LiveView Tests
```elixir
test "saves new post", %{conn: conn} do
  {:ok, index_live, _html} = live(conn, ~p"/posts")

  assert index_live
         |> form("#post-form", post: @create_attrs)
         |> render_submit()

  assert_patch(index_live, ~p"/posts")
end
```

---

## Running the Examples

### Prerequisites

```bash
# Install dependencies
mix deps.get

# Create database
mix ecto.create

# Run migrations (from examples)
mix ecto.migrate
```

### Using Examples

1. **Copy relevant code** from examples to your project
2. **Adapt placeholders** to your application names
3. **Add required schemas** and migrations
4. **Configure Oban** (for background jobs example)
5. **Set up PubSub** (for real-time examples)
6. **Write tests** using provided patterns

### Configuration

#### Oban Setup
```elixir
# mix.exs
def deps do
  [
    {:oban, "~> 2.13"}
  ]
end

# config/config.exs
config :my_app, Oban,
  repo: MyApp.Repo,
  queues: [default: 10, emails: 20]
```

#### PubSub Setup
```elixir
# Already included in Phoenix 1.7+
# lib/my_app/application.ex
children = [
  {Phoenix.PubSub, name: MyApp.PubSub}
]
```

---

## Related Files

- **SKILL.md**: Quick reference for Phoenix patterns
- **REFERENCE.md**: Comprehensive Phoenix guide
- **templates/**: Code generation templates
- **PATTERNS-EXTRACTED.md**: Pattern extraction from original agent

---

**Status**: ✅ **COMPLETE** - 3 comprehensive real-world examples with 1,666 lines of production-ready code

**Coverage**: Blog CRUD, Real-time Chat, Background Jobs - All major Phoenix use cases demonstrated
