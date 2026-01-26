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
    "wrapt",
]

extras_require = {
    "cli": ["boto3", "psycopg2-binary", "uv", "starlette", "uvicorn"],
    "doc": ["pydoc-markdown"],
    "openai-agents": ["openai-agents"],
    "otel": ["opentelemetry-api", "opentelemetry-sdk", "opentelemetry-exporter-otlp-proto-http"],
    "temporal": ["temporalio>=1.19.0; python_version>='3.10'"],
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
        "Programming Language :: Python :: 3.10",
        "Operating System :: OS Independent",
    ],
    package_dir={"": "src"},
    packages=setuptools.find_packages(where="src"),
    package_data={"braintrust": ["py.typed"]},
    python_requires=">=3.10.0",
    entry_points={"console_scripts": ["braintrust = braintrust.cli.__main__:main"]},
    install_requires=install_requires,
    extras_require=extras_require,
)
