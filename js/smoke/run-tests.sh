#!/bin/bash
set -euo pipefail

# Simplified smoke test runner for Braintrust JS SDK
# Convention: Any directory in tests/ with a package.json is a test
# Run with: npm test

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHARED_DIR="$SCRIPT_DIR/shared"
TESTS_DIR="$SCRIPT_DIR/tests"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Track results
declare -a FAILED_TESTS
declare -a PASSED_TESTS

# Logging functions
log_info() {
    echo -e "${BLUE}ℹ${NC} $*"
}

log_success() {
    echo -e "${GREEN}✓${NC} $*"
}

log_error() {
    echo -e "${RED}✗${NC} $*"
}

log_header() {
    echo ""
    echo "============================================================"
    echo "$*"
    echo "============================================================"
}

# Show help
show_help() {
    cat << EOF
Braintrust JS SDK Smoke Test Runner

Usage:
  ./run-tests.sh              Run all tests
  ./run-tests.sh TEST_NAME    Run specific test(s)
  ./run-tests.sh --list       List all available tests
  ./run-tests.sh --help       Show this help

Convention:
  - Any directory in tests/ with package.json is a test
  - Test name = directory name
  - All tests run via: npm test

Examples:
  ./run-tests.sh                    # Run all tests
  ./run-tests.sh cloudflare-worker  # Run one test
  ./run-tests.sh span deno          # Run multiple tests

EOF
}

# Discover all tests
discover_tests() {
    local -a tests
    for dir in "$TESTS_DIR"/*/; do
        [ -d "$dir" ] || continue
        if [ -f "$dir/package.json" ]; then
            tests+=("$(basename "$dir")")
        fi
    done
    echo "${tests[@]}"
}

# List all tests
list_tests() {
    log_header "Available Smoke Tests"
    echo ""

    local tests=($(discover_tests))

    for test_name in "${tests[@]}"; do
        echo -e "${GREEN}●${NC} ${CYAN}$test_name${NC}"

        # Show description from package.json if available
        local pkg="$TESTS_DIR/$test_name/package.json"
        if [ -f "$pkg" ]; then
            local desc=$(jq -r '.description // ""' "$pkg" 2>/dev/null || echo "")
            if [ -n "$desc" ]; then
                echo "  $desc"
            fi
        fi
        echo ""
    done

    echo "Total: ${#tests[@]} tests"
    echo ""
    echo "Convention: Tests are auto-discovered from tests/*/"
    echo "Add a test: Create tests/my-test/ with package.json"
}

# Build shared package
build_shared_package() {
    log_header "Building Shared Test Package"
    echo ""

    cd "$SHARED_DIR"

    # Check if already built (e.g., in CI)
    if [ -f "dist/index.js" ] && [ -f "dist/index.mjs" ]; then
        log_info "Shared package already built, skipping build"
        log_success "Using existing shared package"
        echo ""
        return
    fi

    # Install dependencies if needed
    if [ ! -d "node_modules" ] || [ "package-lock.json" -nt "node_modules/.package-lock.json" ]; then
        log_info "Installing shared package dependencies..."
        npm ci
        touch node_modules/.package-lock.json
    else
        log_info "Dependencies up to date"
    fi

    # Build
    log_info "Building shared package..."
    npm run build

    # Verify
    if [ ! -f "dist/index.js" ] || [ ! -f "dist/index.mjs" ]; then
        log_error "Shared package build failed"
        exit 1
    fi

    log_success "Shared package built"
    echo ""
}

# Run a single test
run_test() {
    local test_name=$1
    local test_dir="$TESTS_DIR/$test_name"

    if [ ! -d "$test_dir" ]; then
        log_error "Test directory not found: $test_name"
        FAILED_TESTS+=("$test_name (not found)")
        return 1
    fi

    if [ ! -f "$test_dir/package.json" ]; then
        log_error "No package.json found: $test_name"
        FAILED_TESTS+=("$test_name (no package.json)")
        return 1
    fi

    cd "$test_dir"

    log_info "Running: npm test"

    # Run test and capture output
    local test_output
    local test_exit_code

    if test_output=$(npm test 2>&1); then
        test_exit_code=0
    else
        test_exit_code=$?
    fi

    if [ $test_exit_code -eq 0 ]; then
        log_success "$test_name passed"
        PASSED_TESTS+=("$test_name")
        return 0
    else
        log_error "$test_name failed"
        echo ""
        echo "Output (last 30 lines):"
        echo "----------------------------------------"
        echo "$test_output" | tail -n 30
        echo "----------------------------------------"
        FAILED_TESTS+=("$test_name")
        return 1
    fi
}

# Run tests
run_tests() {
    local filter_tests=("$@")
    local all_tests=($(discover_tests))

    if [ ${#all_tests[@]} -eq 0 ]; then
        log_error "No tests found in $TESTS_DIR"
        exit 1
    fi

    # Determine which tests to run
    local -a tests_to_run

    if [ ${#filter_tests[@]} -eq 0 ]; then
        # Run all tests
        tests_to_run=("${all_tests[@]}")
    else
        # Run filtered tests
        for filter in "${filter_tests[@]}"; do
            local found=false
            for test in "${all_tests[@]}"; do
                if [ "$test" = "$filter" ]; then
                    tests_to_run+=("$test")
                    found=true
                    break
                fi
            done
            if [ "$found" = false ]; then
                log_error "Unknown test: $filter"
                log_info "Use --list to see available tests"
                exit 1
            fi
        done
    fi

    log_header "Running ${#tests_to_run[@]} Test(s)"
    echo ""

    local test_num=1
    for test_name in "${tests_to_run[@]}"; do
        echo "Test $test_num/${#tests_to_run[@]}: $test_name"
        echo "------------------------------------------------------------"

        run_test "$test_name"

        echo ""
        ((test_num++))
    done
}

# Print summary
print_summary() {
    log_header "Summary"
    echo ""

    local total=$((${#PASSED_TESTS[@]} + ${#FAILED_TESTS[@]}))

    echo "Total:  $total tests"
    echo -e "Passed: ${GREEN}${#PASSED_TESTS[@]}${NC}"
    echo -e "Failed: ${RED}${#FAILED_TESTS[@]}${NC}"
    echo ""

    if [ ${#PASSED_TESTS[@]} -gt 0 ]; then
        echo -e "${GREEN}Passed:${NC}"
        for test in "${PASSED_TESTS[@]}"; do
            echo "  ✓ $test"
        done
        echo ""
    fi

    if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
        echo -e "${RED}Failed:${NC}"
        for test in "${FAILED_TESTS[@]}"; do
            echo "  ✗ $test"
        done
        echo ""
        return 1
    fi

    echo -e "${GREEN}✅ All tests passed!${NC}"
    return 0
}

# Main
main() {
    # Check for jq (optional, for listing descriptions)
    if ! command -v jq &> /dev/null; then
        # jq not required, just won't show descriptions
        :
    fi

    # Parse arguments
    case "${1:-}" in
        --list)
            list_tests
            exit 0
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
    esac

    log_header "Braintrust JS SDK Smoke Tests"
    echo ""

    # Build shared package
    build_shared_package

    # Run tests
    run_tests "$@"

    # Print summary
    if print_summary; then
        exit 0
    else
        exit 1
    fi
}

main "$@"
