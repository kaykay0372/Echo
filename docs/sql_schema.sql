-- Echo - SQLite Schema
PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- notes (Core entity)
-- note_type drives which downstream pipeline (embed/caption/ocr/transcribe) applies. 
-- embedding_status tracks pipeline progress.
-- ----------------------------------------------------------------------------
CREATE TABLE
    notes (
        id TEXT PRIMARY KEY, -- UUID
        note_type TEXT NOT NULL CHECK (note_type IN ('text', 'image', 'audio', 'canvas')),
        title TEXT,
        body TEXT,
        embedding_text TEXT, -- built by build_embedding_text()
        embedding_status TEXT NOT NULL DEFAULT 'pending' CHECK (
            embedding_status IN (
                'pending',
                'processing',
                'complete',
                'failed',
                'skipped'
            )
        ),
        show_generated_content INTEGER NOT NULL DEFAULT 1 CHECK (show_generated_content IN (0, 1)), -- boolean: 0/1
        is_favourite INTEGER NOT NULL DEFAULT 0 CHECK (is_favourite IN (0, 1)), -- boolean: 0/1
        is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)), -- boolean: 0/1
        deleted_at TEXT, -- ISO 8601, nullable
        word_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, -- ISO 8601
        updated_at TEXT NOT NULL -- ISO 8601
    );

CREATE INDEX idx_notes_note_type ON notes (note_type);

CREATE INDEX idx_notes_is_deleted ON notes (is_deleted);

CREATE INDEX idx_notes_updated_at ON notes (updated_at);

-- ----------------------------------------------------------------------------
-- attachments
-- One row per embedded/imported file (image or audio). Holds raw ML output
-- (caption, OCR text, transcript) regardless of display visibility.
-- ----------------------------------------------------------------------------
CREATE TABLE
    attachments (
        id TEXT PRIMARY KEY, -- UUID
        note_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_type TEXT NOT NULL CHECK (file_type IN ('image', 'audio')),
        content_hash TEXT, -- dedup / integrity check
        generated_caption TEXT, -- BLIP output
        generated_ocr_text TEXT, -- Surya output
        generated_transcript TEXT, -- Whisper output
        processing_status TEXT NOT NULL DEFAULT 'pending' CHECK (
            processing_status IN ('pending', 'processing', 'complete', 'failed')
        ),
        created_at TEXT NOT NULL,
        FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE
    );

CREATE INDEX idx_attachments_note_id ON attachments (note_id);

-- ----------------------------------------------------------------------------
-- jobs (Background job queue)
-- Each job is either note-level (embed, generate_links) or attachment-level.
-- Enforced here via CHECK rather than at the application layer alone.
-- ----------------------------------------------------------------------------
CREATE TABLE
    jobs (
        id TEXT PRIMARY KEY, -- UUID
        note_id TEXT, -- nullable FK
        attachment_id TEXT, -- nullable FK
        job_type TEXT NOT NULL CHECK (
            job_type IN (
                'embed',
                'generate_links',
                'caption',
                'ocr',
                'transcribe'
            )
        ),
        status TEXT NOT NULL DEFAULT 'queued' CHECK (
            status IN ('queued', 'running', 'complete', 'failed')
        ),
        error_message TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE,
        FOREIGN KEY (attachment_id) REFERENCES attachments (id) ON DELETE CASCADE,
        -- Exactly one of note_id / attachment_id must be set, never both, never neither.
        CHECK (
            (
                note_id IS NOT NULL
                AND attachment_id IS NULL
            )
            OR (
                note_id IS NULL
                AND attachment_id IS NOT NULL
            )
        )
    );

CREATE INDEX idx_jobs_status ON jobs (status);

CREATE INDEX idx_jobs_job_type ON jobs (job_type);

CREATE INDEX idx_jobs_note_id ON jobs (note_id);

