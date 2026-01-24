#!/usr/bin/env python3
"""pytest Test Runner"""
import json
import sys
import subprocess

def run_test(file_path, config=None):
    """Run pytest tests and return structured results"""
    
    cmd = ["pytest", file_path, "--json-report", "--json-report-file=-"]
    if config:
        cmd.extend(["-c", config])
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        # Parse pytest output (simplified)
        return {
            "success": result.returncode == 0,
            "passed": 0,  # Would parse from output
            "failed": 0,
            "total": 0,
            "duration": 0,
            "failures": []
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    args = {arg.split("=")[0].replace("--", ""): arg.split("=")[1] 
            for arg in sys.argv[1:] if "=" in arg}
    
    result = run_test(args.get("file"), args.get("config"))
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["success"] else 1)
