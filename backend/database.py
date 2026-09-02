from pathlib import Path

import aiosqlite

DB_PATH = Path("echo.db")
SCHEMA_PATH = Path(__file__).parent / "sql_schema.sql"


async def init_sqlite(
    db_path: Path = DB_PATH, schema_path: Path = SCHEMA_PATH
) -> aiosqlite.Connection:
    """This only checks whether the DB file exists, not whether its schema is implemeted correctly."""

    already_exists = db_path.exists()
    # aiosqlite.connect() creates the file if it's missing.
    conn = await aiosqlite.connect(db_path)
    if not already_exists:
        await conn.executescript(schema_path.read_text())
        await conn.commit()
    return conn


async def check_sqlite_alive(conn: aiosqlite.Connection) -> bool:
    """Checks a simple query is returned."""

    try:
        await conn.execute("SELECT 1")
        return True
    except Exception:
        return False


async def recover_interrupted_jobs(conn: aiosqlite.Connection) -> int:
    """Recovers jobs that didn't complete in the last app run."""

    cursor = await conn.execute(
        "UPDATE jobs SET status = 'failed', "
        "error_message = 'Interrupted by application restart' "
        "WHERE status = 'running'"
    )
    await conn.commit()
    return cursor.rowcount
