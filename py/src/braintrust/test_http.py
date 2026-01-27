"""Tests for HTTP connection handling, retries, and timeouts."""

import http.server
import os
import socketserver
import threading
import time

import pytest
import requests
from braintrust.logger import HTTPConnection, RetryRequestExceptionsAdapter


class HangingConnectionHandler(http.server.BaseHTTPRequestHandler):
    """HTTP handler that simulates stale connections by HANGING (not responding).

    This simulates what happens when a NAT gateway silently drops packets:
    - The TCP connection appears open
    - Packets are sent but never acknowledged
    - The client waits forever for a response
    """

    request_count = 0
    hang_count = 1

    def log_message(self, format, *args):
        pass

    def do_POST(self):
        HangingConnectionHandler.request_count += 1

        if HangingConnectionHandler.request_count <= HangingConnectionHandler.hang_count:
            # Simulate stale connection: hang long enough for client to timeout
            for _ in range(100):  # 10 seconds total, interruptible
                time.sleep(0.1)
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status": "ok"}')

    def do_GET(self):
        self.do_POST()


class CloseConnectionHandler(http.server.BaseHTTPRequestHandler):
    """HTTP handler that closes connection immediately (triggers ConnectionError)."""

    request_count = 0
    fail_count = 1

    def log_message(self, format, *args):
        pass

    def do_POST(self):
        CloseConnectionHandler.request_count += 1

        if CloseConnectionHandler.request_count <= CloseConnectionHandler.fail_count:
            self.connection.close()
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status": "ok"}')

    def do_GET(self):
        self.do_POST()


@pytest.fixture
def hanging_server():
    """Fixture that creates a server that HANGS on first request (simulates stale NAT)."""
    HangingConnectionHandler.request_count = 0
    HangingConnectionHandler.hang_count = 1

    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), HangingConnectionHandler)
    server.daemon_threads = True
    port = server.server_address[1]

    thread = threading.Thread(target=server.serve_forever)
    thread.daemon = True
    thread.start()

    yield f"http://127.0.0.1:{port}"

    server.shutdown()
    server.server_close()


@pytest.fixture
def closing_server():
    """Fixture that creates a server that CLOSES connection on first request."""
    CloseConnectionHandler.request_count = 0
    CloseConnectionHandler.fail_count = 1

    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), CloseConnectionHandler)
    server.daemon_threads = True
    port = server.server_address[1]

    thread = threading.Thread(target=server.serve_forever)
    thread.daemon = True
    thread.start()

    yield f"http://127.0.0.1:{port}"

    server.shutdown()
    server.server_close()


class TestRetryRequestExceptionsAdapter:
    """Tests for RetryRequestExceptionsAdapter timeout and retry behavior."""

    def test_adapter_has_default_timeout(self):
        """Adapter should have a default_timeout_secs attribute."""
        adapter = RetryRequestExceptionsAdapter(base_num_retries=3, backoff_factor=0.1)

        assert hasattr(adapter, "default_timeout_secs")
        assert adapter.default_timeout_secs == 60

    def test_adapter_applies_default_timeout_to_requests(self, hanging_server):
        """Requests without explicit timeout should use default_timeout_secs."""
        adapter = RetryRequestExceptionsAdapter(
            base_num_retries=3,
            backoff_factor=0.05,
            default_timeout_secs=0.2,
        )
        session = requests.Session()
        session.mount("http://", adapter)

        start = time.time()
        resp = session.post(f"{hanging_server}/test", json={"hello": "world"})
        elapsed = time.time() - start

        assert resp.status_code == 200
        assert elapsed < 2.0, f"Should complete within 2s, took {elapsed:.2f}s"
        assert HangingConnectionHandler.request_count >= 2

    def test_adapter_retries_on_connection_close(self, closing_server):
        """Adapter retries on connection close errors."""
        adapter = RetryRequestExceptionsAdapter(base_num_retries=5, backoff_factor=0.05)
        session = requests.Session()
        session.mount("http://", adapter)

        start = time.time()
        resp = session.post(f"{closing_server}/test", json={"hello": "world"})
        elapsed = time.time() - start

        assert resp.status_code == 200
        assert elapsed < 5.0
        assert CloseConnectionHandler.request_count >= 2

    def test_adapter_resets_pool_on_timeout(self, hanging_server):
        """Adapter resets connection pool on timeout errors via self.close().

        This is the key fix for stale NAT connections: when a request times out,
        we reset the connection pool to ensure the next retry uses a fresh connection.
        """
        adapter = RetryRequestExceptionsAdapter(
            base_num_retries=10,
            backoff_factor=0.05,
            default_timeout_secs=0.2,
        )
        session = requests.Session()
        session.mount("http://", adapter)

        start = time.time()
        resp = session.post(f"{hanging_server}/test", json={"hello": "world"})
        elapsed = time.time() - start

        assert resp.status_code == 200
        assert elapsed < 10.0, f"Request took too long: {elapsed:.2f}s"
        assert HangingConnectionHandler.request_count >= 2


