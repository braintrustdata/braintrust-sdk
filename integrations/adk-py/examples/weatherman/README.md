# Weatherman

## Virtual environment

A ready-to-use Python virtual environment lives in `.venv/`, created with Python 3.14.0. Use it to keep this project's dependencies isolated from the rest of your system.

### Activate the environment

```bash
cd /Users/alex/video/weatherman
source .venv/bin/activate
```

You'll know it's active when your shell prompt shows `(.venv)` at the front. Once activated, any Python or `pip` command you run will use this environment.

### Install dependencies (optional refresher)

```bash
pip install -r requirements.txt
```

You only need to do this again if `requirements.txt` changes or you delete the environment.

### Finish up

Run `deactivate` when you're done to return to your normal shell.

If you ever need to recreate the virtual environment from scratch, run:

```bash
python3 -m venv .venv
```

Then repeat the activation steps above.
