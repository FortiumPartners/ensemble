# Example: Complete Blog Post CRUD with Phoenix
# Demonstrates: Contexts, Controllers, Ecto, Associations, N+1 Prevention, Caching

# ============================================================================
# SCHEMA DEFINITION WITH ASSOCIATIONS
# ============================================================================

defmodule MyApp.Blog.Post do
  use Ecto.Schema
  import Ecto.Changeset

  @type t :: %__MODULE__{
          id: integer(),
          title: String.t(),
          body: String.t(),
          slug: String.t(),
          published: boolean(),
          published_at: DateTime.t() | nil,
          views: integer(),
          metadata: map(),
          author_id: integer(),
          author: MyApp.Accounts.User.t() | Ecto.Association.NotLoaded.t(),
          comments: [MyApp.Blog.Comment.t()] | Ecto.Association.NotLoaded.t(),
          tags: [MyApp.Blog.Tag.t()] | Ecto.Association.NotLoaded.t(),
          inserted_at: DateTime.t(),
          updated_at: DateTime.t()
        }

  schema "posts" do
    field :title, :string
    field :body, :string
    field :slug, :string
    field :published, :boolean, default: false
    field :published_at, :utc_datetime
    field :views, :integer, default: 0
    field :metadata, :map, default: %{}

    belongs_to :author, MyApp.Accounts.User
    has_many :comments, MyApp.Blog.Comment
    many_to_many :tags, MyApp.Blog.Tag, join_through: "posts_tags", on_replace: :delete

    timestamps()
  end

  @doc """
  Changeset for creating a new post.
  """
  def changeset(post, attrs) do
    post
    |> cast(attrs, [:title, :body, :published, :author_id, :metadata])
    |> validate_required([:title, :body, :author_id])
    |> validate_length(:title, min: 3, max: 255)
    |> validate_length(:body, min: 10)
    |> generate_slug()
    |> unique_constraint(:slug)
    |> foreign_key_constraint(:author_id)
    |> put_published_at()
  end

  @doc """
  Changeset for updating a post with tags.
  """
  def update_changeset(post, attrs) do
    post
    |> cast(attrs, [:title, :body, :published, :metadata])
    |> validate_required([:title, :body])
    |> validate_length(:title, min: 3, max: 255)
    |> validate_length(:body, min: 10)
    |> generate_slug()
    |> unique_constraint(:slug)
    |> put_published_at()
  end

  defp generate_slug(changeset) do
    if title = get_change(changeset, :title) do
      slug =
        title
        |> String.downcase()
        |> String.replace(~r/[^a-z0-9\s-]/, "")
        |> String.replace(~r/\s+/, "-")
        |> String.slice(0, 100)

      put_change(changeset, :slug, slug)
    else
      changeset
    end
  end

  defp put_published_at(changeset) do
    case get_change(changeset, :published) do
      true ->
        if get_field(changeset, :published_at) == nil do
          put_change(changeset, :published_at, DateTime.utc_now())
        else
          changeset
        end

      false ->
        put_change(changeset, :published_at, nil)

      nil ->
        changeset
    end
  end
end

# ============================================================================
# CONTEXT WITH CRUD OPERATIONS AND N+1 PREVENTION
# ============================================================================