-- ----------------------------------------------------------------------------
-- links
-- Confirmed/pending manual or automatic connections between two notes.
-- ----------------------------------------------------------------------------
CREATE TABLE
    links (
        id TEXT PRIMARY KEY, -- UUID
        source_note_id TEXT NOT NULL,
        target_note_id TEXT NOT NULL,
        link_type TEXT NOT NULL CHECK (link_type IN ('manual', 'automatic')),
        similarity_score REAL, -- null for manual links
        status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (
            status IN ('pending_approval', 'confirmed', 'rejected')
        ),
        created_at TEXT NOT NULL,
        confirmed_at TEXT,
        FOREIGN KEY (source_note_id) REFERENCES notes (id) ON DELETE CASCADE,
        FOREIGN KEY (target_note_id) REFERENCES notes (id) ON DELETE CASCADE,
        -- A note cannot link to itself.
        CHECK (source_note_id != target_note_id)
    );

CREATE INDEX idx_links_source ON links (source_note_id);

CREATE INDEX idx_links_target ON links (target_note_id);

CREATE INDEX idx_links_status ON links (status);

-- ----------------------------------------------------------------------------
-- tags (Hierarchical tags)
-- tag_type distinguishes user-created vs system-generated semantic tags (F-35, F-36).
-- ----------------------------------------------------------------------------
CREATE TABLE
    tags (
        id TEXT PRIMARY KEY, -- UUID
        name TEXT NOT NULL,
        parent_id TEXT, -- nullable self-FK
        tag_type TEXT NOT NULL CHECK (tag_type IN ('manual', 'automatic')),
        created_at TEXT NOT NULL,
        FOREIGN KEY (parent_id) REFERENCES tags (id) ON DELETE CASCADE
    );

CREATE INDEX idx_tags_parent_id ON tags (parent_id);

-- ----------------------------------------------------------------------------
-- note_tags
-- Many-to-many join table between notes and tags. Composite PK.
-- ----------------------------------------------------------------------------
CREATE TABLE
    note_tags (
        note_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        PRIMARY KEY (note_id, tag_id),
        FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
    );

-- ----------------------------------------------------------------------------
-- canvas_items
-- Notes placed onto a canvas note's surface.
-- ----------------------------------------------------------------------------
CREATE TABLE
    canvas_items (
        id TEXT PRIMARY KEY, -- UUID
        canvas_note_id TEXT NOT NULL,
        child_note_id TEXT NOT NULL,
        pos_x REAL NOT NULL DEFAULT 0,
        pos_y REAL NOT NULL DEFAULT 0,
        display_width REAL,
        display_height REAL,
        added_at TEXT NOT NULL,
        FOREIGN KEY (canvas_note_id) REFERENCES notes (id) ON DELETE CASCADE,
        FOREIGN KEY (child_note_id) REFERENCES notes (id) ON DELETE CASCADE,
        CHECK (canvas_note_id != child_note_id)
    );

CREATE INDEX idx_canvas_items_canvas_note_id ON canvas_items (canvas_note_id);

-- ----------------------------------------------------------------------------
-- canvas_elements
-- Freeform drawing elements on a canvas note.
-- Data column holds element-specific JSON metadata.
-- ----------------------------------------------------------------------------
CREATE TABLE
    canvas_elements (
        id TEXT PRIMARY KEY, -- UUID
        canvas_note_id TEXT NOT NULL,
        element_type TEXT NOT NULL, -- e.g. 'stroke', 'shape', 'text'
        pos_x REAL NOT NULL DEFAULT 0,
        pos_y REAL NOT NULL DEFAULT 0,
        width REAL,
        height REAL,
        z_index INTEGER NOT NULL DEFAULT 0,
        data TEXT, -- JSON blob
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (canvas_note_id) REFERENCES notes (id) ON DELETE CASCADE
    );

CREATE INDEX idx_canvas_elements_canvas_note_id ON canvas_elements (canvas_note_id);