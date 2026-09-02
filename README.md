# Echo

Echo is a local-first, multimodal semantic "second brain" note-taking system. It comprises of a FastAPI backend (SQLite + Chroma vector store) with a Tauri/Vite frontend, and runs OCR, image captioning, and audio transcription models locally on your machine. 

## Prerequisites

- **Python** 3.10, 3.11, or 3.12 (3.13 is not supported by chromadb)
- **Node.js** and npm (for the frontend)
- **An internet connection for first-time setup** (The app downloads Whisper, BLIP, Surya OCR and a sentence-embedding model which are then cached locally and used offline afterwards)

## Project structure

```
Echo/
├── main.py           # FastAPI app entry point
├── pyproject.toml    # Python dependencies
├── backend/          # API routes, database, models, job worker
├── data/
│   └── fetch_models.py  # one-time script to download & cache ML models
├── frontend/          # Vite + Tauri UI
└── tests/
```

## Setup

### 1. Install Python dependencies

From the project root (the folder containing `pyproject.toml`), create and activate an (optional) virtual environment, then install dependencies:

```bash
pip install -e
```

`-e` installs the project in "editable" mode, so any changes you make to the source code are picked up immediately without reinstalling. If you also want to run the test suite:

```bash
pip install -e ".[dev]"
```

### 2. Download the ML models (one-time, requires network)

```bash
python data/fetch_models.py
```

This downloads and caches the embedding, transcription (Whisper), captioning (BLIP), and OCR (Surya) models into `data/model_cache/`. It only needs to be run once and after that, the app runs fully offline.

### 3. Run the backend

From the project root:

```bash
uvicorn main:app
```

The API serves on `http://127.0.0.1:8000`.

### 4. Run the frontend

In a **separate terminal**, from the `frontend/` directory:

```bash
cd frontend
npm install
npm run dev
```

The dev server runs on `http://localhost:1420`. Which is bundled with the backend by CORS middleware.

## Running the tests

#### Backend

From the root directory: 

```bash
pip install -e ".[dev]"
cd tests\backend
pytest
```
#### Frontend

From the frontend directory, after running `npm install`: 

```bash
npm run tests
```

## Notes

- The backend and frontend must both be running simultaneously during development (on separate terminals).
- Model downloads in step 2 can take a while depending on connection speed; subsequent runs use the local cache.