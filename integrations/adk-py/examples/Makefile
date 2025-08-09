# Variables
PORT ?= 8888
UV := uv run

# Phony targets
.PHONY: dev help clean install test lint format check

# Default target
.DEFAULT_GOAL := help

# Development server
dev:
	$(UV) adk web --port $(PORT)

# Install dependencies
install:
	uv sync

# Run tests
test:
	$(UV) pytest

# Lint code
lint:
	$(UV) ruff check .

# Format code
format:
	$(UV) ruff format .

# Type check
check:
	$(UV) mypy .

# Clean up temporary files
clean:
	find . -type f -name "*.pyc" -delete
	find . -type d -name "__pycache__" -delete
	find . -type d -name "*.egg-info" -exec rm -rf {} +

# Show help
help:
	@echo "Available targets:"
	@echo "  dev      - Start development server (default port: $(PORT))"
	@echo "  install  - Install dependencies with uv"
	@echo "  test     - Run tests"
	@echo "  lint     - Run linter"
	@echo "  format   - Format code"
	@echo "  check    - Run type checker"
	@echo "  clean    - Clean up temporary files"
	@echo "  help     - Show this help message"
	@echo ""
	@echo "Variables:"
	@echo "  PORT     - Port for development server (default: $(PORT))"
	@echo ""
	@echo "Usage examples:"
	@echo "  make dev"
	@echo "  make dev PORT=3000"
