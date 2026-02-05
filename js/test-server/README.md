# Mock Braintrust API Server

A lightweight HTTP server that mocks Braintrust API endpoints for CI testing.

## Purpose

This mock server allows SDK tests to:

- Make realistic API calls without hitting production
- Test full SDK behavior including logging and API interactions
- Validate that the SDK properly handles API responses
- Ensure zero risk of production data contamination

## Usage

### Starting the Server

```bash
node mock-braintrust-api.js
```

The server will start on `http://localhost:8001` by default.

### Environment Variables

- `PORT`: Server port (default: 8001)
- `HOST`: Server host (default: 0.0.0.0)

### In CI

The GitHub Actions workflows automatically start this server before running tests:

```yaml
- name: Start mock API server
  working-directory: js/test-server
  shell: bash
  run: |
    node mock-braintrust-api.js &
    echo $! > mock-server.pid
    # Wait for server to be ready
    for i in {1..30}; do
      if curl -s http://localhost:8001/version > /dev/null; then
        echo "Mock server is ready"
        break
      fi
      sleep 1
    done
```

## Supported Endpoints

The mock server responds to all Braintrust API endpoints with successful mock responses:

- `/api/apikey/login` - Authentication
- `/api/project/register` - Project registration
- `/api/experiment/register` - Experiment registration
- `/api/dataset/register` - Dataset registration
- `/logs3` - Main logging endpoint
- `/logs3/overflow` - Overflow data handling
- `/version` - Version info
- `/attachment` - Attachment handling

All other endpoints return a generic success response.

## Design

- **Lightweight**: Simple Node.js HTTP server with no dependencies
- **Permissive**: Accepts all requests and returns success responses
- **Fast**: Minimal overhead for test execution
- **Portable**: Works on all CI environments (Linux, Windows, macOS)