class TestHTTPConnection:
    """Tests for HTTPConnection timeout configuration."""

    def test_make_long_lived_uses_default_timeout(self, hanging_server):
        """HTTPConnection.make_long_lived() should use default_timeout_secs.

        This tests the exact scenario from the stale connection bug:
        - Long eval run (15+ minutes)
        - app_conn() becomes stale due to NAT gateway idle timeout
        - summarize() calls fetch_base_experiment()
        - Request hangs forever because no timeout

        With the fix, make_long_lived() uses default_timeout_secs (60s by default).
        """
        os.environ["BRAINTRUST_HTTP_TIMEOUT"] = "0.2"
        try:
            conn = HTTPConnection(hanging_server)
            conn.make_long_lived()

            assert hasattr(conn.adapter, "default_timeout_secs")
            assert conn.adapter.default_timeout_secs == 0.2

            start = time.time()
            resp = conn.post("/test", json={"hello": "world"})
            elapsed = time.time() - start

            assert resp.status_code == 200
            # Allow more time due to backoff_factor=0.5 in make_long_lived()
            assert elapsed < 15.0, f"Should complete within 15s, took {elapsed:.2f}s"
        finally:
            del os.environ["BRAINTRUST_HTTP_TIMEOUT"]

    def test_env_var_configures_timeout(self):
        """BRAINTRUST_HTTP_TIMEOUT env var configures timeout via make_long_lived()."""
        os.environ["BRAINTRUST_HTTP_TIMEOUT"] = "30"
        try:
            conn = HTTPConnection("http://localhost:8080")
            conn.make_long_lived()

            assert hasattr(conn.adapter, "default_timeout_secs")
            assert conn.adapter.default_timeout_secs == 30
        finally:
            del os.environ["BRAINTRUST_HTTP_TIMEOUT"]


