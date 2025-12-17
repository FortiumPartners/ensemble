defmodule {{AppName}}.{{ContextName}}Test do
  use {{AppName}}.DataCase

  alias {{AppName}}.{{ContextName}}

  describe "{{entity-name-plural}}" do
    alias {{AppName}}.{{ContextName}}.{{EntityName}}

    import {{AppName}}.{{ContextName}}Fixtures

    @invalid_attrs %{{{field-name}}: nil}

    test "list_{{entity-name-plural}}/0 returns all {{entity-name-plural}}" do
      {{entity-name}} = {{entity-name}}_fixture()
      assert {{ContextName}}.list_{{entity-name-plural}}() == [{{entity-name}}]
    end

    test "list_{{entity-name-plural}}_paginated/2 returns paginated {{entity-name-plural}}" do
      {{entity-name}}_1 = {{entity-name}}_fixture()
      {{entity-name}}_2 = {{entity-name}}_fixture()
      {{entity-name}}_3 = {{entity-name}}_fixture()

      page_1 = {{ContextName}}.list_{{entity-name-plural}}_paginated(1, 2)
      assert length(page_1) == 2

      page_2 = {{ContextName}}.list_{{entity-name-plural}}_paginated(2, 2)
      assert length(page_2) == 1
    end

    test "get_{{entity-name}}!/1 returns the {{entity-name}} with given id" do
      {{entity-name}} = {{entity-name}}_fixture()
      assert {{ContextName}}.get_{{entity-name}}!({{entity-name}}.id) == {{entity-name}}
    end

    test "get_{{entity-name}}/1 returns the {{entity-name}} with given id" do
      {{entity-name}} = {{entity-name}}_fixture()
      assert {{ContextName}}.get_{{entity-name}}({{entity-name}}.id) == {{entity-name}}
    end

    test "get_{{entity-name}}/1 returns nil for non-existent id" do
      assert {{ContextName}}.get_{{entity-name}}(99999) == nil
    end

    test "create_{{entity-name}}/1 with valid data creates a {{entity-name}}" do
      valid_attrs = %{{{field-name}}: "some {{field-name}}"}

      assert {:ok, %{{EntityName}}{} = {{entity-name}}} = {{ContextName}}.create_{{entity-name}}(valid_attrs)
      assert {{entity-name}}.{{field-name}} == "some {{field-name}}"
    end

    test "create_{{entity-name}}/1 with invalid data returns error changeset" do
      assert {:error, %Ecto.Changeset{}} = {{ContextName}}.create_{{entity-name}}(@invalid_attrs)
    end

    test "update_{{entity-name}}/2 with valid data updates the {{entity-name}}" do
      {{entity-name}} = {{entity-name}}_fixture()
      update_attrs = %{{{field-name}}: "updated {{field-name}}"}

      assert {:ok, %{{EntityName}}{} = {{entity-name}}} = {{ContextName}}.update_{{entity-name}}({{entity-name}}, update_attrs)
      assert {{entity-name}}.{{field-name}} == "updated {{field-name}}"
    end

    test "update_{{entity-name}}/2 with invalid data returns error changeset" do
      {{entity-name}} = {{entity-name}}_fixture()
      assert {:error, %Ecto.Changeset{}} = {{ContextName}}.update_{{entity-name}}({{entity-name}}, @invalid_attrs)
      assert {{entity-name}} == {{ContextName}}.get_{{entity-name}}!({{entity-name}}.id)
    end

    test "delete_{{entity-name}}/1 deletes the {{entity-name}}" do
      {{entity-name}} = {{entity-name}}_fixture()
      assert {:ok, %{{EntityName}}{}} = {{ContextName}}.delete_{{entity-name}}({{entity-name}})
      assert_raise Ecto.NoResultsError, fn -> {{ContextName}}.get_{{entity-name}}!({{entity-name}}.id) end
    end

    test "change_{{entity-name}}/1 returns a {{entity-name}} changeset" do
      {{entity-name}} = {{entity-name}}_fixture()
      assert %Ecto.Changeset{} = {{ContextName}}.change_{{entity-name}}({{entity-name}})
    end
  end
end

