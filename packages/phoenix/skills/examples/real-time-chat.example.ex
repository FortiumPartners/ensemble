# Example: Real-Time Chat with Phoenix LiveView and Channels
# Demonstrates: LiveView, PubSub, Presence, Channels, Real-time Updates

# ============================================================================
# SCHEMA DEFINITIONS
# ============================================================================

defmodule MyApp.Chat.Room do
  use Ecto.Schema
  import Ecto.Changeset

  schema "chat_rooms" do
    field :name, :string
    field :topic, :string
    field :private, :boolean, default: false

    has_many :messages, MyApp.Chat.Message
    many_to_many :members, MyApp.Accounts.User, join_through: "chat_room_members"

    timestamps()
  end

  def changeset(room, attrs) do
    room
    |> cast(attrs, [:name, :topic, :private])
    |> validate_required([:name])
    |> validate_length(:name, min: 3, max: 50)
    |> unique_constraint(:name)
  end
end

defmodule MyApp.Chat.Message do
  use Ecto.Schema
  import Ecto.Changeset

  schema "chat_messages" do
    field :body, :string
    field :message_type, :string, default: "text" # text, image, file

    belongs_to :room, MyApp.Chat.Room
    belongs_to :user, MyApp.Accounts.User

    timestamps()
  end

  def changeset(message, attrs) do
    message
    |> cast(attrs, [:body, :message_type, :room_id, :user_id])
    |> validate_required([:body, :room_id, :user_id])
    |> validate_length(:body, min: 1, max: 5000)
    |> validate_inclusion(:message_type, ["text", "image", "file"])
    |> foreign_key_constraint(:room_id)
    |> foreign_key_constraint(:user_id)
  end
end

# ============================================================================
# CONTEXT - CHAT OPERATIONS
# ============================================================================

defmodule MyApp.Chat do
  @moduledoc """
  The Chat context - manages chat rooms and messages.
  """

  import Ecto.Query
  alias MyApp.Repo
  alias MyApp.Chat.{Room, Message}

  # ========================================
  # Rooms
  # ========================================

  def list_rooms do
    Room
    |> where([r], r.private == false)
    |> order_by(desc: :inserted_at)
    |> Repo.all()
  end

  def get_room!(id) do
    Room
    |> preload(:members)
    |> Repo.get!(id)
  end

  def create_room(attrs \\ %{}) do
    %Room{}
    |> Room.changeset(attrs)
    |> Repo.insert()
  end

  def can_access_room?(user_id, room_id) do
    room = get_room!(room_id)

    cond do
      !room.private -> true
      Enum.any?(room.members, &(&1.id == user_id)) -> true
      true -> false
    end
  end

  # ========================================
  # Messages
  # ========================================

  def list_recent_messages(room_id, limit \\ 50) do
    from(m in Message,
      where: m.room_id == ^room_id,
      order_by: [desc: m.inserted_at],
      limit: ^limit,
      preload: [:user]
    )
    |> Repo.all()
    |> Enum.reverse()
  end

  def create_message(attrs \\ %{}) do
    %Message{}
    |> Message.changeset(attrs)
    |> Repo.insert()
    |> broadcast_message_created()
  end

  defp broadcast_message_created({:ok, message} = result) do
    message = Repo.preload(message, [:user, :room])

    Phoenix.PubSub.broadcast(
      MyApp.PubSub,
      "room:#{message.room_id}",
      {:new_message, render_message(message)}
    )

    result
  end

  defp broadcast_message_created(error), do: error

  defp render_message(message) do
    %{
      id: message.id,
      body: message.body,
      message_type: message.message_type,
      user: %{
        id: message.user.id,
        name: message.user.name
      },
      inserted_at: message.inserted_at
    }
  end

  def user_left_room(user_id, room_id) do
    # Clean up logic when user disconnects
    :ok
  end
end

# ============================================================================
# PHOENIX PRESENCE
# ============================================================================

defmodule MyAppWeb.Presence do
  @moduledoc """
  Presence tracking for chat rooms.
  """

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

  def update_typing_status(room_id, user_id, typing) do
    update(
      self(),
      "room:#{room_id}",
      user_id,
      fn meta -> %{meta | typing: typing} end
    )
  end

  def list_users(room_id) do
    list("room:#{room_id}")
    |> Enum.map(fn {user_id, %{metas: [meta | _]}} ->
      %{
        id: user_id,
        name: meta.name,
        online_at: meta.online_at,
        typing: meta.typing
      }
    end)
    |> Enum.sort_by(& &1.name)
  end
