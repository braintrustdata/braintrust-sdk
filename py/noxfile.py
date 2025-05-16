"""
Nox scripts the environment our tests run in and it used to verify our library
works with and without different dependencies. A few commands to check out:

    nox                        Run all sessions.
    nox -l                     List all sessions.
    nox -s <session>           Run a specific session.
    nox ... -- --wheel         Run tests against the wheel in dist.
    nox -h                     Get help.
"""

import glob
import os
import site
import tempfile

import nox

LATEST = "__latest__"

SRC_DIR = "braintrust"
WRAPPER_DIR = "braintrust/wrappers"

SILENT_INSTALLS = True

ERROR_CODES = tuple(range(1, 256))

# List your package here if it's not guaranteed to be installed. We'll (try to)
# validate things work with or without them.
VENDOR_PACKAGES = (
    "anthropic",
    "openai",
    "pydantic_ai",
    "autoevals",
    "braintrust_core",
)

# Test matrix
ANTHROPIC_VERSIONS = (LATEST, "0.50.0", "0.49.0", "0.48.0")
OPENAI_VERSIONS = (LATEST, "1.77.0", "1.71")
PYDANTIC_AI_VERSIONS = (LATEST, "0.1.9")
AUTOEVALS_VERSIONS = (LATEST, "0.0.129")


@nox.session()
def test_core(session):
    _install_test_deps(session)
    # verify we haven't installed our 3p deps.
    for p in VENDOR_PACKAGES:
        session.run("python", "-c", f"import {p}", success_codes=ERROR_CODES, silent=True)
    _run_core_tests(session)


@nox.session()
@nox.parametrize("pydantic_ai_version", PYDANTIC_AI_VERSIONS)
def test_with_pydantic_ai(session, pydantic_ai_version):
    _install_test_deps(session)
    _install(session, "pydantic_ai", pydantic_ai_version)
    _run_tests(session, f"{WRAPPERS}/test_pydantic_ai.py")


@nox.session()
@nox.parametrize("version", ANTHROPIC_VERSIONS)
def test_with_anthropic(session, version):
    _install_test_deps(session)
    _install(session, "anthropic", version)
    _run_tests(session, f"{WRAPPERS}/test_anthropic.py")


@nox.session()
@nox.parametrize("version", OPENAI_VERSIONS)
def test_with_openai(session, version):
    _install_test_deps(session)
    _install(session, "openai", version)
    _run_tests(session, f"{WRAPPERS}/test_openai.py")


@nox.session()
@nox.parametrize("version", AUTOEVALS_VERSIONS)
def test_with_autoevals(session, version):
    # Run all of our core tests with autoevals installed. Some tests
    # specifically validate scores from autoevals work properly, so
    # we need some tests with it installed.
    _install_test_deps(session)
    _install(session, "autoevals", version)
    _run_core_tests(session)


@nox.session()
def test_with_braintrust_core(session):
    # Some tests do specific things if braintrust_core is installed, so run our
    # common tests with it installed. Testing the latest (aka the last ever version)
    # is enough.
    _install_test_deps(session)
    _install(session, "braintrust_core")
    _run_core_tests(session)


def _install_test_deps(session):
    # verify braintrust isn't installed yet
    session.run("python", "-c", "import braintrust", success_codes=ERROR_CODES, silent=True)

    install_wheel = "--wheel" in session.posargs

    session.install("pytest")
    session.install("pytest-asyncio")
    if install_wheel:
        wheel_path = _get_braintrust_wheel()
        # When testing the wheel, do NOT install in editable mode
        # to ensure we test the wheel and not the local source code
        session.install(wheel_path)
        # Install test dependencies separately since we're not using .[test]
        session.install("pytest-mock")
        session.install("responses")
    else:
        session.install("-e", ".[test]")

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


def _run_core_and_optional_test(session, optional_test_path):
    # a little helper since all of our wrappers want to run all tests plus one
    _run_tests(session, optional_test_path)
    _run_core_tests(session)


def _run_core_tests(session):
    """Run all tests which don't require optional dependencies."""
    _run_tests(session, SRC_DIR, ignore_path=WRAPPER_DIR)


def _run_tests(session, test_path, ignore_path=""):
    """Run tests against a wheel or the source code. Paths should be relative and start with braintrust."""
    wheel_flag = "--wheel" in session.posargs
    if not wheel_flag:
        # Run the tests in the src directory
        ignore = f"--ignore=src/{ignore_path}" if ignore_path else ""
        session.run("pytest", f"src/{test_path}", ignore)
        return

    # Running the tests from the wheel involves a bit of gymnastics to ensure we don't import
    # local modules from the source directory.
    # First, we need to absolute paths to all the binaries and libs in our venv that we'll see.
    py = os.path.join(session.bin, "python")
    site_packages = session.run(py, "-c", "import site; print(site.getsitepackages()[0])", silent=True).strip()
    test_path = os.path.abspath(os.path.join(site_packages, "braintrust"))
    ignore_path = os.path.abspath(os.path.join(site_packages, ignore_path))
    pytest_path = os.path.join(session.bin, "pytest")
    ignore = f"--ignore={ignore_path}" if ignore_path else ""

    # Lastly, change to a different directory to ensure we don't install local stuff.
    with tempfile.TemporaryDirectory() as tmp:
        os.chdir(tmp)
        # This env var is used to detect if we're running from the wheel.
        # It proved very helpful because it's very easy
        # to accidentally import local modules from the source directory.
        env = {"BRAINTRUST_TESTING_WHEEL": "1"}
        session.run(pytest_path, test_path, ignore, env=env)

    # And a final note ... if it's not clear from above, we include test files in our wheel, which
    # is perhaps not ideal?


def _install(session, package, version=LATEST):
    cmd = f"{package}=={version}"
    if version == LATEST or not version:
        cmd = package
    session.run("pip", "install", cmd, silent=SILENT_INSTALLS)
