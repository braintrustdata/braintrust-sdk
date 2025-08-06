import os
import sys
from typing import Any, Dict, Optional

import setuptools

dir_name = os.path.abspath(os.path.dirname(__file__))

version_contents: Optional[Dict[str, Any]] = {}
with open(os.path.join(dir_name, "src", "braintrust_langchain", "version.py"), encoding="utf-8") as f:
    exec(f.read(), version_contents)

with open(os.path.join(dir_name, "README.md"), "r", encoding="utf-8") as f:
    long_description = f.read()

install_requires = [
    "braintrust>=0.2.1",
    "langchain",
]

dev_requires = [
    "black",
    "build",
    "flake8",
    "flake8-isort",
    "httpx",
    "langchain-openai",
    "isort==5.12.0",
    "pre-commit",
    "pytest",
    "responses",
    "respx",
    "tenacity",
    "twine",
]

# Add langgraph only for Python 3.9+
if sys.version_info >= (3, 9):
    dev_requires.append("langgraph>=0.2.1,<0.4.0")  # for testing langgraph wrappers

extras_require = {
    "dev": dev_requires,
}

extras_require["all"] = sorted({package for packages in extras_require.values() for package in packages})

setuptools.setup(
    name="braintrust-langchain",
    version=version_contents["VERSION"],
    author="Braintrust",
    author_email="info@braintrust.dev",
    description="Integration for LangChain and Braintrust Tracing",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://www.braintrust.dev",
    project_urls={
        "Source Code": "https://github.com/braintrustdata/braintrust-sdk",
        "Bug Tracker": "https://github.com/braintrustdata/braintrust-sdk/issues",
    },
    classifiers=[
        "Programming Language :: Python :: 3",
        "Operating System :: OS Independent",
    ],
    package_dir={"": "src"},
    packages=setuptools.find_packages(where="src"),
    package_data={"braintrust_langchain": ["py.typed"]},
    python_requires=">=3.8.0",
    install_requires=install_requires,
    extras_require=extras_require,
)
