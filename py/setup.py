import os
import sys

import setuptools

dir_name = os.path.abspath(os.path.dirname(__file__))

version_contents = {}
with open(os.path.join(dir_name, "src", "braintrust", "version.py"), encoding="utf-8") as f:
    exec(f.read(), version_contents)

with open(os.path.join(dir_name, "README.md"), "r", encoding="utf-8") as f:
    long_description = f.read()

install_requires = [
    "GitPython",
    "requests",
    "chevron",
    "braintrust_core",
    "tqdm",
    "exceptiongroup>=1.2.0",
    "python-dotenv",
    "sseclient-py",
    "python-slugify",
    "typing_extensions>=4.1.0",
]

dev_requires = [
    "black",
    "build",
    "flake8",
    "flake8-isort",
    "httpx",  # for testing langchain wrappers
    "IPython",
    "langchain",  # for testing langchain wrappers
    "langchain-openai",  # for testing langchain wrappers
    "isort==5.12.0",
    "pre-commit",
    "pytest",
    "pytest-watch",
    "responses",  # for testing langchain wrappers
    "respx",  # for testing langchain wrappers
    "twine",
]

# Add langgraph only for Python 3.9+
if sys.version_info >= (3, 9):
    dev_requires.append("langgraph>=0.2.1,<0.4.0")  # for testing langgraph wrappers

extras_require = {
    "cli": ["boto3", "psycopg2-binary", "uv"],
    "dev": dev_requires,
    "doc": ["pydoc-markdown"],
}

extras_require["all"] = sorted({package for packages in extras_require.values() for package in packages})

setuptools.setup(
    name="braintrust",
    version=version_contents["VERSION"],
    author="Braintrust",
    author_email="info@braintrust.dev",
    description="SDK for integrating Braintrust",
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
    package_data={"braintrust": ["py.typed"]},
    python_requires=">=3.8.0",
    entry_points={"console_scripts": ["braintrust = braintrust.cli.__main__:main"]},
    install_requires=install_requires,
    extras_require=extras_require,
)
