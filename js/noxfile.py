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
def test_ai_sdk(session: nox.Session):
    libs = ["ai@beta", "@ai-sdk/openai@beta", "@ai-sdk/anthropic@beta", "@ai-sdk/provider@beta"]
    _install_optional_libraries(session, libs)
    session.run("pnpm", "test:ai-sdk")


def _install_optional_libraries(session: nox.Session, optional_libraries: list[str]):
    env = {
        "npm_config_save": "false",
        "npm_config_lockfile": "false",
    }
    session.run("pnpm", "add", *optional_libraries, env=env)
