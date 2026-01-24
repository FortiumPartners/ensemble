defmodule {{AppName}}Web.{{EntityName}}Controller do
  use {{AppName}}Web, :controller

  alias {{AppName}}.{{ContextName}}
  alias {{AppName}}.{{ContextName}}.{{EntityName}}

  action_fallback {{AppName}}Web.FallbackController

  @doc """
  List all {{entity-name-plural}}.

  ## Parameters
    - page: Page number (default: 1)
    - per_page: Items per page (default: 20)

  ## Examples

      GET /api/{{endpoint-path}}
      GET /api/{{endpoint-path}}?page=2&per_page=10

  """
  def index(conn, params) do
    page = String.to_integer(params["page"] || "1")
    per_page = String.to_integer(params["per_page"] || "20")

    {{entity-name-plural}} = {{ContextName}}.list_{{entity-name-plural}}_paginated(page, per_page)
    render(conn, :index, {{entity-name-plural}}: {{entity-name-plural}})
  end

  @doc """
  Create a new {{entity-name}}.

  ## Parameters
    - {{entity-name}}: {{EntityName}} attributes

  ## Examples

      POST /api/{{endpoint-path}}
      Body: {"{{entity-name}}": {"field": "value"}}

  """
  def create(conn, %{"{{entity-name}}" => {{entity-name}}_params}) do
    with {:ok, %{{EntityName}}{} = {{entity-name}}} <- {{ContextName}}.create_{{entity-name}}({{entity-name}}_params) do
      conn
      |> put_status(:created)
      |> put_resp_header("location", ~p"/api/{{endpoint-path}}/#{{{entity-name}}}")
      |> render(:show, {{entity-name}}: {{entity-name}})
    end
  end

  @doc """
  Get a single {{entity-name}} by ID.

  ## Parameters
    - id: {{EntityName}} ID

  ## Examples

      GET /api/{{endpoint-path}}/123

  """
  def show(conn, %{"id" => id}) do
    {{entity-name}} = {{ContextName}}.get_{{entity-name}}!(id)
    render(conn, :show, {{entity-name}}: {{entity-name}})
  end

  @doc """
  Update an existing {{entity-name}}.

  ## Parameters
    - id: {{EntityName}} ID
    - {{entity-name}}: Updated {{EntityName}} attributes

  ## Examples

      PUT /api/{{endpoint-path}}/123
      Body: {"{{entity-name}}": {"field": "new_value"}}

  """
  def update(conn, %{"id" => id, "{{entity-name}}" => {{entity-name}}_params}) do
    {{entity-name}} = {{ContextName}}.get_{{entity-name}}!(id)

    with {:ok, %{{EntityName}}{} = {{entity-name}}} <- {{ContextName}}.update_{{entity-name}}({{entity-name}}, {{entity-name}}_params) do
      render(conn, :show, {{entity-name}}: {{entity-name}})
    end
  end

  @doc """
  Delete a {{entity-name}}.

  ## Parameters
    - id: {{EntityName}} ID

  ## Examples

      DELETE /api/{{endpoint-path}}/123

  """
  def delete(conn, %{"id" => id}) do
    {{entity-name}} = {{ContextName}}.get_{{entity-name}}!(id)

    with {:ok, %{{EntityName}}{}} <- {{ContextName}}.delete_{{entity-name}}({{entity-name}}) do
      send_resp(conn, :no_content, "")
    end
  end
end
