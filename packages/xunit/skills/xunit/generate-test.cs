// xUnit Test Generator
// Writes a C# xUnit test-class scaffold with one [Fact] and prints a JSON summary.
//
// Requires the .NET 10 SDK or newer (file-based apps):
//   dotnet run generate-test.cs -- --source=Calculator.cs --output=CalculatorTests.cs --description="Division by zero"
//
// Options (both --name=value and --name value are accepted):
//   --source       Source file under test (required; its file name gives the class name)
//   --output       Test file to write (required)
//   --description  Bug description / test purpose (default: "basic test")
//   --namespace    Namespace for the generated class (default: Tests)
//
// The generated [Fact] fails until its body is replaced with a real Arrange/Act/Assert,
// so a scaffold is never mistaken for a passing reproduction.
using System.Text.Json;
using System.Text.RegularExpressions;

var options = ParseOptions(args);

if (!options.TryGetValue("source", out var source) || string.IsNullOrWhiteSpace(source) ||
    !options.TryGetValue("output", out var output) || string.IsNullOrWhiteSpace(output))
{
    Console.WriteLine(ToJson(w =>
    {
        w.WriteBoolean("success", false);
        w.WriteString("error", "--source and --output are required");
    }));
    return 1;
}

var description = options.GetValueOrDefault("description", "basic test");
var ns = options.GetValueOrDefault("namespace", "Tests");
var className = ToIdentifier(Path.GetFileNameWithoutExtension(source));
var methodName = ToIdentifier(description);
var message = description.Replace("\\", "\\\\").Replace("\"", "\\\"").ReplaceLineEndings(" ");

var template = $$"""
using Xunit;

namespace {{ns}};

public class {{className}}Tests
{
    [Fact]
    public void {{methodName}}()
    {
        // Arrange

        // Act

        // Assert
        Assert.Fail("Replace with an assertion that reproduces: {{message}}");
    }
}

""";

var directory = Path.GetDirectoryName(Path.GetFullPath(output));
if (!string.IsNullOrEmpty(directory))
{
    Directory.CreateDirectory(directory);
}
File.WriteAllText(output, template);

Console.WriteLine(ToJson(w =>
{
    w.WriteBoolean("success", true);
    w.WriteString("testFile", output);
    w.WriteNumber("testCount", 1);
    w.WriteString("template", "unit-test");
}));
return 0;

// File-based apps disable reflection-based System.Text.Json, so write the object by hand.
static string ToJson(Action<Utf8JsonWriter> body)
{
    using var stream = new MemoryStream();
    using (var writer = new Utf8JsonWriter(stream))
    {
        writer.WriteStartObject();
        body(writer);
        writer.WriteEndObject();
    }
    return System.Text.Encoding.UTF8.GetString(stream.ToArray());
}

static Dictionary<string, string> ParseOptions(string[] argv)
{
    var result = new Dictionary<string, string>();
    for (var i = 0; i < argv.Length; i++)
    {
        if (!argv[i].StartsWith("--")) continue;
        var arg = argv[i][2..];
        var eq = arg.IndexOf('=');
        if (eq >= 0)
        {
            result[arg[..eq]] = arg[(eq + 1)..];
        }
        else if (i + 1 < argv.Length && !argv[i + 1].StartsWith("--"))
        {
            result[arg] = argv[++i];
        }
    }
    return result;
}

// Turn free text into a valid C# identifier: "Division by zero!" -> "Division_by_zero".
static string ToIdentifier(string text)
{
    var id = Regex.Replace(text.Trim(), "[^A-Za-z0-9_]+", "_").Trim('_');
    if (id.Length == 0) id = "Generated";
    return char.IsDigit(id[0]) ? "_" + id : id;
}