defmodule MyApp.Blog do
  @moduledoc """
  The Blog context - manages posts, comments, and tags.
  """

  import Ecto.Query, warn: false
  alias MyApp.Repo
  alias MyApp.Blog.{Post, Comment, Tag}

  # ========================================
  # Posts - Basic CRUD
  # ========================================

  @doc """
  Returns the list of posts with N+1 prevention.
  """
  def list_posts do
    Post
    |> preload([:author, :tags])
    |> order_by(desc: :inserted_at)
    |> Repo.all()
  end

  @doc """
  Returns paginated posts with associations preloaded.
  """
  def list_posts_paginated(page, per_page \\ 20) do
    Post
    |> preload([:author, :tags])
    |> order_by(desc: :inserted_at)
    |> limit(^per_page)
    |> offset(^((page - 1) * per_page))
    |> Repo.all()
  end

  @doc """
  Returns only published posts.
  """
  def list_published_posts do
    from(p in Post,
      where: p.published == true,
      order_by: [desc: p.published_at],
      preload: [:author, :tags]
    )
    |> Repo.all()
  end

  @doc """
  Gets a single post with all associations.
  """
  def get_post!(id) do
    Post
    |> preload([:author, :tags, comments: [:author]])
    |> Repo.get!(id)
  end

  @doc """
  Gets a post by slug with associations.
  """
  def get_post_by_slug!(slug) do
    from(p in Post,
      where: p.slug == ^slug,
      preload: [:author, :tags, comments: [:author]]
    )
    |> Repo.one!()
  end

  @doc """
  Creates a post with tags.
  """
  def create_post(attrs \\ %{}) do
    tag_ids = Map.get(attrs, "tag_ids", [])

    %Post{}
    |> Post.changeset(attrs)
    |> put_tags(tag_ids)
    |> Repo.insert()
    |> broadcast_post_created()
  end

  @doc """
  Updates a post with tags.
  """
  def update_post(%Post{} = post, attrs) do
    tag_ids = Map.get(attrs, "tag_ids", [])

    post
    |> Repo.preload(:tags)
    |> Post.update_changeset(attrs)
    |> put_tags(tag_ids)
    |> Repo.update()
    |> broadcast_post_updated()
  end

  @doc """
  Publishes a post.
  """
  def publish_post(%Post{} = post) do
    post
    |> Ecto.Changeset.change(published: true, published_at: DateTime.utc_now())
    |> Repo.update()
    |> broadcast_post_updated()
  end

  @doc """
  Increments view count for a post.
  """
  def increment_views(%Post{} = post) do
    from(p in Post, where: p.id == ^post.id)
    |> Repo.update_all(inc: [views: 1])
  end

  @doc """
  Deletes a post.
  """
  def delete_post(%Post{} = post) do
    Repo.delete(post)
    |> broadcast_post_deleted()
  end

  @doc """
  Returns an `%Ecto.Changeset{}` for tracking post changes.
  """
  def change_post(%Post{} = post, attrs \\ %{}) do
    Post.changeset(post, attrs)
  end

  # ========================================
  # Posts - Advanced Queries
  # ========================================

  @doc """
  Search posts by title or body with full-text search.
  """
  def search_posts(query_string) when is_binary(query_string) do
    search_term = "%#{query_string}%"

    from(p in Post,
      where: ilike(p.title, ^search_term) or ilike(p.body, ^search_term),
      preload: [:author, :tags],
      order_by: [desc: :inserted_at]
    )
    |> Repo.all()
  end

  @doc """
  Filter posts by multiple criteria.
  """
  def filter_posts(filters \\ %{}) do
    Post
    |> filter_by_author(filters)
    |> filter_by_published(filters)
    |> filter_by_tags(filters)
    |> filter_by_date_range(filters)
    |> order_posts(filters)
    |> paginate_posts(filters)
    |> preload([:author, :tags])
    |> Repo.all()
  end

  defp filter_by_author(query, %{author_id: author_id}) do
    where(query, [p], p.author_id == ^author_id)
  end

  defp filter_by_author(query, _), do: query

  defp filter_by_published(query, %{published: true}) do
    where(query, [p], p.published == true)
  end

  defp filter_by_published(query, _), do: query

  defp filter_by_tags(query, %{tags: tag_names}) when is_list(tag_names) do
    from p in query,
      join: t in assoc(p, :tags),
      where: t.name in ^tag_names,
      group_by: p.id,
      having: count(t.id) == ^length(tag_names)
  end

  defp filter_by_tags(query, _), do: query

  defp filter_by_date_range(query, %{from: from_date, to: to_date}) do
    where(query, [p], p.inserted_at >= ^from_date and p.inserted_at <= ^to_date)
  end

  defp filter_by_date_range(query, _), do: query

  defp order_posts(query, %{sort_by: "views"}), do: order_by(query, [p], desc: p.views)
  defp order_posts(query, %{sort_by: "title"}), do: order_by(query, [p], asc: p.title)
  defp order_posts(query, _), do: order_by(query, [p], desc: p.inserted_at)

  defp paginate_posts(query, %{page: page, per_page: per_page}) do
    from q in query,
      limit: ^per_page,
      offset: ^((page - 1) * per_page)
  end

  defp paginate_posts(query, _), do: query

  @doc """
  Get posts with comment count (using subquery to prevent N+1).
  """
  def list_posts_with_comment_count do
    comment_count_subquery =
      from c in Comment,
        group_by: c.post_id,
        select: %{post_id: c.post_id, count: count(c.id)}

    from(p in Post,
      left_join: cc in subquery(comment_count_subquery),
      on: cc.post_id == p.id,
      preload: [:author, :tags],
      select: %{post: p, comment_count: coalesce(cc.count, 0)},
      order_by: [desc: p.inserted_at]
    )
    |> Repo.all()
  end

  # ========================================
  # Tags Management
  # ========================================

  defp put_tags(changeset, tag_ids) when is_list(tag_ids) do
    tags = Repo.all(from t in Tag, where: t.id in ^tag_ids)
    Ecto.Changeset.put_assoc(changeset, :tags, tags)
  end

  defp put_tags(changeset, _), do: changeset

  # ========================================
  # PubSub Broadcasting
  # ========================================

  defp broadcast_post_created({:ok, post} = result) do
    Phoenix.PubSub.broadcast(MyApp.PubSub, "posts", {:post_created, post})
    result
  end

  defp broadcast_post_created(error), do: error

  defp broadcast_post_updated({:ok, post} = result) do
    Phoenix.PubSub.broadcast(MyApp.PubSub, "posts", {:post_updated, post})
    result
  end

  defp broadcast_post_updated(error), do: error

  defp broadcast_post_deleted({:ok, post} = result) do
    Phoenix.PubSub.broadcast(MyApp.PubSub, "posts", {:post_deleted, post})
    result
  end

  defp broadcast_post_deleted(error), do: error
