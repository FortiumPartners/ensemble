#!/usr/bin/env python3
"""{{description}}

Usage:
    {{cli_name}} [OPTIONS] COMMAND [ARGS]...

Examples:
    {{cli_name}} --help
    {{cli_name}} run --config config.yaml
    {{cli_name}} version
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Sequence

__version__ = "1.0.0"

logger = logging.getLogger("{{cli_name}}")


def setup_logging(verbose: bool = False, debug: bool = False) -> None:
    """Configure logging based on verbosity.

    Args:
        verbose: Enable verbose (INFO) logging.
        debug: Enable debug (DEBUG) logging.
    """
    if debug:
        level = logging.DEBUG
        fmt = "%(asctime)s %(name)s [%(levelname)s] %(message)s"
    elif verbose:
        level = logging.INFO
        fmt = "%(levelname)s: %(message)s"
    else:
        level = logging.WARNING
        fmt = "%(levelname)s: %(message)s"

    logging.basicConfig(level=level, format=fmt)


def create_parser() -> argparse.ArgumentParser:
    """Create the argument parser.

    Returns:
        Configured ArgumentParser instance.
    """
    parser = argparse.ArgumentParser(
        prog="{{cli_name}}",
        description="{{description}}",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s run --config config.yaml
  %(prog)s process input.txt -o output.txt
  %(prog)s version
        """,
    )

    # Global options
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable verbose output",
    )
    parser.add_argument(
        "-d",
        "--debug",
        action="store_true",
        help="Enable debug output",
    )
    parser.add_argument(
        "-c",
        "--config",
        type=Path,
        help="Path to configuration file",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )

    # Subcommands
    subparsers = parser.add_subparsers(
        title="commands",
        dest="command",
        help="Available commands",
    )

    # Run command
    run_parser = subparsers.add_parser(
        "run",
        help="Run the main process",
    )
    run_parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host to bind to (default: 127.0.0.1)",
    )
    run_parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port to bind to (default: 8000)",
    )

    # Process command
    process_parser = subparsers.add_parser(
        "process",
        help="Process input files",
    )
    process_parser.add_argument(
        "input",
        type=Path,
        help="Input file path",
    )
    process_parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Output file path (default: stdout)",
    )
    process_parser.add_argument(
        "--format",
        choices=["json", "yaml", "text"],
        default="text",
        help="Output format (default: text)",
    )

    # Version command (alternative to --version)
    subparsers.add_parser(
        "version",
        help="Show version information",
    )

    return parser


def cmd_run(args: argparse.Namespace) -> int:
    """Execute the run command.

    Args:
        args: Parsed command-line arguments.

    Returns:
        Exit code (0 for success, non-zero for error).
    """
    logger.info("Starting server on %s:%d", args.host, args.port)

    try:
        # Main run logic here
        logger.info("Server running. Press Ctrl+C to stop.")
        # Example: start server, run main loop, etc.
        return 0
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        return 0
    except Exception as e:
        logger.exception("Server error: %s", e)
        return 1


def cmd_process(args: argparse.Namespace) -> int:
    """Execute the process command.

    Args:
        args: Parsed command-line arguments.

    Returns:
        Exit code (0 for success, non-zero for error).
    """
    logger.info("Processing %s", args.input)

    if not args.input.exists():
        logger.error("Input file not found: %s", args.input)
        return 1

    try:
        # Read input
        content = args.input.read_text()
        logger.debug("Read %d characters", len(content))

        # Process content
        result = content.upper()  # Example processing

        # Write output
        if args.output:
            args.output.write_text(result)
            logger.info("Wrote output to %s", args.output)
        else:
            print(result)

        return 0
    except Exception as e:
        logger.exception("Processing error: %s", e)
        return 1


def cmd_version(args: argparse.Namespace) -> int:
    """Execute the version command.

    Args:
        args: Parsed command-line arguments.

    Returns:
        Exit code (0 for success).
    """
    print(f"{{cli_name}} version {__version__}")
    print(f"Python {sys.version}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    """Main entry point.

    Args:
        argv: Command-line arguments (defaults to sys.argv[1:]).

    Returns:
        Exit code (0 for success, non-zero for error).
    """
    parser = create_parser()
    args = parser.parse_args(argv)

    # Setup logging
    setup_logging(verbose=args.verbose, debug=args.debug)

    # Load config if provided
    if args.config:
        if not args.config.exists():
            logger.error("Config file not found: %s", args.config)
            return 1
        logger.debug("Loading config from %s", args.config)
        # Load and apply config here

    # Dispatch to command handler
    if args.command == "run":
        return cmd_run(args)
    elif args.command == "process":
        return cmd_process(args)
    elif args.command == "version":
        return cmd_version(args)
    else:
        parser.print_help()
        return 0


if __name__ == "__main__":
    sys.exit(main())
