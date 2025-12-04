"""
Nox scripts the environment our tests run in and it used to verify our library
works with and without different dependencies. A few commands to check out:

    nox                        Run all sessions.
    nox -l                     List all sessions.
    nox -s <session>           Run a specific session.
    nox ... -- --no-vcr        Run tests without vcrpy.
    nox ... -- --wheel         Run tests against the wheel in dist.
    nox -h                     Get help.
"""

import glob
import os
import sys
import tempfile

import nox

# much faster than pip
nox.options.default_venv_backend = "uv"

SRC_DIR = "braintrust"
WRAPPER_DIR = "braintrust/wrappers"
CONTRIB_DIR = "braintrust/contrib"


SILENT_INSTALLS = True
LATEST = "latest"
ERROR_CODES = tuple(range(1, 256))


# The minimal set of dependencies we need to run tests.
BASE_TEST_DEPS = ("pytest", "pytest-asyncio", "pytest-vcr")

# List your package here if it's not guaranteed to be installed. We'll (try to)
# validate things work with or without them.
VENDOR_PACKAGES = (
    "agno",
    "anthropic",
    "dspy",
    "openai",
    "openai-agents",
    "pydantic_ai",
    "autoevals",
    "braintrust_core",
    "litellm",
    "opentelemetry-api",
    "opentelemetry-sdk",
    "opentelemetry-exporter-otlp-proto-http",
    "google.genai",
    "temporalio",
)

# Test matrix
ANTHROPIC_VERSIONS = (LATEST, "0.50.0", "0.49.0", "0.48.0")
OPENAI_VERSIONS = (LATEST, "1.77.0", "1.71", "1.91", "1.92")
LITELLM_VERSIONS = (LATEST, "1.74.0")
CLAUDE_AGENT_SDK_VERSIONS = (LATEST, "0.1.0")
AGNO_VERSIONS = (LATEST, "2.1.0")
# pydantic_ai 1.x requires Python >= 3.10
if sys.version_info >= (3, 10):
    PYDANTIC_AI_VERSIONS = (LATEST, "1.0.1", "0.1.9")
else:
    PYDANTIC_AI_VERSIONS = (LATEST, "0.1.9")  # latest will resolve to 0.1.9 for Python 3.9

AUTOEVALS_VERSIONS = (LATEST, "0.0.129")
GENAI_VERSIONS = (LATEST,)
DSPY_VERSIONS = (LATEST,)
# temporalio 1.19.0+ requires Python >= 3.10; skip Python 3.9 entirely
TEMPORAL_VERSIONS = (LATEST, "1.20.0", "1.19.0")


@nox.session()
def test_core(session):
    _install_test_deps(session)
    # verify we haven't installed our 3p deps.
    for p in VENDOR_PACKAGES:
        session.run("python", "-c", f"import {p}", success_codes=ERROR_CODES, silent=True)
    _run_core_tests(session)


@nox.session()
@nox.parametrize("version", PYDANTIC_AI_VERSIONS, ids=PYDANTIC_AI_VERSIONS)
def test_pydantic_ai(session, version):
    _install_test_deps(session)
    _install(session, "pydantic_ai", version)
    _run_tests(session, f"{WRAPPER_DIR}/test_pydantic_ai.py")
    _run_core_tests(session)


@nox.session()
@nox.parametrize("version", CLAUDE_AGENT_SDK_VERSIONS, ids=CLAUDE_AGENT_SDK_VERSIONS)
def test_claude_agent_sdk(session, version):
    # claude_agent_sdk requires Python >= 3.10
    if sys.version_info >= (3, 10):
        _install_test_deps(session)
        npm_bin = _install_npm_in_session(session)
        session.run(npm_bin, "install", "-g", "@anthropic-ai/claude-code", external=True)
        _install(session, "claude_agent_sdk", version)
        _run_tests(session, f"{WRAPPER_DIR}/claude_agent_sdk/test_wrapper.py")
        _run_core_tests(session)


@nox.session()
@nox.parametrize("version", AGNO_VERSIONS, ids=AGNO_VERSIONS)
def test_agno(session, version):
    _install_test_deps(session)
    _install(session, "agno", version)
    _run_tests(session, f"{WRAPPER_DIR}/test_agno.py")
    _run_core_tests(session)


@nox.session()
@nox.parametrize("version", ANTHROPIC_VERSIONS, ids=ANTHROPIC_VERSIONS)
def test_anthropic(session, version):
    _install_test_deps(session)
    _install(session, "anthropic", version)
    _run_tests(session, f"{WRAPPER_DIR}/test_anthropic.py")
    _run_core_tests(session)


