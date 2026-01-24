defmodule {{AppName}}Web.{{EntityName}}Live.Index do
  use {{AppName}}Web, :live_view

  alias {{AppName}}.{{ContextName}}
  alias {{AppName}}.{{ContextName}}.{{EntityName}}

  @impl true
  def mount(_params, _session, socket) do
    if connected?(socket) do
      # Subscribe to real-time updates
      Phoenix.PubSub.subscribe({{AppName}}.PubSub, "{{entity-name-plural}}")
    end

    {:ok,
     socket
     |> assign(:page_title, "{{entity-display-name-plural}}")
     |> stream(:{{entity-name-plural}}, {{ContextName}}.list_{{entity-name-plural}}())}
  end

  @impl true
  def handle_params(params, _url, socket) do
    {:noreply, apply_action(socket, socket.assigns.live_action, params)}
  end

  defp apply_action(socket, :edit, %{"id" => id}) do
    socket
    |> assign(:page_title, "Edit {{entity-display-name}}")
    |> assign(:{{entity-name}}, {{ContextName}}.get_{{entity-name}}!(id))
  end

  defp apply_action(socket, :new, _params) do
    socket
    |> assign(:page_title, "New {{entity-display-name}}")
    |> assign(:{{entity-name}}, %{{EntityName}}{})
  end

  defp apply_action(socket, :index, _params) do
    socket
    |> assign(:page_title, "{{entity-display-name-plural}}")
    |> assign(:{{entity-name}}, nil)
  end

  @impl true
  def handle_event("delete", %{"id" => id}, socket) do
    {{entity-name}} = {{ContextName}}.get_{{entity-name}}!(id)
    {:ok, _} = {{ContextName}}.delete_{{entity-name}}({{entity-name}})

    {:noreply, stream_delete(socket, :{{entity-name-plural}}, {{entity-name}})}
  end

  @impl true
  def handle_info({:{{entity-name}}_created, {{entity-name}}}, socket) do
    {:noreply, stream_insert(socket, :{{entity-name-plural}}, {{entity-name}}, at: 0)}
  end

  @impl true
  def handle_info({:{{entity-name}}_updated, {{entity-name}}}, socket) do
    {:noreply, stream_insert(socket, :{{entity-name-plural}}, {{entity-name}})}
  end

  @impl true
  def handle_info({:{{entity-name}}_deleted, {{entity-name}}}, socket) do
    {:noreply, stream_delete(socket, :{{entity-name-plural}}, {{entity-name}})}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <div>
      <.header>
        {{entity-display-name-plural}}
        <:actions>
          <.link patch={~p"/{{endpoint-path}}/new"}>
            <.button>New {{entity-display-name}}</.button>
          </.link>
        </:actions>
      </.header>

      <.table id="{{entity-name-plural}}" rows={@streams.{{entity-name-plural}}}>
        <:col :let={{_id, {{entity-name}}}} label="{{FieldLabel}}"><%= {{entity-name}}.{{field-name}} %></:col>
        <:action :let={{_id, {{entity-name}}}}>
          <.link patch={~p"/{{endpoint-path}}/#{{{entity-name}}}/edit"}>Edit</.link>
        </:action>
        <:action :let={{id, {{entity-name}}}}>
          <.link
            phx-click="delete"
            phx-value-id={{{entity-name}}.id}
            data-confirm="Are you sure?"
          >
            Delete
          </.link>
        </:action>
      </.table>
    </div>

    <.modal
      :if={@live_action in [:new, :edit]}
      id="{{entity-name}}-modal"
      show
      on_cancel={JS.patch(~p"/{{endpoint-path}}")}
    >
      <.live_component
        module={{{AppName}}Web.{{EntityName}}Live.FormComponent}
        id={@{{entity-name}}.id || :new}
        title={@page_title}
        action={@live_action}
        {{entity-name}}={@{{entity-name}}}
        patch={~p"/{{endpoint-path}}"}
      />
    </.modal>
    """
  end
end

defmodule {{AppName}}Web.{{EntityName}}Live.FormComponent do
  use {{AppName}}Web, :live_component

  alias {{AppName}}.{{ContextName}}

  @impl true
  def render(assigns) do
    ~H"""
    <div>
      <.header>
        <%= @title %>
        <:subtitle>Use this form to manage {{entity-name}} records.</:subtitle>
      </.header>

      <.simple_form
        for={@form}
        id="{{entity-name}}-form"
        phx-target={@myself}
        phx-change="validate"
        phx-submit="save"
      >
        <.input field={@form[:{{field-name}}]} type="text" label="{{FieldLabel}}" />
        <:actions>
          <.button phx-disable-with="Saving...">Save {{entity-display-name}}</.button>
        </:actions>
      </.simple_form>
    </div>
    """
  end

  @impl true
  def update(%{{{entity-name}}: {{entity-name}}} = assigns, socket) do
    changeset = {{ContextName}}.change_{{entity-name}}({{entity-name}})

    {:ok,
     socket
     |> assign(assigns)
     |> assign_form(changeset)}
  end

  @impl true
  def handle_event("validate", %{"{{entity-name}}" => {{entity-name}}_params}, socket) do
    changeset =
      socket.assigns.{{entity-name}}
      |> {{ContextName}}.change_{{entity-name}}({{entity-name}}_params)
      |> Map.put(:action, :validate)

    {:noreply, assign_form(socket, changeset)}
  end

  def handle_event("save", %{"{{entity-name}}" => {{entity-name}}_params}, socket) do
    save_{{entity-name}}(socket, socket.assigns.action, {{entity-name}}_params)
  end

  defp save_{{entity-name}}(socket, :edit, {{entity-name}}_params) do
    case {{ContextName}}.update_{{entity-name}}(socket.assigns.{{entity-name}}, {{entity-name}}_params) do
      {:ok, {{entity-name}}} ->
        notify_parent({:saved, {{entity-name}}})

        {:noreply,
         socket
         |> put_flash(:info, "{{entity-display-name}} updated successfully")
         |> push_patch(to: socket.assigns.patch)}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:noreply, assign_form(socket, changeset)}
    end
  end

  defp save_{{entity-name}}(socket, :new, {{entity-name}}_params) do
    case {{ContextName}}.create_{{entity-name}}({{entity-name}}_params) do
      {:ok, {{entity-name}}} ->
        notify_parent({:saved, {{entity-name}}})

        {:noreply,
         socket
         |> put_flash(:info, "{{entity-display-name}} created successfully")
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
