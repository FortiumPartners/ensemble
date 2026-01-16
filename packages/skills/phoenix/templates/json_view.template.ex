defmodule {{AppName}}Web.{{EntityName}}JSON do
  alias {{AppName}}.{{ContextName}}.{{EntityName}}

  @doc """
  Renders a list of {{entity-name-plural}}.
  """
  def index(%{{{entity-name-plural}}: {{entity-name-plural}}}) do
    %{data: for({{entity-name}} <- {{entity-name-plural}}, do: data({{entity-name}}))}
  end

  @doc """
  Renders a single {{entity-name}}.
  """
  def show(%{{{entity-name}}: {{entity-name}}}) do
    %{data: data({{entity-name}})}
  end

  defp data(%{{EntityName}}{} = {{entity-name}}) do
    %{
      id: {{entity-name}}.id,
      {{field-name}}: {{entity-name}}.{{field-name}},
      # Add more fields
      # name: {{entity-name}}.name,
      # email: {{entity-name}}.email,
      # active: {{entity-name}}.active,

      # Associations (if preloaded)
      # author: render_author({{entity-name}}.author),
      # tags: render_tags({{entity-name}}.tags),

      inserted_at: {{entity-name}}.inserted_at,
      updated_at: {{entity-name}}.updated_at
    }
  end

  # defp render_author(nil), do: nil
  # defp render_author(author) do
  #   %{
  #     id: author.id,
  #     name: author.name
  #   }
  # end

  # defp render_tags(tags) when is_list(tags) do
  #   Enum.map(tags, fn tag ->
  #     %{id: tag.id, name: tag.name}
  #   end)
  # end
  # defp render_tags(_), do: []
end