@nox.session()
@nox.parametrize("version", GENAI_VERSIONS, ids=GENAI_VERSIONS)
def test_google_genai(session, version):
    _install_test_deps(session)
    _install(session, "google-genai", version)
    _run_tests(session, f"{WRAPPER_DIR}/test_google_genai.py")
    _run_core_tests(session)


@nox.session()
@nox.parametrize("version", OPENAI_VERSIONS, ids=OPENAI_VERSIONS)
def test_openai(session, version):
    _install_test_deps(session)
    _install(session, "openai", version)
    # openai-agents requires Python >= 3.10
    if sys.version_info >= (3, 10):
        _install(session, "openai-agents")
    _run_tests(session, f"{WRAPPER_DIR}/test_openai.py")
    _run_core_tests(session)


@nox.session()
def test_openrouter(session):
    """Test wrap_openai with OpenRouter. Requires OPENROUTER_API_KEY env var."""
    _install_test_deps(session)
    _install(session, "openai")
    _run_tests(session, f"{WRAPPER_DIR}/test_openrouter.py")


@nox.session()
@nox.parametrize("version", LITELLM_VERSIONS, ids=LITELLM_VERSIONS)
def test_litellm(session, version):
    _install_test_deps(session)
    # Install a compatible version of openai (1.99.9 or lower) to avoid the ResponseTextConfig removal in 1.100.0
    # https://github.com/BerriAI/litellm/issues/13711
    session.install("openai<=1.99.9", "--force-reinstall")
    _install(session, "litellm", version)
    _run_tests(session, f"{WRAPPER_DIR}/test_litellm.py")
    _run_core_tests(session)


@nox.session()
@nox.parametrize("version", DSPY_VERSIONS, ids=DSPY_VERSIONS)
def test_dspy(session, version):
    _install_test_deps(session)
    _install(session, "dspy", version)
    _run_tests(session, f"{WRAPPER_DIR}/test_dspy.py")


@nox.session()
@nox.parametrize("version", AUTOEVALS_VERSIONS, ids=AUTOEVALS_VERSIONS)
def test_autoevals(session, version):
    # Run all of our core tests with autoevals installed. Some tests
    # specifically validate scores from autoevals work properly, so
    # we need some tests with it installed.
    _install_test_deps(session)
    _install(session, "autoevals", version)
    _run_core_tests(session)


@nox.session()
def test_braintrust_core(session):
    # Some tests do specific things if braintrust_core is installed, so run our
    # common tests with it installed. Testing the latest (aka the last ever version)
    # is enough.
    _install_test_deps(session)
    _install(session, "braintrust_core")
    _run_core_tests(session)


@nox.session()
def test_cli(session):
    """Test CLI/devserver with starlette installed."""
    _install_test_deps(session)
    session.install(".[cli]")
    session.install("httpx")  # Required for starlette.testclient
    _run_tests(session, "braintrust/devserver/test_server_integration.py")


@nox.session()
def test_otel(session):
    """Test OtelExporter with OpenTelemetry installed."""
    _install_test_deps(session)
    session.install(".[otel]")
    _run_tests(session, "braintrust/test_otel.py")


@nox.session()
@nox.parametrize("version", TEMPORAL_VERSIONS, ids=TEMPORAL_VERSIONS)
def test_temporal(session, version):
    """Test Temporal integration with temporalio installed."""
    # temporalio 1.19.0+ requires Python >= 3.10
    if sys.version_info < (3, 10):
        session.skip("temporalio 1.19.0+ requires Python >= 3.10")
    _install_test_deps(session)
    _install(session, "temporalio", version)
    _run_tests(session, "braintrust/contrib/temporal")


@nox.session()
def test_otel_not_installed(session):
    _install_test_deps(session)
    otel_packages = ["opentelemetry", "opentelemetry.trace", "opentelemetry.exporter.otlp.proto.http.trace_exporter"]
    for pkg in otel_packages:
        session.run("python", "-c", f"import {pkg}", success_codes=ERROR_CODES, silent=True)
    _run_tests(session, "braintrust/test_otel.py")


@nox.session()
def pylint(session):
    # pylint needs everything so we don't trigger missing import errors
    # Skip on Python < 3.10 because some deps (like temporalio 1.19+) require 3.10+
    if sys.version_info < (3, 10):
        session.skip("pylint requires Python >= 3.10 for full dependency support")
    session.install(".[all]")
    session.install("-r", "requirements-dev.txt")
    session.install(*VENDOR_PACKAGES)
    session.install("opentelemetry.instrumentation.openai")

    result = session.run("git", "ls-files", "**/*.py", silent=True, log=False)
    files = result.strip().splitlines()
    if not files:
        return
    session.run("pylint", "--errors-only", *files)


