#!/usr/bin/env elixir

# ExUnit Test Runner
# Executes ExUnit tests and returns structured results

defmodule ExUnitTestRunner do
  def run(opts) do
    file = Keyword.fetch!(opts, :file)
    format = Keyword.get(opts, :format, "json")

    # Build mix test command
    cmd_args = ["test", file]

    if format == "json" do
      cmd_args = cmd_args ++ ["--formatter", "ExUnit.CLIFormatter"]
    end

    # Execute mix test
    {output, exit_code} = System.cmd("mix", cmd_args,
      stderr_to_stdout: true,
      cd: find_mix_project()
    )

    # Parse output (simplified)
    result = parse_output(output, exit_code)

    IO.puts(Jason.encode!(result, pretty: true))

    if result.success do
      System.halt(0)
    else
      System.halt(1)
    end
  rescue
    e ->
      error = %{
        success: false,
        error: Exception.message(e)
      }
      IO.puts(Jason.encode!(error, pretty: true))
      System.halt(1)
  end

  defp find_mix_project do
    # Find mix.exs in current directory or parent directories
    current = File.cwd!()
    find_mix_project_recursive(current)
  end

  defp find_mix_project_recursive(dir) do
    mix_file = Path.join(dir, "mix.exs")
    if File.exists?(mix_file) do
      dir
    else
      parent = Path.dirname(dir)
      if parent == dir do
        File.cwd!()  # Return current dir if no mix.exs found
      else
        find_mix_project_recursive(parent)
      end
    end
  end

  defp parse_output(output, exit_code) do
    # Simple parsing - in production would parse ExUnit's actual output
    lines = String.split(output, "\n")

    # Look for test summary line: "X tests, Y failures"
    summary_line = Enum.find(lines, &String.contains?(&1, "test"))

    {passed, failed, total} = if summary_line do
      parse_summary(summary_line)
    else
      {0, 0, 0}
    end

    failures = extract_failures(lines)

    %{
      success: exit_code == 0 && failed == 0,
      passed: passed,
      failed: failed,
      total: total,
      duration: 0.0,  # Would extract from output
      failures: failures
    }
  end

  defp parse_summary(line) do
    # Parse "5 tests, 2 failures" format
    captures = Regex.run(~r/(\d+)\s+tests?,\s+(\d+)\s+failures?/, line)

    case captures do
      [_, total_str, failed_str] ->
        total = String.to_integer(total_str)
        failed = String.to_integer(failed_str)
        passed = total - failed
        {passed, failed, total}
      _ ->
        {0, 0, 0}
    end
  end

  defp extract_failures(lines) do
    # Extract failure information (simplified)
    lines
    |> Enum.filter(&String.contains?(&1, "test "))
    |> Enum.filter(&String.contains?(&1, "FAILED"))
    |> Enum.map(fn line ->
      %{
        test: String.trim(line),
        error: "Test failed",
        file: "unknown",
        line: nil
      }
    end)
  end

  def parse_args(args) do
    {opts, _, _} = OptionParser.parse(args,
      strict: [
        file: :string,
        format: :string,
        trace: :boolean
      ]
    )
    opts
  end
end

# Simple JSON encoder (same as generate-test.exs)
defmodule SimpleJSON do
  def encode!(map) when is_map(map) do
    pairs = Enum.map(map, fn {k, v} -> ~s("#{k}": #{encode_value(v)}) end)
    "{" <> Enum.join(pairs, ", ") <> "}"
  end

  def encode!(list) when is_list(list) do
    items = Enum.map(list, &encode_value/1)
    "[" <> Enum.join(items, ", ") <> "]"
  end

  defp encode_value(v) when is_map(v), do: encode!(v)
  defp encode_value(v) when is_list(v), do: encode!(v)
  defp encode_value(v) when is_binary(v), do: ~s("#{v}")
  defp encode_value(v) when is_boolean(v), do: to_string(v)
  defp encode_value(v) when is_number(v), do: to_string(v)
  defp encode_value(nil), do: "null"
  defp encode_value(v), do: inspect(v)
end

defmodule Jason do
  def encode!(data, _opts \\ []) do
    try do
      :jason.encode!(data)
    rescue
      _ -> SimpleJSON.encode!(data)
    end
  end
end

# Run test runner
opts = ExUnitTestRunner.parse_args(System.argv())
ExUnitTestRunner.run(opts)
