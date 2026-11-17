# Apply as a trusted image-build step; feature checks remain offline.
FROM crew-dev-runner:local
RUN /opt/bolt-venv/bin/pip install --no-cache-dir "langgraph==1.2.22"
RUN /opt/bolt-venv/bin/python -c "from langgraph.graph import StateGraph; from langgraph.types import Command, interrupt; from importlib.metadata import version; assert version('langgraph') == '1.2.22'"