@nox.session()
def test_latest_wrappers_novcr(session):
    """Run the latest wrapper tests without vcrpy."""
    # every test run we hit openai, anthropic,  at least once so we balance CI speed (with vcrpy)
    # with testing reality.
    args = session.posargs.copy()
    if "--disable-vcr" not in args:
        args.append("--disable-vcr")
    session.notify("test_openai(latest)", posargs=args)
    session.notify("test_anthropic(latest)", posargs=args)
    session.notify("test_pydantic_ai(latest)", posargs=args)
    session.notify("test_claude_agent_sdk(latest)", posargs=args)


def _install_npm_in_session(session):
    """Install Node.js and npm in the nox session using nodeenv."""
    session.install("nodeenv", silent=SILENT_INSTALLS)
    # Create a node environment in the session's temporary directory
    node_dir = os.path.join(session.create_tmp(), "node_env")
    session.run("nodeenv", node_dir, silent=SILENT_INSTALLS)
    # Return the path to npm binary for direct use
    if sys.platform == "win32":
        npm_bin = os.path.join(node_dir, "Scripts", "npm.cmd")
    else:
        npm_bin = os.path.join(node_dir, "bin", "npm")
    return npm_bin


def _install_test_deps(session):
    # Choose the way we'll install braintrust ... wheel or source.
    install_wheel = "--wheel" in session.posargs
    bt = _get_braintrust_wheel() if install_wheel else "."

    # Install _only_ the dependencies we need for testing (not lint, black,
    # ipython, whatever). We want to carefully control the base
    # testing environment so it should be truly minimal.
    session.install(bt, *BASE_TEST_DEPS)

    # Sanity check we have installed braintrust (and that it is from a wheel if needed)
    session.run("python", "-c", "import braintrust")
    if install_wheel:
        lines = [
            "import sys, braintrust as b",
            "print(f'Using braintrust from: {b.__file__}')",
            "sys.exit(0 if 'site-packages' in b.__file__ else 1)",
        ]
        session.run("python", "-c", ";".join(lines))


def _get_braintrust_wheel():
    path = "dist/braintrust-*.whl"
    wheels = glob.glob(path)
    if len(wheels) != 1:
        msg = f"There should be one wheel in {path}. Got {len(wheels)}"
        raise Exception(msg)
    return wheels[0]


def _run_core_tests(session):
    """Run all tests which don't require optional dependencies."""
    _run_tests(session, SRC_DIR, ignore_paths=[WRAPPER_DIR, CONTRIB_DIR])


def _run_tests(session, test_path, ignore_path="", ignore_paths=None, env=None):
    """Run tests against a wheel or the source code. Paths should be relative and start with braintrust."""
    env = env.copy() if env else {}
    wheel_flag = "--wheel" in session.posargs
    common_args = ["--disable-vcr"] if "--disable-vcr" in session.posargs else []

    # Support both ignore_path (for backward compatibility) and ignore_paths
    paths_to_ignore = []
    if ignore_path:
        paths_to_ignore.append(ignore_path)
    if ignore_paths:
        paths_to_ignore.extend(ignore_paths)

    if not wheel_flag:
        # Run the tests in the src directory
        test_args = [
            "pytest",
            f"src/{test_path}",
        ]
        for path in paths_to_ignore:
            test_args.append(f"--ignore=src/{path}")
        session.run(*test_args, *common_args, env=env)
        return

    # Running the tests from the wheel involves a bit of gymnastics to ensure we don't import
    # local modules from the source directory.
    # First, we need to absolute paths to all the binaries and libs in our venv that we'll see.
    py = os.path.join(session.bin, "python")
    site_packages = session.run(py, "-c", "import site; print(site.getsitepackages()[0])", silent=True).strip()
    abs_test_path = os.path.abspath(os.path.join(site_packages, test_path))
    pytest_path = os.path.join(session.bin, "pytest")

    ignore_args = []
    for path in paths_to_ignore:
        abs_ignore_path = os.path.abspath(os.path.join(site_packages, path))
        ignore_args.append(f"--ignore={abs_ignore_path}")

    # Lastly, change to a different directory to ensure we don't install local stuff.
    with tempfile.TemporaryDirectory() as tmp:
        os.chdir(tmp)
        # This env var is used to detect if we're running from the wheel.
        # It proved very helpful because it's very easy
        # to accidentally import local modules from the source directory.
        env["BRAINTRUST_TESTING_WHEEL"] = "1"
        session.run(pytest_path, abs_test_path, *ignore_args, *common_args, env=env)

    # And a final note ... if it's not clear from above, we include test files in our wheel, which
    # is perhaps not ideal?


def _install(session, package, version=LATEST):
    pkg_version = f"{package}=={version}"
    if version == LATEST or not version:
        pkg_version = package
    session.install(pkg_version, silent=SILENT_INSTALLS)