class TestAdapterCloseAndReuse:
    """Tests verifying that adapter.close() allows subsequent requests.

    This addresses the review concern about whether calling self.close()
    (which calls PoolManager.clear()) breaks subsequent request handling.
    """

    @pytest.fixture
    def simple_server(self):
        """Fixture that creates a server that always succeeds."""

        class SimpleHandler(http.server.BaseHTTPRequestHandler):
            request_count = 0

            def log_message(self, format, *args):
                pass

            def do_GET(self):
                SimpleHandler.request_count += 1
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status": "ok"}')

        SimpleHandler.request_count = 0
        server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), SimpleHandler)
        server.daemon_threads = True
        port = server.server_address[1]

        thread = threading.Thread(target=server.serve_forever)
        thread.daemon = True
        thread.start()

        yield f"http://127.0.0.1:{port}", SimpleHandler

        server.shutdown()
        server.server_close()

    def test_adapter_works_after_close(self, simple_server):
        """Verify adapter.close() does not break subsequent requests.

        This is the key test for the PR feedback: after calling close(),
        the PoolManager should create new connection pools on demand.
        """
        url, handler = simple_server

        adapter = RetryRequestExceptionsAdapter(base_num_retries=3, backoff_factor=0.1)
        session = requests.Session()
        session.mount("http://", adapter)

        # First request works
        resp1 = session.get(f"{url}/test1")
        assert resp1.status_code == 200
        assert handler.request_count == 1

        # Explicitly close the adapter (simulates what happens on timeout)
        adapter.close()

        # Second request should still work after close()
        resp2 = session.get(f"{url}/test2")
        assert resp2.status_code == 200
        assert handler.request_count == 2

    def test_adapter_works_after_multiple_closes(self, simple_server):
        """Verify adapter works even after multiple close() calls."""
        url, handler = simple_server

        adapter = RetryRequestExceptionsAdapter(base_num_retries=3, backoff_factor=0.1)
        session = requests.Session()
        session.mount("http://", adapter)

        for i in range(3):
            resp = session.get(f"{url}/test{i}")
            assert resp.status_code == 200
            adapter.close()

        assert handler.request_count == 3

    def test_concurrent_requests_with_close(self):
        """Test thread safety: close() called while requests are in-flight.

        This tests a potential race condition where one thread calls close()
        while another thread is mid-request. Requests are staggered to ensure
        close() happens while some requests are in-flight.
        """
        import concurrent.futures

        class SlowHandler(http.server.BaseHTTPRequestHandler):
            request_count = 0

            def log_message(self, format, *args):
                pass

            def do_GET(self):
                SlowHandler.request_count += 1
                # Simulate slow response
                time.sleep(0.1)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status": "ok"}')

        SlowHandler.request_count = 0
        server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), SlowHandler)
        server.daemon_threads = True
        port = server.server_address[1]
        url = f"http://127.0.0.1:{port}"

        server_thread = threading.Thread(target=server.serve_forever)
        server_thread.daemon = True
        server_thread.start()

        try:
            adapter = RetryRequestExceptionsAdapter(base_num_retries=3, backoff_factor=0.1)
            session = requests.Session()
            session.mount("http://", adapter)

            errors = []

            def make_request(i):
                try:
                    time.sleep(i * 0.02)  # Stagger requests
                    resp = session.get(f"{url}/test{i}")
                    return resp.status_code
                except Exception as e:
                    errors.append(e)
                    return None

            def close_adapter():
                time.sleep(0.05)  # Close while requests are in-flight
                adapter.close()

            # Launch concurrent requests and a close() call
            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                # Start several requests (staggered)
                request_futures = [executor.submit(make_request, i) for i in range(5)]
                # Start close() call mid-flight
                close_future = executor.submit(close_adapter)

                close_future.result()
                results = [f.result() for f in request_futures]

            # All requests should succeed (retry on failure)
            assert all(r == 200 for r in results), f"Some requests failed: {results}, errors: {errors}"

        finally:
            server.shutdown()
            server.server_close()

    def test_stress_concurrent_close_and_requests(self):
        """Stress test: many close() calls interleaved with requests.

        Requests are staggered to ensure close() calls happen during requests.
        """
        import concurrent.futures

        class FastHandler(http.server.BaseHTTPRequestHandler):
            request_count = 0

            def log_message(self, format, *args):
                pass

            def do_GET(self):
                FastHandler.request_count += 1
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status": "ok"}')

        FastHandler.request_count = 0
        server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), FastHandler)
        server.daemon_threads = True
        port = server.server_address[1]
        url = f"http://127.0.0.1:{port}"

        server_thread = threading.Thread(target=server.serve_forever)
        server_thread.daemon = True
        server_thread.start()

        try:
            adapter = RetryRequestExceptionsAdapter(base_num_retries=5, backoff_factor=0.01)
            session = requests.Session()
            session.mount("http://", adapter)

            errors = []
            success_count = 0
            lock = threading.Lock()

            def make_request(i):
                nonlocal success_count
                try:
                    time.sleep(i * 0.005)  # Stagger requests
                    resp = session.get(f"{url}/test{i}")
                    if resp.status_code == 200:
                        with lock:
                            success_count += 1
                    return resp.status_code
                except Exception as e:
                    with lock:
                        errors.append(str(e))
                    return None

            def close_repeatedly():
                for _ in range(20):
                    time.sleep(0.01)  # Close throughout the request window
                    adapter.close()

            # Launch many concurrent requests while repeatedly closing
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
                request_futures = [executor.submit(make_request, i) for i in range(50)]
                close_futures = [executor.submit(close_repeatedly) for _ in range(3)]

                # Wait for all
                for f in close_futures:
                    f.result()
                results = [f.result() for f in request_futures]

            failed = [r for r in results if r != 200]
            assert len(failed) == 0, f"Failed requests: {len(failed)}, errors: {errors[:5]}"

        finally:
            server.shutdown()
            server.server_close()
