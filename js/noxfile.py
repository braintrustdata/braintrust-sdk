from functools import wraps

import nox

# we're not using a venv, so skip setting it up
nox.options.default_venv_backend = "none"


def clean_js_env(func):
    @wraps(func)
    def wrapped(session, *args, **kwargs):
        session.run("pnpm", "prune")
        return func(session, *args, **kwargs)

    return wrapped


@nox.session()
@clean_js_env
def test_ai_sdk_v1(session: nox.Session):
    libs = ["ai@^3.0.0"]
    _install_optional_libraries(session, libs)
    session.run("pnpm", "test:ai-sdk-v1")


@nox.session()
@clean_js_env
def test_ai_sdk_v2(session: nox.Session):
    libs = ["ai@beta", "@ai-sdk/openai@beta", "@ai-sdk/anthropic@beta", "@ai-sdk/provider@beta"]
    _install_optional_libraries(session, libs)
    session.run("pnpm", "test:ai-sdk-v2")


@nox.session()
@clean_js_env
def debug_provider_v2(session: nox.Session):
    libs = ["ai@beta", "@ai-sdk/openai@beta", "@ai-sdk/anthropic@beta", "@ai-sdk/provider@beta"]
    _install_optional_libraries(session, libs)
    session.run("pwd")
    session.run("ls", "-la", "src/wrappers/")
    session.run("node", "debug-provider.js")


def _install_optional_libraries(session: nox.Session, optional_libraries: list[str]):
    env = {
        "npm_config_save": "false",
        "npm_config_lockfile": "false",
    }
    session.run("pnpm", "add", *optional_libraries, env=env)
