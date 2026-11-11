#!/usr/bin/env python3
"""pytest Test Runner"""
import json
import os
import sys
import subprocess
import tempfile

def run_test(file_path, config=None):
    """Run pytest tests via the pytest-json-report plugin and return a normalized
    {success, passed, failed, total, duration, failures[]} result built from its real JSON
    report.

    The plugin's `--json-report-file` option takes a literal filesystem path (confirmed
    against pytest-json-report 1.5.0's own source, `plugin.py#save_report`): it has no
    "write to stdout" convention for `-` (unlike many other CLIs), so a temp file is used and
    read back afterwards -- the previous `--json-report-file=-` invocation here produced a
    plain "report saved to: -" console line and a file literally named `-`, never JSON on
    stdout, which is why this function previously had nothing to parse.
    """
    if not file_path:
        return {"success": False, "error": "--file is required"}

    report_fd, report_path = tempfile.mkstemp(prefix="pytest-json-report-", suffix=".json")
    os.close(report_fd)

    try:
        cmd = ["pytest", file_path, "--json-report", f"--json-report-file={report_path}"]
        if config:
            cmd.extend(["-c", config])

        try:
            result = subprocess.run(cmd, capture_output=True, text=True)
        except OSError as e:
            return {"success": False, "error": f"Could not run pytest: {e}"}

        try:
            with open(report_path, "r") as f:
                report = json.load(f)
        except (OSError, json.JSONDecodeError):
            output = (result.stderr or result.stdout or "")[-2000:]
            return {
                "success": False,
                "error": "pytest did not produce a JSON report",
                "output": output
            }

        summary = report.get("summary", {})
        tests = report.get("tests", [])

        failures = []
        for test in tests:
            outcome = test.get("outcome")
            if outcome == "passed":
                continue
            call = test.get("call") or {}
            crash = call.get("crash") or {}
            message = crash.get("message") or call.get("longrepr")
            failures.append({
                "nodeid": test.get("nodeid"),
                "outcome": outcome,
                "error": message
            })

        passed = summary.get("passed", 0)
        failed = summary.get("failed", 0)
        total = summary.get("total", 0)

        return {
            "success": result.returncode == 0 and failed == 0,
            "passed": passed,
            "failed": failed,
            "total": total,
            "duration": report.get("duration", 0),
            "failures": failures
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        try:
            os.remove(report_path)
        except OSError:
            pass

if __name__ == "__main__":
    args = {arg.split("=")[0].replace("--", ""): arg.split("=")[1] 
            for arg in sys.argv[1:] if "=" in arg}
    
    result = run_test(args.get("file"), args.get("config"))
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["success"] else 1)