defmodule {{AppName}}Web.{{EntityName}}ControllerTest do
  use {{AppName}}Web.ConnCase

  import {{AppName}}.{{ContextName}}Fixtures

  alias {{AppName}}.{{ContextName}}.{{EntityName}}

  @create_attrs %{
    {{field-name}}: "some {{field-name}}"
  }
  @update_attrs %{
    {{field-name}}: "updated {{field-name}}"
  }
  @invalid_attrs %{{{field-name}}: nil}

  setup %{conn: conn} do
    {:ok, conn: put_req_header(conn, "accept", "application/json")}
  end

  describe "index" do
    test "lists all {{entity-name-plural}}", %{conn: conn} do
      conn = get(conn, ~p"/api/{{endpoint-path}}")
      assert json_response(conn, 200)["data"] == []
    end
  end

  describe "create {{entity-name}}" do
    test "renders {{entity-name}} when data is valid", %{conn: conn} do
      conn = post(conn, ~p"/api/{{endpoint-path}}", {{entity-name}}: @create_attrs)
      assert %{"id" => id} = json_response(conn, 201)["data"]

      conn = get(conn, ~p"/api/{{endpoint-path}}/#{id}")

      assert %{
               "id" => ^id,
               "{{field-name}}" => "some {{field-name}}"
             } = json_response(conn, 200)["data"]
    end

    test "renders errors when data is invalid", %{conn: conn} do
      conn = post(conn, ~p"/api/{{endpoint-path}}", {{entity-name}}: @invalid_attrs)
      assert json_response(conn, 422)["errors"] != %{}
    end
  end

  describe "update {{entity-name}}" do
    setup [:create_{{entity-name}}]

    test "renders {{entity-name}} when data is valid", %{conn: conn, {{entity-name}}: %{{EntityName}}{id: id} = {{entity-name}}} do
      conn = put(conn, ~p"/api/{{endpoint-path}}/#{{{entity-name}}}", {{entity-name}}: @update_attrs)
      assert %{"id" => ^id} = json_response(conn, 200)["data"]

      conn = get(conn, ~p"/api/{{endpoint-path}}/#{id}")

      assert %{
               "id" => ^id,
               "{{field-name}}" => "updated {{field-name}}"
             } = json_response(conn, 200)["data"]
    end

    test "renders errors when data is invalid", %{conn: conn, {{entity-name}}: {{entity-name}}} do
      conn = put(conn, ~p"/api/{{endpoint-path}}/#{{{entity-name}}}", {{entity-name}}: @invalid_attrs)
      assert json_response(conn, 422)["errors"] != %{}
    end
  end

  describe "delete {{entity-name}}" do
    setup [:create_{{entity-name}}]

    test "deletes chosen {{entity-name}}", %{conn: conn, {{entity-name}}: {{entity-name}}} do
      conn = delete(conn, ~p"/api/{{endpoint-path}}/#{{{entity-name}}}")
      assert response(conn, 204)

      assert_error_sent 404, fn ->
        get(conn, ~p"/api/{{endpoint-path}}/#{{{entity-name}}}")
      end
    end
  end

  defp create_{{entity-name}}(_) do
    {{entity-name}} = {{entity-name}}_fixture()
    %{{{entity-name}}: {{entity-name}}}
  end
end

defmodule {{AppName}}Web.{{EntityName}}LiveTest do
  use {{AppName}}Web.ConnCase

  import Phoenix.LiveViewTest
  import {{AppName}}.{{ContextName}}Fixtures

  @create_attrs %{{{field-name}}: "some {{field-name}}"}
  @update_attrs %{{{field-name}}: "updated {{field-name}}"}
  @invalid_attrs %{{{field-name}}: nil}

  defp create_{{entity-name}}(_) do
    {{entity-name}} = {{entity-name}}_fixture()
    %{{{entity-name}}: {{entity-name}}}
  end

  describe "Index" do
    setup [:create_{{entity-name}}]

    test "lists all {{entity-name-plural}}", %{conn: conn, {{entity-name}}: {{entity-name}}} do
      {:ok, _index_live, html} = live(conn, ~p"/{{endpoint-path}}")

      assert html =~ "{{entity-display-name-plural}}"
      assert html =~ {{entity-name}}.{{field-name}}
    end

    test "saves new {{entity-name}}", %{conn: conn} do
      {:ok, index_live, _html} = live(conn, ~p"/{{endpoint-path}}")

      assert index_live |> element("a", "New {{entity-display-name}}") |> render_click() =~
               "New {{entity-display-name}}"

      assert_patch(index_live, ~p"/{{endpoint-path}}/new")

      assert index_live
             |> form("#{{entity-name}}-form", {{entity-name}}: @invalid_attrs)
             |> render_change() =~ "can&#39;t be blank"

      assert index_live
             |> form("#{{entity-name}}-form", {{entity-name}}: @create_attrs)
             |> render_submit()

      assert_patch(index_live, ~p"/{{endpoint-path}}")

      html = render(index_live)
      assert html =~ "{{entity-display-name}} created successfully"
      assert html =~ "some {{field-name}}"
    end

    test "updates {{entity-name}} in listing", %{conn: conn, {{entity-name}}: {{entity-name}}} do
      {:ok, index_live, _html} = live(conn, ~p"/{{endpoint-path}}")

      assert index_live |> element("#{{entity-name-plural}}-#{{{entity-name}}.id} a", "Edit") |> render_click() =~
               "Edit {{entity-display-name}}"

      assert_patch(index_live, ~p"/{{endpoint-path}}/#{{{entity-name}}}/edit")

      assert index_live
             |> form("#{{entity-name}}-form", {{entity-name}}: @invalid_attrs)
             |> render_change() =~ "can&#39;t be blank"

      assert index_live
             |> form("#{{entity-name}}-form", {{entity-name}}: @update_attrs)
             |> render_submit()

      assert_patch(index_live, ~p"/{{endpoint-path}}")

      html = render(index_live)
      assert html =~ "{{entity-display-name}} updated successfully"
      assert html =~ "updated {{field-name}}"
    end

    test "deletes {{entity-name}} in listing", %{conn: conn, {{entity-name}}: {{entity-name}}} do
      {:ok, index_live, _html} = live(conn, ~p"/{{endpoint-path}}")

      assert index_live |> element("#{{entity-name-plural}}-#{{{entity-name}}.id} a", "Delete") |> render_click()
      refute has_element?(index_live, "#{{entity-name-plural}}-#{{{entity-name}}.id}")
    end
  end
end
