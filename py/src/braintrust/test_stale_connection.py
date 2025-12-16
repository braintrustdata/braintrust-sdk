"""Integration tests for fetch_base_experiment() stale connection handling using a real HTTP server."""

import http.server
import json
import socket
import socketserver
import threading
import time
from unittest import TestCase

import requests
from braintrust.logger import BraintrustState, Experiment, LazyValue, ObjectMetadata, ProjectExperimentMetadata


class StaleConnectionHandler(http.server.BaseHTTPRequestHandler):
    """HTTP handler that simulates NAT gateway timeout behavior."""

    timeout_seconds = 0.5
    keep_alive_sleep_seconds = 0.0
    connection_times = {}

    def log_message(self, format, *args):
        pass

    def do_POST(self):
        if self.path == "/api/base_experiment/get_id":
            client_key = f"{self.client_address[0]}:{self.client_address[1]}"
            current_time = time.time()

            if client_key not in self.connection_times:
                self.connection_times[client_key] = current_time
                # Sleep to keep connection alive (if configured)
                if self.keep_alive_sleep_seconds > 0:
                    time.sleep(self.keep_alive_sleep_seconds)
                self._send_success()
            else:
                idle_time = current_time - self.connection_times[client_key]
                if idle_time > self.timeout_seconds:
                    try:
                        self.connection.shutdown(socket.SHUT_RDWR)
                    except:
                        pass
                    self.connection.close()
                else:
                    self._send_success()
        else:
            self.send_response(404)
            self.end_headers()

    def _send_success(self):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"base_exp_id": "base-123", "base_exp_name": "base-exp"}).encode())

    def do_GET(self):
        if self.path.startswith("/config/set"):
            params = self.path.split("?")[1] if "?" in self.path else ""
            for param in params.split("&"):
                if "=" in param:
                    key, value = param.split("=", 1)
                    if key == "idle_timeout_seconds":
                        self.timeout_seconds = float(value)
                    elif key == "keep_alive_sleep_seconds":
                        self.keep_alive_sleep_seconds = float(value)
            self.send_response(200)
            self.end_headers()
        elif self.path == "/config/reset":
            self.connection_times.clear()
            self.send_response(200)
            self.end_headers()


class TestFetchBaseExperimentStaleConnection(TestCase):
    """Integration tests using a real HTTP server and real app_conn()."""

    @classmethod
    def setUpClass(cls):
        cls.server = socketserver.TCPServer(("", 0), StaleConnectionHandler)
        cls.server_url = f"http://localhost:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        StaleConnectionHandler.timeout_seconds = 0.5
        StaleConnectionHandler.keep_alive_sleep_seconds = 0.0
        StaleConnectionHandler.connection_times.clear()
        # Reset via HTTP to ensure clean state
        requests.get(f"{self.server_url}/config/reset", timeout=1)

    def _create_state(self):
        """Helper to create BraintrustState pointing to test server."""
        state = BraintrustState()
        state.app_url = self.server_url
        state.org_name = "test-org"
        return state

    def _create_experiment(self, state):
        """Helper to create Experiment instance."""
        project_metadata = ObjectMetadata(id="test-project", name="test-project", full_info={})
        exp_metadata = ObjectMetadata(id="test-exp", name="test-exp", full_info={})
        lazy_metadata = LazyValue(
            lambda: ProjectExperimentMetadata(project=project_metadata, experiment=exp_metadata),
            use_mutex=False,
        )
        experiment = Experiment(lazy_metadata=lazy_metadata, state=state)
        type(experiment).id = property(lambda self: "test-exp-id")
        return experiment

    def test_fetch_base_experiment_retries_after_stale_connection(self):
        """Test that fetch_base_experiment() retries and succeeds after stale connection."""
        requests.get(f"{self.server_url}/config/set?idle_timeout_seconds=0.5")

        state = self._create_state()
        experiment = self._create_experiment(state)
        conn = state.app_conn()

        # Establish connection (simulating experiment registration)
        resp = conn.post("/api/base_experiment/get_id", json={"id": "test-exp-id"})
        self.assertEqual(resp.status_code, 200)

        # Wait for timeout (simulating long eval run)
        time.sleep(1.0)

        # Should retry and succeed
        result = experiment.fetch_base_experiment()
        self.assertIsNotNone(result)
        self.assertEqual(result.id, "base-123")
        self.assertEqual(result.name, "base-exp")