end

# ============================================================================
# LIVEVIEW - CHAT ROOM
# ============================================================================

defmodule MyAppWeb.ChatRoomLive do
  use MyAppWeb, :live_view

  alias MyApp.Chat
  alias MyAppWeb.Presence

  @impl true
  def mount(%{"id" => room_id}, session, socket) do
    user = get_user_from_session(session)

    if connected?(socket) do
      # Check authorization
      if Chat.can_access_room?(user.id, room_id) do
        # Subscribe to room updates
        Phoenix.PubSub.subscribe(MyApp.PubSub, "room:#{room_id}")

        # Track presence
        {:ok, _} = Presence.track_user(room_id, to_string(user.id), user.name)

        # Send presence state after join
        send(self(), :after_join)

        {:ok, initialize_socket(socket, room_id, user)}
      else
        {:ok,
         socket
         |> put_flash(:error, "You don't have access to this room")
         |> redirect(to: ~p"/chat")}
      end
    else
      {:ok, initialize_socket(socket, room_id, user)}
    end
  end

  defp initialize_socket(socket, room_id, user) do
    room = Chat.get_room!(room_id)
    messages = Chat.list_recent_messages(room_id, 50)

    socket
    |> assign(:room, room)
    |> assign(:current_user, user)
    |> assign(:users, [])
    |> assign(:typing_users, [])
    |> assign(:message_form, to_form(%{"body" => ""}))
    |> stream(:messages, messages, dom_id: &"message-#{&1.id}")
  end

  @impl true
  def handle_event("send_message", %{"body" => body}, socket) do
    if String.trim(body) != "" do
      attrs = %{
        body: body,
        room_id: socket.assigns.room.id,
        user_id: socket.assigns.current_user.id
      }

      case Chat.create_message(attrs) do
        {:ok, _message} ->
          # Clear typing indicator
          Presence.update_typing_status(
            socket.assigns.room.id,
            to_string(socket.assigns.current_user.id),
            false
          )

          {:noreply,
           socket
           |> assign(:message_form, to_form(%{"body" => ""}))}

        {:error, _changeset} ->
          {:noreply, put_flash(socket, :error, "Failed to send message")}
      end
    else
      {:noreply, socket}
    end
  end

  @impl true
  def handle_event("typing", _params, socket) do
    Presence.update_typing_status(
      socket.assigns.room.id,
      to_string(socket.assigns.current_user.id),
      true
    )

    # Schedule typing timeout
    Process.send_after(self(), :typing_timeout, 3000)

    {:noreply, socket}
  end

  @impl true
  def handle_info(:after_join, socket) do
    # Load initial messages and presence
    users = Presence.list_users(socket.assigns.room.id)

    {:noreply, assign(socket, :users, users)}
  end

  @impl true
  def handle_info({:new_message, message}, socket) do
    {:noreply, stream_insert(socket, :messages, message, at: -1)}
  end

  @impl true
  def handle_info(%{event: "presence_diff", payload: _payload}, socket) do
    users = Presence.list_users(socket.assigns.room.id)
    typing_users = Enum.filter(users, & &1.typing)

    {:noreply,
     socket
     |> assign(:users, users)
     |> assign(:typing_users, typing_users)}
  end

  @impl true
  def handle_info(:typing_timeout, socket) do
    Presence.update_typing_status(
      socket.assigns.room.id,
      to_string(socket.assigns.current_user.id),
      false
    )

    {:noreply, socket}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <div class="chat-container">
      <div class="chat-header">
        <h1><%= @room.name %></h1>
        <p><%= @room.topic %></p>
      </div>

      <div class="chat-main">
        <!-- Messages -->
        <div class="messages" id="messages" phx-update="stream">
          <div
            :for={{dom_id, message} <- @streams.messages}
            id={dom_id}
            class="message"
          >
            <div class="message-author"><%= message.user.name %></div>
            <div class="message-body"><%= message.body %></div>
            <div class="message-time">
              <%= Calendar.strftime(message.inserted_at, "%I:%M %p") %>
            </div>
          </div>
        </div>

        <!-- Typing Indicator -->
        <div :if={length(@typing_users) > 0} class="typing-indicator">
          <%= typing_text(@typing_users) %>
        </div>

        <!-- Message Input -->
        <.form
          for={@message_form}
          phx-submit="send_message"
          phx-change="typing"
          class="message-form"
        >
          <input
            type="text"
            name="body"
            value={@message_form[:body].value}
            placeholder="Type a message..."
            autocomplete="off"
            phx-debounce="1000"
          />
          <button type="submit">Send</button>
        </.form>
      </div>

      <!-- User List -->
      <div class="user-list">
        <h3>Online Users (<%= length(@users) %>)</h3>
        <ul>
          <li :for={user <- @users}>
            <%= user.name %>
            <span :if={user.typing} class="typing-badge">typing...</span>
          </li>
        </ul>
      </div>
    </div>
    """
  end

  defp typing_text([user]), do: "#{user.name} is typing..."
  defp typing_text([user1, user2]), do: "#{user1.name} and #{user2.name} are typing..."
  defp typing_text(users) when length(users) > 2 do
    "#{hd(users).name} and #{length(users) - 1} others are typing..."
  end

  defp get_user_from_session(_session) do
    # In production, load from session
    %{id: 1, name: "Test User"}
  end
end

# ============================================================================
# PHOENIX CHANNEL (Alternative to LiveView)
# ============================================================================

defmodule MyAppWeb.RoomChannel do
  use MyAppWeb, :channel

  alias MyApp.Chat
  alias MyAppWeb.Presence

  @impl true
  def join("room:" <> room_id, _params, socket) do
    user_id = socket.assigns[:user_id]

    if user_id && Chat.can_access_room?(user_id, room_id) do
      send(self(), :after_join)
      {:ok, assign(socket, :room_id, room_id)}
    else
      {:error, %{reason: "unauthorized"}}
    end
  end

  @impl true
  def handle_in("new_msg", %{"body" => body}, socket) do
    attrs = %{
      body: body,
      room_id: socket.assigns.room_id,
      user_id: socket.assigns.user_id
    }

    case Chat.create_message(attrs) do
      {:ok, message} ->
        broadcast!(socket, "new_msg", %{
          id: message.id,
          body: message.body,
          user: %{id: message.user_id, name: get_user_name(message.user_id)},
          inserted_at: message.inserted_at
        })

        {:reply, {:ok, %{id: message.id}}, socket}

      {:error, _changeset} ->
        {:reply, {:error, %{reason: "invalid message"}}, socket}
    end
  end

  @impl true
  def handle_in("typing", _params, socket) do
    Presence.update_typing_status(
      socket.assigns.room_id,
      to_string(socket.assigns.user_id),
      true
    )

    {:noreply, socket}
  end

  @impl true
  def handle_info(:after_join, socket) do
    # Load recent messages
    messages = Chat.list_recent_messages(socket.assigns.room_id, 50)
    push(socket, "messages", %{messages: messages})

    # Track presence
    {:ok, _} = Presence.track_user(
      socket.assigns.room_id,
      to_string(socket.assigns.user_id),
      get_user_name(socket.assigns.user_id)
    )

    # Send presence state
    push(socket, "presence_state", Presence.list("room:#{socket.assigns.room_id}"))

    {:noreply, socket}
  end

  @impl true
  def terminate(_reason, socket) do
    Chat.user_left_room(socket.assigns.user_id, socket.assigns.room_id)
    :ok
  end

  defp get_user_name(_user_id) do
    # In production, fetch from database or cache
    "User"
  end
end

# ============================================================================
# MIGRATIONS
# ============================================================================

defmodule MyApp.Repo.Migrations.CreateChatRooms do
  use Ecto.Migration

  def change do
    create table(:chat_rooms) do
      add :name, :string, null: false
      add :topic, :string
      add :private, :boolean, default: false, null: false

      timestamps()
    end

    create unique_index(:chat_rooms, [:name])

    create table(:chat_messages) do
      add :body, :text, null: false
      add :message_type, :string, default: "text", null: false
      add :room_id, references(:chat_rooms, on_delete: :delete_all), null: false
      add :user_id, references(:users, on_delete: :delete_all), null: false

      timestamps()
    end

    create index(:chat_messages, [:room_id])
    create index(:chat_messages, [:user_id])
    create index(:chat_messages, [:inserted_at])

    create table(:chat_room_members, primary_key: false) do
      add :room_id, references(:chat_rooms, on_delete: :delete_all), null: false
      add :user_id, references(:users, on_delete: :delete_all), null: false

      timestamps()
    end

    create unique_index(:chat_room_members, [:room_id, :user_id])
  end
end