end

# ============================================================================
# CONTROLLER WITH RESTFUL API
# ============================================================================

defmodule MyAppWeb.PostController do
  use MyAppWeb, :controller

  alias MyApp.Blog
  alias MyApp.Blog.Post

  action_fallback MyAppWeb.FallbackController

  @doc """
  GET /api/posts - List all posts with pagination and filtering
  """
  def index(conn, params) do
    filters = parse_filters(params)
    posts = Blog.filter_posts(filters)
    render(conn, :index, posts: posts)
  end

  @doc """
  GET /api/posts/:id - Get a single post
  """
  def show(conn, %{"id" => id}) do
    post = Blog.get_post!(id)
    Blog.increment_views(post)
    render(conn, :show, post: post)
  end

  @doc """
  POST /api/posts - Create a new post
  """
  def create(conn, %{"post" => post_params}) do
    post_params = Map.put(post_params, "author_id", conn.assigns.current_user.id)

    with {:ok, %Post{} = post} <- Blog.create_post(post_params) do
      conn
      |> put_status(:created)
      |> put_resp_header("location", ~p"/api/posts/#{post}")
      |> render(:show, post: post)
    end
  end

  @doc """
  PUT /api/posts/:id - Update a post
  """
  def update(conn, %{"id" => id, "post" => post_params}) do
    post = Blog.get_post!(id)

    # Authorization check
    if post.author_id == conn.assigns.current_user.id do
      with {:ok, %Post{} = post} <- Blog.update_post(post, post_params) do
        render(conn, :show, post: post)
      end
    else
      conn
      |> put_status(:forbidden)
      |> json(%{error: "You can only edit your own posts"})
    end
  end

  @doc """
  POST /api/posts/:id/publish - Publish a post
  """
  def publish(conn, %{"id" => id}) do
    post = Blog.get_post!(id)

    if post.author_id == conn.assigns.current_user.id do
      with {:ok, %Post{} = post} <- Blog.publish_post(post) do
        render(conn, :show, post: post)
      end
    else
      conn
      |> put_status(:forbidden)
      |> json(%{error: "You can only publish your own posts"})
    end
  end

  @doc """
  DELETE /api/posts/:id - Delete a post
  """
  def delete(conn, %{"id" => id}) do
    post = Blog.get_post!(id)

    if post.author_id == conn.assigns.current_user.id do
      with {:ok, %Post{}} <- Blog.delete_post(post) do
        send_resp(conn, :no_content, "")
      end
    else
      conn
      |> put_status(:forbidden)
      |> json(%{error: "You can only delete your own posts"})
    end
  end

  @doc """
  GET /api/posts/search?q=query - Search posts
  """
  def search(conn, %{"q" => query}) do
    posts = Blog.search_posts(query)
    render(conn, :index, posts: posts)
  end

  defp parse_filters(params) do
    %{}
    |> maybe_put(:author_id, params["author_id"])
    |> maybe_put(:published, params["published"] == "true")
    |> maybe_put(:tags, parse_tags(params["tags"]))
    |> maybe_put(:sort_by, params["sort_by"])
    |> maybe_put(:page, parse_int(params["page"], 1))
    |> maybe_put(:per_page, parse_int(params["per_page"], 20))
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp parse_tags(nil), do: nil
  defp parse_tags(tags) when is_binary(tags), do: String.split(tags, ",")
  defp parse_tags(_), do: nil

  defp parse_int(nil, default), do: default
  defp parse_int(value, default) when is_binary(value) do
    case Integer.parse(value) do
      {int, _} -> int
      :error -> default
    end
  end
  defp parse_int(_, default), do: default
end

# ============================================================================
# JSON VIEW
# ============================================================================

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
      slug: post.slug,
      published: post.published,
      published_at: post.published_at,
      views: post.views,
      author: render_author(post.author),
      tags: render_tags(post.tags),
      comment_count: length(post.comments || []),
      inserted_at: post.inserted_at,
      updated_at: post.updated_at
    }
  end

  defp render_author(%Ecto.Association.NotLoaded{}), do: nil
  defp render_author(nil), do: nil
  defp render_author(author) do
    %{
      id: author.id,
      name: author.name,
      email: author.email
    }
  end

  defp render_tags(%Ecto.Association.NotLoaded{}), do: []
  defp render_tags(nil), do: []
  defp render_tags(tags) when is_list(tags) do
    Enum.map(tags, fn tag ->
      %{id: tag.id, name: tag.name}
    end)
  end
end
