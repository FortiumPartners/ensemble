#!/usr/bin/env elixir

# ExUnit Test Generator
# Generates ExUnit test files from templates

defmodule ExUnitTestGenerator do
  def generate(opts) do
    source = Keyword.fetch!(opts, :source)
    output = Keyword.fetch!(opts, :output)
    module_name = Keyword.fetch!(opts, :module)
    description = Keyword.get(opts, :description, "basic functionality")
    async = Keyword.get(opts, :async, false)

    # Generate test content
    test_content = """
    defmodule #{module_name}Test do
      use ExUnit.Case#{if async, do: ", async: true", else: ""}

      describe "#{description}" do
        test "#{description}" do
          # Arrange

          # Act

          # Assert
          assert true, "Test not implemented"
        end
      end
    end
    """

    # Ensure output directory exists
    output_dir = Path.dirname(output)
    File.mkdir_p!(output_dir)

    # Write test file
    File.write!(output, test_content)

    # Return result as JSON
    result = %{
      success: true,
      testFile: output,
      testCount: 1,
      template: "unit-test",
      async: async
    }

    IO.puts(Jason.encode!(result, pretty: true))
  rescue
    e ->
      error = %{
        success: false,
        error: Exception.message(e)
      }
      IO.puts(Jason.encode!(error, pretty: true))
      System.halt(1)
  end

  def parse_args(args) do
    {opts, _, _} = OptionParser.parse(args,
      strict: [
        source: :string,
        output: :string,
        module: :string,
        description: :string,
        async: :boolean
      ]
    )
    opts
  end
end

# Simple JSON encoder if Jason is not available
defmodule SimpleJSON do
  def encode!(map) when is_map(map) do
    pairs = Enum.map(map, fn {k, v} -> ~s("#{k}": #{encode_value(v)}) end)
    "{" <> Enum.join(pairs, ", ") <> "}"
  end

  defp encode_value(v) when is_binary(v), do: ~s("#{v}")
  defp encode_value(v) when is_boolean(v), do: to_string(v)
  defp encode_value(v) when is_number(v), do: to_string(v)
  defp encode_value(v), do: inspect(v)
end

# Try to use Jason, fall back to SimpleJSON
defmodule Jason do
  def encode!(data, _opts \\ []) do
    try do
      :jason.encode!(data)
    rescue
      _ -> SimpleJSON.encode!(data)
    end
  end
end

# Run generator
opts = ExUnitTestGenerator.parse_args(System.argv())
ExUnitTestGenerator.generate(opts)
