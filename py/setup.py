import os

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
    "tqdm",
    "exceptiongroup>=1.2.0",
    "python-dotenv",
    "sseclient-py",
    "python-slugify",
    "typing_extensions>=4.1.0",
]

extras_require = {
    "cli": ["boto3", "psycopg2-binary", "uv"],
    "dev": [
        "black",
        "build",
        "flake8",
        "flake8-isort",
        "IPython",
        "isort==5.12.0",
        "pre-commit",
        "pytest",
        "twine",
        "pytest-asyncio",
        "nox",
    ],
    "doc": ["pydoc-markdown"],
    "openai-agents": ["openai-agents"],
    # These should only be installed for linting import errors, not for tests.
    "lint": ["anthropic"],
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
