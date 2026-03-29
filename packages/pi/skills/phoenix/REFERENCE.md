# Phoenix Framework - Comprehensive Reference Guide

**Version**: 1.0.0 | **Last Updated**: 2025-10-22 | **Framework**: Phoenix 1.7+ / Elixir 1.14+

Comprehensive guide for building production-ready applications with Phoenix and Elixir. For quick reference, see SKILL.md.

---

## Table of Contents

1. [Phoenix Architecture](#1-phoenix-architecture)
2. [Phoenix API Development](#2-phoenix-api-development)
3. [OTP Patterns & Fault Tolerance](#3-otp-patterns--fault-tolerance)
4. [Phoenix LiveView](#4-phoenix-liveview)
5. [Ecto Database Operations](#5-ecto-database-operations)
6. [Phoenix Channels & Real-Time](#6-phoenix-channels--real-time)
7. [Background Jobs with Oban](#7-background-jobs-with-oban)
8. [Authentication & Authorization](#8-authentication--authorization)
9. [Testing Strategies](#9-testing-strategies)
10. [Performance Optimization](#10-performance-optimization)
11. [Production Deployment](#11-production-deployment)
12. [Security Best Practices](#12-security-best-practices)

---

## 1. Phoenix Architecture

### 1.1 Request Lifecycle

```
HTTP Request
  ↓
Endpoint (Plug Pipeline)
  ↓
Router (Route Matching)
  ↓
Pipeline (Auth, CORS, etc.)
  ↓
Controller Action
  ↓
Context Function (Business Logic)
  ↓
Ecto Repo (Database)
  ↓
View/JSON Rendering
  ↓
HTTP Response
```

### 1.2 Directory Structure

```
my_app/
├── lib/
│   ├── my_app/                    # Business logic
│   │   ├── accounts/              # Domain: User accounts
│   │   │   ├── user.ex            # Ecto schema
│   │   │   └── user_token.ex
│   │   ├── accounts.ex            # Context: Public API
│   │   ├── blog/                  # Domain: Blog
│   │   │   ├── post.ex
│   │   │   └── comment.ex
│   │   ├── blog.ex                # Context: Public API
│   │   ├── application.ex         # OTP Application
│   │   ├── mailer.ex              # Email delivery
│   │   └── repo.ex                # Ecto repository
│   ├── my_app_web/                # Web interface
│   │   ├── controllers/
│   │   ├── live/                  # LiveView components
│   │   ├── components/            # Reusable components
│   │   ├── channels/              # WebSocket channels
│   │   ├── endpoint.ex            # HTTP endpoint
│   │   ├── router.ex              # Route definitions
│   │   ├── telemetry.ex           # Metrics
│   │   └── gettext.ex             # I18n
│   └── my_app.ex                  # App module
├── test/
│   ├── my_app/                    # Context tests
│   ├── my_app_web/                # Controller/LiveView tests
│   └── support/                   # Test helpers
├── priv/
│   ├── repo/migrations/           # Database migrations
│   ├── static/                    # Static assets
│   └── gettext/                   # Translations
├── config/
│   ├── config.exs                 # Compile-time config
│   ├── dev.exs, test.exs, prod.exs
│   └── runtime.exs                # Runtime config
├── assets/                        # Frontend assets
│   ├── js/
│   ├── css/
│   └── package.json
└── mix.exs                        # Project definition
```

### 1.3 Phoenix Contexts

**Context Pattern**: Business logic boundary that groups related functionality.

```elixir
# lib/my_app/blog.ex
defmodule MyApp.Blog do
  @moduledoc """
  The Blog context - manages posts, comments, and publishing.
  """

  import Ecto.Query, warn: false
  alias MyApp.Repo
  alias MyApp.Blog.{Post, Comment}

  ## Posts

  def list_posts do
    from(p in Post, order_by: [desc: p.inserted_at])
    |> Repo.all()
  end

  def list_published_posts do
    from(p in Post, where: p.published == true, order_by: [desc: p.published_at])
    |> Repo.all()
  end

  def get_post!(id), do: Repo.get!(Post, id)

  def create_post(attrs \\\\ %{}) do
    %Post{}
    |> Post.changeset(attrs)
    |> Repo.insert()
  end

  def update_post(%Post{} = post, attrs) do
    post
    |> Post.changeset(attrs)
    |> Repo.update()
  end

  def publish_post(%Post{} = post) do
    post
    |> Ecto.Changeset.change(published: true, published_at: DateTime.utc_now())
    |> Repo.update()
  end

  def delete_post(%Post{} = post) do
    Repo.delete(post)
  end

  ## Comments

  def list_post_comments(post_id) do
    from(c in Comment, where: c.post_id == ^post_id, order_by: c.inserted_at)
    |> Repo.all()
  end

  def create_comment(post, attrs \\\\ %{}) do
    %Comment{}
    |> Comment.changeset(attrs)
    |> Ecto.Changeset.put_assoc(:post, post)
    |> Repo.insert()
  end
end
```

**Benefits**:
- Clear boundaries between domains
- Testable business logic
- Reusable across controllers, LiveViews, CLI, etc.
- Encapsulation of complexity

---

## 2. Phoenix API Development

### 2.1 RESTful API Design

#### Controller with CRUD Operations

```elixir
defmodule MyAppWeb.API.PostController do
  use MyAppWeb, :controller

  alias MyApp.Blog
  alias MyApp.Blog.Post

  action_fallback MyAppWeb.FallbackController

  # GET /api/posts
  def index(conn, params) do
    page = String.to_integer(params["page"] || "1")
    per_page = String.to_integer(params["per_page"] || "20")

    posts = Blog.list_posts_paginated(page, per_page)
    render(conn, "index.json", posts: posts)
  end

  # GET /api/posts/:id
  def show(conn, %{"id" => id}) do
    post = Blog.get_post!(id)
    render(conn, "show.json", post: post)
  end

  # POST /api/posts
  def create(conn, %{"post" => post_params}) do
    with {:ok, %Post{} = post} <- Blog.create_post(post_params) do
      conn
      |> put_status(:created)
      |> put_resp_header("location", ~p"/api/posts/#{post}")
      |> render("show.json", post: post)
    end
  end

  # PUT/PATCH /api/posts/:id
  def update(conn, %{"id" => id, "post" => post_params}) do
    post = Blog.get_post!(id)

    with {:ok, %Post{} = post} <- Blog.update_post(post, post_params) do
      render(conn, "show.json", post: post)
    end
  end

  # DELETE /api/posts/:id
  def delete(conn, %{"id" => id}) do
    post = Blog.get_post!(id)

    with {:ok, %Post{}} <- Blog.delete_post(post) do
      send_resp(conn, :no_content, "")
    end
  end
end
```

#### Fallback Controller for Error Handling

```elixir
defmodule MyAppWeb.FallbackController do
  use MyAppWeb, :controller

  def call(conn, {:error, %Ecto.Changeset{} = changeset}) do
    conn
    |> put_status(:unprocessable_entity)
    |> put_view(json: MyAppWeb.ChangesetJSON)
    |> render(:error, changeset: changeset)
  end

  def call(conn, {:error, :not_found}) do
    conn
    |> put_status(:not_found)
    |> put_view(json: MyAppWeb.ErrorJSON)
    |> render(:"404")
  end

  def call(conn, {:error, :unauthorized}) do
    conn
    |> put_status(:forbidden)
    |> put_view(json: MyAppWeb.ErrorJSON)
    |> render(:"403")
  end
end
```

#### JSON Views

```elixir
defmodule MyAppWeb.PostJSON do
  alias MyApp.Blog.Post

  def index(%{posts: posts}) do
    %{data: for(post <- posts, do: data(post))}
  end

  def show(%{post: post}) do
    %{data: data(post)}
  end

  defp data(%Post{} = post) do
    %{
      id: post.id,
      title: post.title,
      body: post.body,
      published: post.published,
      author: %{
        id: post.author.id,
        name: post.author.name
      },
      inserted_at: post.inserted_at,
      updated_at: post.updated_at
    }
  end
end

defmodule MyAppWeb.ChangesetJSON do
  def error(%{changeset: changeset}) do
    %{errors: translate_errors(changeset)}
  end

  defp translate_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
```

### 2.2 API Routing

```elixir
# lib/my_app_web/router.ex
defmodule MyAppWeb.Router do
  use MyAppWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
    plug :fetch_session
  end

  pipeline :api_auth do
    plug MyAppWeb.Auth.Pipeline
    plug MyAppWeb.Auth.LoadUser
  end

  scope "/api", MyAppWeb.API do
    pipe_through :api

    # Public routes
    post "/users/register", UserController, :create
    post "/users/login", SessionController, :create
    get "/posts", PostController, :index
    get "/posts/:id", PostController, :show
  end

  scope "/api", MyAppWeb.API do
    pipe_through [:api, :api_auth]

    # Authenticated routes
    resources "/posts", PostController, except: [:index, :show]
    resources "/comments", CommentController, only: [:create, :update, :delete]

    # Nested resources
    resources "/posts", PostController, only: [] do
      resources "/comments", CommentController, only: [:index]
    end
  end
end
```

### 2.3 API Versioning

```elixir
# Option 1: URL versioning
scope "/api/v1", MyAppWeb.API.V1 do
  pipe_through :api
  resources "/posts", PostController
end

scope "/api/v2", MyAppWeb.API.V2 do
  pipe_through :api
  resources "/posts", PostController
end

# Option 2: Header versioning
pipeline :api_v1 do
  plug :accepts, ["json"]
  plug :put_version, "v1"
end

pipeline :api_v2 do
  plug :accepts, ["json"]
  plug :put_version, "v2"
end

defp put_version(conn, version) do
  assign(conn, :api_version, version)
end
```

### 2.4 Rate Limiting

```elixir
# Using Hammer
defmodule MyAppWeb.RateLimiter do
  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    user_id = conn.assigns[:current_user_id] || get_ip(conn)
    key = "rate_limit:#{user_id}"

    case Hammer.check_rate(key, 60_000, 100) do
      {:allow, _count} ->
        conn

      {:deny, _limit} ->
        conn
        |> put_status(:too_many_requests)
        |> Phoenix.Controller.json(%{error: "Rate limit exceeded"})
        |> halt()
    end
  end

  defp get_ip(conn) do
    conn.remote_ip
    |> :inet_parse.ntoa()
    |> to_string()
  end
end

# In router
pipeline :api do
  plug :accepts, ["json"]
  plug MyAppWeb.RateLimiter
end
```

---

## 3. OTP Patterns & Fault Tolerance

### 3.1 GenServer Implementation

#### Basic GenServer

```elixir
defmodule MyApp.Cache do
  use GenServer
  require Logger

  # Client API

  def start_link(opts \\\\ []) do
    GenServer.start_link(__MODULE__, %{}, opts)
  end

  def get(server \\\\ __MODULE__, key) do
    GenServer.call(server, {:get, key})
  end

  def put(server \\\\ __MODULE__, key, value) do
    GenServer.cast(server, {:put, key, value})
  end

  def delete(server \\\\ __MODULE__, key) do
    GenServer.cast(server, {:delete, key})
  end

  def clear(server \\\\ __MODULE__) do
    GenServer.cast(server, :clear)
  end

  # Server Callbacks

  @impl true
  def init(_args) do
    Logger.info("Cache GenServer started")
    schedule_cleanup()
    {:ok, %{}}
  end

  @impl true
  def handle_call({:get, key}, _from, state) do
    {:reply, Map.get(state, key), state}
  end

  @impl true
  def handle_cast({:put, key, value}, state) do
    {:noreply, Map.put(state, key, value)}
  end

  @impl true
  def handle_cast({:delete, key}, state) do
    {:noreply, Map.delete(state, key)}
  end

  @impl true
  def handle_cast(:clear, _state) do
    {:noreply, %{}}
  end

  @impl true
  def handle_info(:cleanup, state) do
    Logger.debug("Running cache cleanup")
    # Implement cleanup logic (e.g., remove expired entries)
    schedule_cleanup()
    {:noreply, state}
  end

  @impl true
  def terminate(reason, _state) do
    Logger.info("Cache GenServer terminating: #{inspect(reason)}")
    :ok
  end

  # Private Functions

  defp schedule_cleanup do
    Process.send_after(self(), :cleanup, :timer.minutes(5))
  end
end
```

#### GenServer with ETS Cache

```elixir
defmodule MyApp.FastCache do
  use GenServer

  # Client API

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  def get(key) do
    case :ets.lookup(:fast_cache, key) do
      [{^key, value, _expires_at}] ->
        if expires_valid?(key) do
          {:ok, value}
        else
          :error
        end

      [] ->
        :error
    end
  end

  def put(key, value, ttl \\\\ 3600) do
    GenServer.cast(__MODULE__, {:put, key, value, ttl})
  end

  # Server Callbacks

  @impl true
  def init(_opts) do
    :ets.new(:fast_cache, [:named_table, :public, read_concurrency: true])
    schedule_cleanup()
    {:ok, %{}}
  end

  @impl true
  def handle_cast({:put, key, value, ttl}, state) do
    expires_at = System.system_time(:second) + ttl
    :ets.insert(:fast_cache, {key, value, expires_at})
    {:noreply, state}
  end

  @impl true
  def handle_info(:cleanup, state) do
    now = System.system_time(:second)
    :ets.select_delete(:fast_cache, [{{:_, :_, :"$1"}, [{:<, :"$1", now}], [true]}])
    schedule_cleanup()
    {:noreply, state}
  end

  # Private Functions

  defp schedule_cleanup do
    Process.send_after(self(), :cleanup, :timer.minutes(1))
  end

  defp expires_valid?(key) do
    case :ets.lookup(:fast_cache, key) do
      [{^key, _value, expires_at}] ->
        System.system_time(:second) < expires_at

      [] ->
        false
    end
  end
end
```

### 3.2 Supervisor Trees

#### Application Supervision Tree

```elixir
defmodule MyApp.Application do
  use Application

  @impl true
  def start(_type, _args) do
    children = [
      # Database
      MyApp.Repo,

      # PubSub
      {Phoenix.PubSub, name: MyApp.PubSub},

      # Endpoint
      MyAppWeb.Endpoint,

      # Telemetry
      MyApp.Telemetry,

      # Custom GenServers
      {MyApp.Cache, name: MyApp.Cache},
      {MyApp.FastCache, []},

      # Task Supervisor
      {Task.Supervisor, name: MyApp.TaskSupervisor},

      # Oban
      {Oban, Application.fetch_env!(:my_app, Oban)},

      # Custom Supervisors
      MyApp.WorkerSupervisor
    ]

    opts = [strategy: :one_for_one, name: MyApp.Supervisor]
    Supervisor.start_link(children, opts)
  end

  @impl true
  def config_change(changed, _new, removed) do
    MyAppWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
```

#### Custom Supervisor with Dynamic Children

```elixir
defmodule MyApp.WorkerSupervisor do
  use Supervisor

  def start_link(init_arg) do
    Supervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  @impl true
  def init(_init_arg) do
    children = [
      {DynamicSupervisor, name: MyApp.DynamicWorkerSupervisor, strategy: :one_for_one}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end

  def start_worker(worker_id, args) do
    spec = {MyApp.Worker, {worker_id, args}}
    DynamicSupervisor.start_child(MyApp.DynamicWorkerSupervisor, spec)
  end

  def stop_worker(pid) do
    DynamicSupervisor.terminate_child(MyApp.DynamicWorkerSupervisor, pid)
  end
end
```

### 3.3 Task and Agent Patterns

#### Async Task Execution

```elixir
# Fire and forget
Task.start(fn ->
  MyApp.Mailer.send_notification(user)
end)

# Supervised task
Task.Supervisor.start_child(MyApp.TaskSupervisor, fn ->
  process_large_file(file_path)
end)

# Task with await
task = Task.async(fn ->
  fetch_external_api()
end)

result = Task.await(task, 5000) # 5 second timeout

# Multiple parallel tasks
tasks = [
  Task.async(fn -> fetch_user_data(user_id) end),
  Task.async(fn -> fetch_user_posts(user_id) end),
  Task.async(fn -> fetch_user_stats(user_id) end)
]

[user_data, posts, stats] = Task.await_many(tasks, 10_000)
```

#### Agent for Simple State

```elixir
# Start agent
{:ok, agent} = Agent.start_link(fn -> %{} end, name: :my_agent)

# Get state
Agent.get(:my_agent, fn state -> Map.get(state, :key) end)

# Update state
Agent.update(:my_agent, fn state -> Map.put(state, :key, "value") end)

# Get and update
Agent.get_and_update(:my_agent, fn state ->
  {Map.get(state, :counter, 0), Map.update(state, :counter, 1, &(&1 + 1))}
end)
```

### 3.4 Process Registry

```elixir
defmodule MyApp.SessionRegistry do
  def start_link do
    Registry.start_link(keys: :unique, name: __MODULE__)
  end

  def register(session_id) do
    Registry.register(__MODULE__, session_id, nil)
  end

  def lookup(session_id) do
    case Registry.lookup(__MODULE__, session_id) do
      [{pid, _}] -> {:ok, pid}
      [] -> :error
    end
  end

  def unregister(session_id) do
    Registry.unregister(__MODULE__, session_id)
  end

  def list_sessions do
    Registry.select(__MODULE__, [{{:"$1", :_, :_}, [], [:"$1"]}])
  end
end
```

---

## 4. Phoenix LiveView

### 4.1 LiveView Lifecycle

```
HTTP Request
  ↓
mount/3 (disconnected)
  ↓
render/1 (static HTML)
  ↓
WebSocket Connection
  ↓
mount/3 (connected, assigns preserved)
  ↓
render/1 (interactive HTML)
  ↓
User Interaction
  ↓
handle_event/3
  ↓
render/1 (diff sent to client)
```

### 4.2 Complete LiveView Example

```elixir
defmodule MyAppWeb.PostLive.Index do
  use MyAppWeb, :live_view

  alias MyApp.Blog
  alias MyApp.Blog.Post

  @impl true
  def mount(_params, _session, socket) do
    if connected?(socket) do
      # Subscribe to real-time updates
      Phoenix.PubSub.subscribe(MyApp.PubSub, "posts")
    end

    {:ok,
     socket
     |> assign(:page_title, "Posts")
     |> stream(:posts, Blog.list_posts())}
  end

  @impl true
  def handle_params(params, _url, socket) do
    {:noreply, apply_action(socket, socket.assigns.live_action, params)}
  end

  defp apply_action(socket, :edit, %{"id" => id}) do
    socket
    |> assign(:page_title, "Edit Post")
    |> assign(:post, Blog.get_post!(id))
  end

  defp apply_action(socket, :new, _params) do
    socket
    |> assign(:page_title, "New Post")
    |> assign(:post, %Post{})
  end

  defp apply_action(socket, :index, _params) do
    socket
    |> assign(:page_title, "Posts")
    |> assign(:post, nil)
  end

  @impl true
  def handle_event("delete", %{"id" => id}, socket) do
    post = Blog.get_post!(id)
    {:ok, _} = Blog.delete_post(post)

    {:noreply, stream_delete(socket, :posts, post)}
  end

  @impl true
  def handle_info({:post_created, post}, socket) do
    {:noreply, stream_insert(socket, :posts, post, at: 0)}
  end

  @impl true
  def handle_info({:post_updated, post}, socket) do
    {:noreply, stream_insert(socket, :posts, post)}
  end

  @impl true
  def handle_info({:post_deleted, post}, socket) do
    {:noreply, stream_delete(socket, :posts, post)}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <div>
      <.header>
        Posts
        <:actions>
          <.link patch={~p"/posts/new"}>
            <.button>New Post</.button>
          </.link>
        </:actions>
      </.header>

      <.table id="posts" rows={@streams.posts}>
        <:col :let={{_id, post}} label="Title"><%= post.title %></:col>
        <:col :let={{_id, post}} label="Published">
          <%= if post.published, do: "Yes", else: "No" %>
        </:col>
        <:action :let={{_id, post}}>
          <.link patch={~p"/posts/#{post}/edit"}>Edit</.link>
        </:action>
        <:action :let={{id, post}}>
          <.link phx-click="delete" phx-value-id={post.id} data-confirm="Are you sure?">
            Delete
          </.link>
        </:action>
      </.table>
    </div>

    <.modal
      :if={@live_action in [:new, :edit]}
      id="post-modal"
      show
      on_cancel={JS.patch(~p"/posts")}
    >
      <.live_component
        module={MyAppWeb.PostLive.FormComponent}
        id={@post.id || :new}
        title={@page_title}
        action={@live_action}
        post={@post}
        patch={~p"/posts"}
      />
    </.modal>
    """
  end
end
```

### 4.3 LiveComponent

```elixir
defmodule MyAppWeb.PostLive.FormComponent do
  use MyAppWeb, :live_component

  alias MyApp.Blog

  @impl true
  def render(assigns) do
    ~H"""
    <div>
      <.header>
        <%= @title %>
        <:subtitle>Use this form to manage post records.</:subtitle>
      </.header>

      <.simple_form
        for={@form}
        id="post-form"
        phx-target={@myself}
        phx-change="validate"
        phx-submit="save"
      >
        <.input field={@form[:title]} type="text" label="Title" />
        <.input field={@form[:body]} type="textarea" label="Body" />
        <.input field={@form[:published]} type="checkbox" label="Published" />
        <:actions>
          <.button phx-disable-with="Saving...">Save Post</.button>
        </:actions>
      </.simple_form>
    </div>
    """
  end

  @impl true
  def update(%{post: post} = assigns, socket) do
    changeset = Blog.change_post(post)

    {:ok,
     socket
     |> assign(assigns)
     |> assign_form(changeset)}
  end

  @impl true
  def handle_event("validate", %{"post" => post_params}, socket) do
    changeset =
      socket.assigns.post
      |> Blog.change_post(post_params)
      |> Map.put(:action, :validate)

    {:noreply, assign_form(socket, changeset)}
  end

  def handle_event("save", %{"post" => post_params}, socket) do
    save_post(socket, socket.assigns.action, post_params)
  end

  defp save_post(socket, :edit, post_params) do
    case Blog.update_post(socket.assigns.post, post_params) do
      {:ok, post} ->
        notify_parent({:saved, post})

        {:noreply,
         socket
         |> put_flash(:info, "Post updated successfully")
         |> push_patch(to: socket.assigns.patch)}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:noreply, assign_form(socket, changeset)}
    end
  end

  defp save_post(socket, :new, post_params) do
    case Blog.create_post(post_params) do
      {:ok, post} ->
        notify_parent({:saved, post})

        {:noreply,
         socket
         |> put_flash(:info, "Post created successfully")
         |> push_patch(to: socket.assigns.patch)}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:noreply, assign_form(socket, changeset)}
    end
  end

  defp assign_form(socket, %Ecto.Changeset{} = changeset) do
    assign(socket, :form, to_form(changeset))
  end

  defp notify_parent(msg), do: send(self(), {__MODULE__, msg})
end
```

### 4.4 LiveView Performance

#### Streams for Large Lists

```elixir
def mount(_params, _session, socket) do
  {:ok,
   socket
   |> stream(:posts, Blog.list_posts(), dom_id: &"post-#{&1.id}")}
end

# Insert at beginning
{:noreply, stream_insert(socket, :posts, new_post, at: 0)}

# Insert at end
{:noreply, stream_insert(socket, :posts, new_post, at: -1)}

# Delete
{:noreply, stream_delete(socket, :posts, post)}

# Reset stream
{:noreply, stream(socket, :posts, new_posts, reset: true)}
```

#### Temporary Assigns

```elixir
def mount(_params, _session, socket) do
  socket =
    socket
    |> assign(:large_data, expensive_computation())
    |> assign(:temp_assigns, [:large_data])

  {:ok, socket}
end
```

#### Debouncing User Input

```elixir
<.input
  field={@form[:search]}
  type="text"
  phx-debounce="500"
  placeholder="Search..."
/>
```

---

## 5. Ecto Database Operations

### 5.1 Schema Definitions

#### Basic Schema

```elixir
defmodule MyApp.Blog.Post do
  use Ecto.Schema
  import Ecto.Changeset

  schema "posts" do
    field :title, :string
    field :body, :text
    field :published, :boolean, default: false
    field :published_at, :utc_datetime
    field :views, :integer, default: 0
    field :slug, :string

    belongs_to :author, MyApp.Accounts.User
    has_many :comments, MyApp.Blog.Comment
    many_to_many :tags, MyApp.Blog.Tag, join_through: "posts_tags"

    timestamps()
  end

  def changeset(post, attrs) do
    post
    |> cast(attrs, [:title, :body, :published, :author_id])
    |> validate_required([:title, :body, :author_id])
    |> validate_length(:title, min: 3, max: 255)
    |> validate_length(:body, min: 10)
    |> generate_slug()
    |> unique_constraint(:slug)
    |> foreign_key_constraint(:author_id)
  end

  defp generate_slug(changeset) do
    if title = get_change(changeset, :title) do
      slug =
        title
        |> String.downcase()
        |> String.replace(~r/[^a-z0-9\\s-]/, "")
        |> String.replace(~r/\\s+/, "-")

      put_change(changeset, :slug, slug)
    else
      changeset
    end
  end
end
```

#### Embedded Schemas

```elixir
defmodule MyApp.Accounts.Address do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key false
  embedded_schema do
    field :street, :string
    field :city, :string
    field :state, :string
    field :zip, :string
    field :country, :string, default: "US"
  end

  def changeset(address, attrs) do
    address
    |> cast(attrs, [:street, :city, :state, :zip, :country])
    |> validate_required([:street, :city, :state, :zip])
    |> validate_format(:zip, ~r/^\\d{5}(-\\d{4})?$/)
  end
end

defmodule MyApp.Accounts.User do
  use Ecto.Schema

  schema "users" do
    field :name, :string
    embeds_one :address, MyApp.Accounts.Address

    timestamps()
  end

  def changeset(user, attrs) do
    user
    |> cast(attrs, [:name])
    |> cast_embed(:address, required: true)
  end
end
```

### 5.2 Advanced Queries

#### Complex Filtering

```elixir
def list_posts(filters \\\\ %{}) do
  Post
  |> filter_by_published(filters)
  |> filter_by_author(filters)
  |> filter_by_tags(filters)
  |> filter_by_date_range(filters)
  |> search_by_text(filters)
  |> order_by_field(filters)
  |> paginate(filters)
  |> Repo.all()
end

defp filter_by_published(query, %{published: true}) do
  where(query, [p], p.published == true)
end

defp filter_by_published(query, _), do: query

defp filter_by_author(query, %{author_id: author_id}) do
  where(query, [p], p.author_id == ^author_id)
end

defp filter_by_author(query, _), do: query

defp filter_by_tags(query, %{tags: tags}) when is_list(tags) do
  from p in query,
    join: t in assoc(p, :tags),
    where: t.name in ^tags,
    group_by: p.id,
    having: count(t.id) == ^length(tags)
end

defp filter_by_tags(query, _), do: query

defp search_by_text(query, %{search: search}) when is_binary(search) do
  search_term = "%#{search}%"
  where(query, [p], ilike(p.title, ^search_term) or ilike(p.body, ^search_term))
end

defp search_by_text(query, _), do: query

defp order_by_field(query, %{sort_by: "views"}), do: order_by(query, desc: :views)
defp order_by_field(query, %{sort_by: "published_at"}), do: order_by(query, desc: :published_at)
defp order_by_field(query, _), do: order_by(query, desc: :inserted_at)

defp paginate(query, %{page: page, per_page: per_page}) do
  from q in query,
    limit: ^per_page,
    offset: ^((page - 1) * per_page)
end

defp paginate(query, _), do: query
```

#### Subqueries

```elixir
# Posts with comment count
def list_posts_with_comment_count do
  comment_count_subquery =
    from c in Comment,
      group_by: c.post_id,
      select: %{post_id: c.post_id, count: count(c.id)}

  from p in Post,
    left_join: cc in subquery(comment_count_subquery),
    on: cc.post_id == p.id,
    select: %{post: p, comment_count: coalesce(cc.count, 0)}
  |> Repo.all()
end
```

#### Window Functions

```elixir
def list_posts_with_rank do
  from p in Post,
    select: %{
      post: p,
      rank: over(row_number(), partition_by: p.author_id, order_by: [desc: p.views])
    }
  |> Repo.all()
end
```

### 5.3 Changesets

#### Multi-Step Validation

```elixir
def registration_changeset(user, attrs) do
  user
  |> cast(attrs, [:email, :password, :password_confirmation])
  |> validate_required([:email, :password])
  |> validate_email()
  |> validate_password()
  |> hash_password()
end

defp validate_email(changeset) do
  changeset
  |> validate_format(:email, ~r/@/)
  |> validate_length(:email, max: 160)
  |> unsafe_validate_unique(:email, MyApp.Repo)
  |> unique_constraint(:email)
end

defp validate_password(changeset) do
  changeset
  |> validate_length(:password, min: 8, max: 72)
  |> validate_format(:password, ~r/[a-z]/, message: "must contain lowercase letter")
  |> validate_format(:password, ~r/[A-Z]/, message: "must contain uppercase letter")
  |> validate_format(:password, ~r/[0-9]/, message: "must contain number")
  |> validate_confirmation(:password, message: "does not match password")
end

defp hash_password(changeset) do
  if password = get_change(changeset, :password) do
    changeset
    |> put_change(:hashed_password, Bcrypt.hash_pwd_salt(password))
    |> delete_change(:password)
    |> delete_change(:password_confirmation)
  else
    changeset
  end
end
```

#### Custom Validations

```elixir
defp validate_future_date(changeset, field) do
  validate_change(changeset, field, fn _, value ->
    if DateTime.compare(value, DateTime.utc_now()) == :gt do
      []
    else
      [{field, "must be in the future"}]
    end
  end)
end
```

### 5.4 Migrations

#### Comprehensive Migration

```elixir
defmodule MyApp.Repo.Migrations.CreatePosts do
  use Ecto.Migration

  def up do
    create table(:posts) do
      add :title, :string, null: false
      add :body, :text, null: false
      add :published, :boolean, default: false, null: false
      add :published_at, :utc_datetime
      add :views, :integer, default: 0, null: false
      add :slug, :string, null: false
      add :author_id, references(:users, on_delete: :delete_all), null: false

      timestamps()
    end

    create unique_index(:posts, [:slug])
    create index(:posts, [:author_id])
    create index(:posts, [:published])
    create index(:posts, [:published_at])

    # Full-text search index (PostgreSQL)
    execute """
    CREATE INDEX posts_search_idx ON posts
    USING GIN (to_tsvector('english', title || ' ' || body))
    """
  end

  def down do
    drop table(:posts)
  end
end
```

#### Data Migrations

```elixir
defmodule MyApp.Repo.Migrations.PopulatePostSlugs do
  use Ecto.Migration
  import Ecto.Query
  alias MyApp.Repo
  alias MyApp.Blog.Post

  def up do
    from(p in Post, where: is_nil(p.slug))
    |> Repo.all()
    |> Enum.each(fn post ->
      slug = generate_slug(post.title)
      from(p in Post, where: p.id == ^post.id)
      |> Repo.update_all(set: [slug: slug])
    end)
  end

  def down do
    # Optional: revert slug generation
  end

  defp generate_slug(title) do
    title
    |> String.downcase()
    |> String.replace(~r/[^a-z0-9\\s-]/, "")
    |> String.replace(~r/\\s+/, "-")
  end
end
```

---

## 6. Phoenix Channels & Real-Time

### 6.1 Channel Implementation

```elixir
defmodule MyAppWeb.RoomChannel do
  use MyAppWeb, :channel

  alias MyApp.Chat
  alias MyAppWeb.Presence

  @impl true
  def join("room:" <> room_id, params, socket) do
    case authorize(socket, room_id, params) do
      {:ok, user_id} ->
        send(self(), :after_join)
        {:ok, assign(socket, :room_id, room_id) |> assign(:user_id, user_id)}

      {:error, reason} ->
        {:error, %{reason: reason}}
    end
  end

  @impl true
  def handle_in("new_msg", %{"body" => body}, socket) do
    message = Chat.create_message(%{
      room_id: socket.assigns.room_id,
      user_id: socket.assigns.user_id,
      body: body
    })

    broadcast!(socket, "new_msg", %{
      id: message.id,
      body: message.body,
      user: %{id: message.user.id, name: message.user.name},
      inserted_at: message.inserted_at
    })

    {:reply, {:ok, %{id: message.id}}, socket}
  end

  @impl true
  def handle_in("typing", _params, socket) do
    broadcast_from!(socket, "user_typing", %{
      user_id: socket.assigns.user_id
    })

    {:noreply, socket}
  end

  @impl true
  def handle_info(:after_join, socket) do
    # Send recent messages
    messages = Chat.list_recent_messages(socket.assigns.room_id, 50)
    push(socket, "messages", %{messages: messages})

    # Track presence
    {:ok, _} = Presence.track(socket, socket.assigns.user_id, %{
      online_at: System.system_time(:second),
      name: get_user_name(socket.assigns.user_id)
    })

    # Send presence state
    push(socket, "presence_state", Presence.list(socket))

    {:noreply, socket}
  end

  @impl true
  def terminate(_reason, socket) do
    # Cleanup on disconnect
    Chat.user_left_room(socket.assigns.user_id, socket.assigns.room_id)
    :ok
  end

  defp authorize(socket, room_id, _params) do
    user_id = socket.assigns[:current_user_id]

    if user_id && Chat.can_access_room?(user_id, room_id) do
      {:ok, user_id}
    else
      {:error, "unauthorized"}
    end
  end

  defp get_user_name(user_id) do
    # Fetch from cache or database
    "User #{user_id}"
  end
end
```

### 6.2 Phoenix Presence

```elixir
defmodule MyAppWeb.Presence do
  use Phoenix.Presence,
    otp_app: :my_app,
    pubsub_server: MyApp.PubSub
end

# In LiveView
def mount(_params, _session, socket) do
  if connected?(socket) do
    Presence.track(self(), "room:lobby", socket.assigns.user_id, %{
      online_at: System.system_time(:second),
      name: socket.assigns.current_user.name
    })

    Phoenix.PubSub.subscribe(MyApp.PubSub, "room:lobby")
  end

  {:ok, assign(socket, :users, list_users())}
end

def handle_info(%{event: "presence_diff"}, socket) do
  {:noreply, assign(socket, :users, list_users())}
end

defp list_users do
  Presence.list("room:lobby")
  |> Enum.map(fn {user_id, %{metas: [meta | _]}} ->
    %{id: user_id, name: meta.name, online_at: meta.online_at}
  end)
end
```

### 6.3 Rate Limiting Channels

```elixir
defmodule MyAppWeb.RoomChannel do
  use MyAppWeb, :channel

  @rate_limit_window 60_000 # 1 minute
  @rate_limit_max 20

  @impl true
  def handle_in("new_msg", payload, socket) do
    user_id = socket.assigns.user_id
    key = "rate_limit:channel:#{user_id}"

    case check_rate_limit(key) do
      :ok ->
        # Process message
        handle_new_message(payload, socket)

      {:error, :rate_limited} ->
        {:reply, {:error, %{reason: "rate limit exceeded"}}, socket}
    end
  end

  defp check_rate_limit(key) do
    case Hammer.check_rate(key, @rate_limit_window, @rate_limit_max) do
      {:allow, _count} -> :ok
      {:deny, _limit} -> {:error, :rate_limited}
    end
  end
end
```

---

## 7. Background Jobs with Oban

### 7.1 Worker Implementation

```elixir
defmodule MyApp.Workers.EmailWorker do
  use Oban.Worker,
    queue: :emails,
    max_attempts: 3,
    priority: 1,
    unique: [period: 60]

  alias MyApp.Mailer

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"type" => "welcome", "user_id" => user_id}}) do
    user = MyApp.Accounts.get_user!(user_id)
    Mailer.send_welcome_email(user)
    :ok
  end

  def perform(%Oban.Job{args: %{"type" => "password_reset", "user_id" => user_id, "token" => token}}) do
    user = MyApp.Accounts.get_user!(user_id)
    Mailer.send_password_reset(user, token)
    :ok
  end

  def perform(%Oban.Job{args: args}) do
    {:error, "Unknown email type: #{inspect(args)}"}
  end
end
```

### 7.2 Scheduling Jobs

```elixir
# Immediate execution
%{type: "welcome", user_id: user.id}
|> MyApp.Workers.EmailWorker.new()
|> Oban.insert()

# Delayed execution
%{type: "reminder", user_id: user.id}
|> MyApp.Workers.EmailWorker.new(schedule_in: 3600) # 1 hour
|> Oban.insert()

# Specific time
%{type: "newsletter", user_id: user.id}
|> MyApp.Workers.EmailWorker.new(scheduled_at: ~U[2025-12-25 09:00:00Z])
|> Oban.insert()

# Unique job (prevent duplicates)
%{type: "daily_digest", user_id: user.id}
|> MyApp.Workers.EmailWorker.new(
  unique: [period: 86400, fields: [:user_id, :type]]
)
|> Oban.insert()

# With priority (0-3, lower is higher priority)
%{type: "urgent", user_id: user.id}
|> MyApp.Workers.EmailWorker.new(priority: 0)
|> Oban.insert()
```

### 7.3 Cron Jobs

```elixir
# config/config.exs
config :my_app, Oban,
  repo: MyApp.Repo,
  queues: [
    default: 10,
    emails: 20,
    reports: 5,
    analytics: 10
  ],
  plugins: [
    # Cron plugin
    {Oban.Plugins.Cron,
     crontab: [
       # Every day at 2 AM
       {"0 2 * * *", MyApp.Workers.DailyReportWorker},
       # Every 15 minutes
       {"*/15 * * * *", MyApp.Workers.CacheWarmerWorker},
       # Every Sunday at midnight
       {"0 0 * * 0", MyApp.Workers.WeeklyDigestWorker},
       # First of month at 3 AM
       {"0 3 1 * *", MyApp.Workers.MonthlyInvoiceWorker}
     ]},
    # Pruning plugin (delete completed jobs after 60 seconds)
    {Oban.Plugins.Pruner, max_age: 60},
    # Stale jobs plugin (rescue stuck jobs)
    {Oban.Plugins.Stager, interval: 1000},
    # Lifeline plugin (restart crashed queues)
    {Oban.Plugins.Lifeline, rescue_after: :timer.minutes(30)}
  ]
```

### 7.4 Advanced Worker Patterns

#### Batch Processing

```elixir
defmodule MyApp.Workers.BatchProcessor do
  use Oban.Worker,
    queue: :batch,
    max_attempts: 1

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"batch_id" => batch_id}}) do
    items = MyApp.Batches.get_batch_items(batch_id)

    # Process in chunks
    items
    |> Enum.chunk_every(100)
    |> Enum.each(fn chunk ->
      process_chunk(chunk)
    end)

    MyApp.Batches.mark_complete(batch_id)
    :ok
  end

  defp process_chunk(items) do
    # Process items in parallel
    items
    |> Task.async_stream(&process_item/1, max_concurrency: 10, timeout: 30_000)
    |> Enum.to_list()
  end

  defp process_item(item) do
    # Process individual item
  end
end
```

#### Retry with Backoff

```elixir
defmodule MyApp.Workers.APIWorker do
  use Oban.Worker,
    queue: :api,
    max_attempts: 5

  @impl Oban.Worker
  def perform(%Oban.Job{attempt: attempt} = job) do
    case fetch_external_api(job.args) do
      {:ok, data} ->
        process_data(data)
        :ok

      {:error, :rate_limited} ->
        # Exponential backoff: 2^attempt seconds
        backoff = :math.pow(2, attempt) |> round()
        {:snooze, backoff}

      {:error, :temporary_error} ->
        {:error, "temporary error, will retry"}

      {:error, :permanent_error} ->
        # Cancel job, don't retry
        {:cancel, "permanent error"}
    end
  end
end
```

---

## 8. Authentication & Authorization

### 8.1 Phoenix Auth Generator

```bash
# Generate authentication system
mix phx.gen.auth Accounts User users
```

This generates:
- User schema with password hashing
- Session management
- User confirmation emails
- Password reset functionality
- Controllers and views

### 8.2 Guardian JWT Authentication

```elixir
# config/config.exs
config :my_app, MyAppWeb.Auth.Guardian,
  issuer: "my_app",
  secret_key: System.get_env("GUARDIAN_SECRET_KEY")

# lib/my_app_web/auth/guardian.ex
defmodule MyAppWeb.Auth.Guardian do
  use Guardian, otp_app: :my_app

  alias MyApp.Accounts

  def subject_for_token(%{id: id}, _claims) do
    {:ok, to_string(id)}
  end

  def resource_from_claims(%{"sub" => id}) do
    case Accounts.get_user(id) do
      nil -> {:error, :user_not_found}
      user -> {:ok, user}
    end
  end
end

# lib/my_app_web/auth/pipeline.ex
defmodule MyAppWeb.Auth.Pipeline do
  use Guardian.Plug.Pipeline,
    otp_app: :my_app,
    module: MyAppWeb.Auth.Guardian,
    error_handler: MyAppWeb.Auth.ErrorHandler

  plug Guardian.Plug.VerifyHeader
  plug Guardian.Plug.EnsureAuthenticated
  plug MyAppWeb.Auth.LoadUser
end

# lib/my_app_web/auth/load_user.ex
defmodule MyAppWeb.Auth.LoadUser do
  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    case Guardian.Plug.current_resource(conn) do
      nil -> conn
      user -> assign(conn, :current_user, user)
    end
  end
end
```

### 8.3 Authorization with Policies

```elixir
defmodule MyApp.Policies.PostPolicy do
  alias MyApp.Blog.Post
  alias MyApp.Accounts.User

  def can?(%User{role: :admin}, _action, %Post{}), do: true
  def can?(%User{id: user_id}, :edit, %Post{author_id: author_id}), do: user_id == author_id
  def can?(%User{id: user_id}, :delete, %Post{author_id: author_id}), do: user_id == author_id
  def can?(%User{}, :view, %Post{published: true}), do: true
  def can?(_, _, _), do: false
end

# In controller
defmodule MyAppWeb.PostController do
  use MyAppWeb, :controller
  alias MyApp.Policies.PostPolicy

  def edit(conn, %{"id" => id}) do
    post = Blog.get_post!(id)

    if PostPolicy.can?(conn.assigns.current_user, :edit, post) do
      render(conn, "edit.html", post: post)
    else
      conn
      |> put_status(:forbidden)
      |> render("error.html", message: "Unauthorized")
    end
  end
end
```

---

## 9. Testing Strategies

### 9.1 ExUnit Test Configuration

```elixir
# test/support/data_case.ex
defmodule MyApp.DataCase do
  use ExUnit.CaseTemplate

  using do
    quote do
      alias MyApp.Repo
      import Ecto
      import Ecto.Changeset
      import Ecto.Query
      import MyApp.DataCase
    end
  end

  setup tags do
    MyApp.DataCase.setup_sandbox(tags)
    :ok
  end

  def setup_sandbox(tags) do
    pid = Ecto.Adapters.SQL.Sandbox.start_owner!(MyApp.Repo, shared: not tags[:async])
    on_exit(fn -> Ecto.Adapters.SQL.Sandbox.stop_owner(pid) end)
  end
end
```

### 9.2 Factory Pattern

```elixir
defmodule MyApp.Factory do
  alias MyApp.Repo

  def build(:user) do
    %MyApp.Accounts.User{
      email: "user#{System.unique_integer()}@example.com",
      name: "Test User",
      hashed_password: Bcrypt.hash_pwd_salt("password123")
    }
  end

  def build(:post) do
    %MyApp.Blog.Post{
      title: "Test Post",
      body: "This is a test post body",
      published: false,
      author: build(:user)
    }
  end

  def build(factory_name, attributes) do
    factory_name |> build() |> struct!(attributes)
  end

  def insert!(factory_name, attributes \\\\ []) do
    factory_name |> build(attributes) |> Repo.insert!()
  end
end
```

### 9.3 LiveView Testing

```elixir
defmodule MyAppWeb.PostLive.IndexTest do
  use MyAppWeb.ConnCase
  import Phoenix.LiveViewTest
  import MyApp.Factory

  setup do
    user = insert!(:user)
    post = insert!(:post, author: user)
    %{user: user, post: post}
  end

  test "displays list of posts", %{conn: conn, post: post} do
    {:ok, view, html} = live(conn, ~p"/posts")
    assert html =~ post.title
  end

  test "creates new post", %{conn: conn} do
    {:ok, view, _html} = live(conn, ~p"/posts")

    assert view |> element("a", "New Post") |> render_click() =~
             "New Post"

    assert_patch(view, ~p"/posts/new")

    assert view
           |> form("#post-form", post: %{title: "New", body: "Content"})
           |> render_submit()

    assert_patch(view, ~p"/posts")

    html = render(view)
    assert html =~ "Post created successfully"
    assert html =~ "New"
  end

  test "deletes post", %{conn: conn, post: post} do
    {:ok, view, _html} = live(conn, ~p"/posts")

    assert view
           |> element("#posts-#{post.id} a", "Delete")
           |> render_click()

    refute has_element?(view, "#posts-#{post.id}")
  end
end
```

---

## 10. Performance Optimization

### 10.1 Query Optimization

See Section 5 (Ecto Database Operations) for N+1 prevention and query optimization patterns.

### 10.2 Caching Strategies

```elixir
defmodule MyApp.Cache do
  use Nebulex.Cache,
    otp_app: :my_app,
    adapter: Nebulex.Adapters.Local

  # Cacheable function
  def get_or_compute(key, ttl, fun) do
    case get(key) do
      nil ->
        value = fun.()
        put(key, value, ttl: ttl)
        value

      value ->
        value
    end
  end
end

# Usage
def get_dashboard_stats(user_id) do
  MyApp.Cache.get_or_compute(
    "dashboard_stats:#{user_id}",
    :timer.minutes(5),
    fn -> compute_stats(user_id) end
  )
end
```

### 10.3 LiveView Performance

See Section 4.4 for streams, temporary assigns, and debouncing patterns.

---

## 11. Production Deployment

### 11.1 Releases

```bash
# Build release
MIX_ENV=prod mix release

# Run release
_build/prod/rel/my_app/bin/my_app start
_build/prod/rel/my_app/bin/my_app daemon # Background
_build/prod/rel/my_app/bin/my_app stop
```

### 11.2 Runtime Configuration

See Section 7 (Production Deployment) in SKILL.md for runtime.exs patterns.

### 11.3 Monitoring with Telemetry

See Section 7 (Production Deployment) in SKILL.md for telemetry instrumentation.

---

## 12. Security Best Practices

### 12.1 SQL Injection Prevention

Always use Ecto parameterization (see Section 9 in SKILL.md).

### 12.2 CSRF Protection

```elixir
# Enabled by default in Phoenix
plug :protect_from_forgery
```

### 12.3 Content Security Policy

```elixir
# lib/my_app_web/endpoint.ex
plug Plug.Static,
  at: "/",
  from: :my_app,
  gzip: false,
  only: ~w(assets fonts images favicon.ico robots.txt),
  headers: %{
    "content-security-policy" => "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
  }
```

---

**For Quick Reference**: See [SKILL.md](SKILL.md) for condensed patterns and cheatsheets.

**For Examples**: See [examples/](examples/) for complete, production-ready code samples.

**For Templates**: See [templates/](templates/) for code generation templates.
