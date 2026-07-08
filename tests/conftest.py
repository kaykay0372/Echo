# Session-scoped fixtures loaded directly from 40_notes.json(AI-generated, synthetic dataset).

import json
import os
import pytest

DATASET_PATH = os.path.join(os.path.dirname(__file__), "data", "40_notes.json")

@pytest.fixture(scope="session")
def raw_dataset():
    with open(DATASET_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="session")
def notes(raw_dataset):
    return raw_dataset["notes"]


@pytest.fixture(scope="session")
def annotations(raw_dataset):
    return raw_dataset["annotations"]


@pytest.fixture(scope="session")
def connection(annotations):
    from tests.embedding_model_evaluation.metrics import build_connection_maps
    return build_connection_maps(annotations)


@pytest.fixture(scope="session")
def strict_conn(connection):
    return connection[0]


@pytest.fixture(scope="session")
def lenient_conn(connection):
    return connection[1]


@pytest.fixture(scope="session")
def note_ids(notes):
    return [n["id"] for n in notes]
