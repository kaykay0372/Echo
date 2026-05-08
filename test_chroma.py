# Stores 12 test notes with their embeddings in ChromaDB, then queries 
# for the most similar notes to a new input. Proves the full 
# store-and-retrieve pipeline works and that data persists to disk.

import chromadb
from sentence_transformers import SentenceTransformer
import os
import time

# STEP 1: Set up the local database 
print("\n STEP 1: Setting up local ChromaDB database")

DB_PATH = "./chroma_db"
client = chromadb.PersistentClient(path=DB_PATH)

# get_or_create means: use it if it exists, create it if it does not.
collection = client.get_or_create_collection(
    name="echo_notes",
    metadata={"hnsw:space": "cosine"}  # use cosine similarity for semantic search
)

existing_count = collection.count()
print(f"Database location: {os.path.abspath(DB_PATH)}")
print(f"Notes already in database: {existing_count}")

# STEP 2: Load the embedding model ─
print("\n STEP 2: Loading embedding model ")
model = SentenceTransformer("all-MiniLM-L6-v2")
print("Model ready.")

# STEP 3: Add test notes
# They are grouped into three loose themes: music, visual art, writing.
# Check whether queries surface the right theme.

test_notes = [
    # Music theme
    {"id": "note_001", "text": "Recorded a chord progression in D minor that feels melancholic. Might work for the bridge section.", "source_type": "text"},
    {"id": "note_002", "text": "Voice memo: the rhythm pattern I heard at the cafe - syncopated beat with a lot of space between hits.", "source_type": "audio_transcript"},
    {"id": "note_003", "text": "Thinking about how silence in music creates tension. Miles Davis used space deliberately.", "source_type": "text"},
    {"id": "note_004", "text": "The melody I hummed in the shower - starts on the fifth, drops to the third, then resolves.", "source_type": "text"},

    # Visual art / colour theme
    {"id": "note_005", "text": "The colour palette from that exhibition - deep terracotta against pale sage green. Very earthy.", "source_type": "text"},
    {"id": "note_006", "text": "Sketch idea: layered translucent shapes that create depth through overlap, like geological strata.", "source_type": "text"},
    {"id": "note_007", "text": "Image caption: photograph of morning light through curtains - diffused golden yellow, soft shadows.", "source_type": "image_caption"},
    {"id": "note_008", "text": "Thinking about negative space in composition. What you leave out defines what you keep in.", "source_type": "text"},

    # Writing / narrative theme
    {"id": "note_009", "text": "Character idea: someone who collects receipts because they fear forgetting where they have been.", "source_type": "text"},
    {"id": "note_010", "text": "The opening line I keep coming back to: she had lived in that city long enough to know which streets to avoid.", "source_type": "text"},
    {"id": "note_011", "text": "Thinking about unreliable narrators - the gap between what they say and what the reader infers.", "source_type": "text"},
    {"id": "note_012", "text": "Memory is always a reconstruction. Every time you recall something you change it slightly.", "source_type": "text"},
]

# Only add notes that are not already in the database (avoids duplicate ID errors on second run)
existing_ids = set()
if existing_count > 0:
    existing_ids = set(collection.get()["ids"])
    print(f"\n STEP 3: Notes already exist, skipping {len(existing_ids)} already stored ")
else:
    print(f"\n STEP 3: Adding {len(test_notes)} notes to database ")

notes_to_add = [n for n in test_notes if n["id"] not in existing_ids]

if notes_to_add:
    start = time.time()
    texts = [n["text"] for n in notes_to_add]
    ids = [n["id"] for n in notes_to_add]
    metadatas = [{"source_type": n["source_type"]} for n in notes_to_add]

    # Generate embeddings for all notes at once (batching is more efficient)
    embeddings = model.encode(texts).tolist()

    # Store everything in ChromaDB
    collection.add(
        ids=ids,
        documents=texts,
        embeddings=embeddings,
        metadatas=metadatas
    )
    print(f"Added {len(notes_to_add)} notes in {time.time() - start:.2f} seconds")
else:
    print("All notes already in database.")

print(f"Total notes in database: {collection.count()}")

# STEP 4: Query the database

print("\n STEP 4: Querying 'improvisation and spontaneous musical ideas' ")

query_text = "improvisation and spontaneous musical ideas"
query_embedding = model.encode([query_text]).tolist()

results = collection.query(
    query_embeddings=query_embedding,
    n_results=3,
    include=["documents", "distances", "metadatas"]
)

for i, (doc, distance, meta) in enumerate(zip(
    results["documents"][0],
    results["distances"][0],
    results["metadatas"][0]
)):
    # ChromaDB with cosine space returns distance (lower = more similar)
    # Convert to similarity score: 1 - distance
    similarity = 1 - distance
    print(f"  Match {i+1} (similarity: {similarity:.3f}) [{meta['source_type']}]")
    print(f"  \"{doc[:100]}...\"" if len(doc) > 100 else f"  \"{doc}\"")
    print()

# STEP 5: Second query (different theme)
print(" STEP 5: Second query - 'colour and visual composition in artwork' ")

query_text_2 = "colour and visual composition in artwork"
query_embedding_2 = model.encode([query_text_2]).tolist()

results_2 = collection.query(
    query_embeddings=query_embedding_2,
    n_results=3,
    include=["documents", "distances", "metadatas"]
)

for i, (doc, distance, meta) in enumerate(zip(
    results_2["documents"][0],
    results_2["distances"][0],
    results_2["metadatas"][0]
)):
    similarity = 1 - distance
    print(f"  Match {i+1} (similarity: {similarity:.3f}) [{meta['source_type']}]")
    print(f"  \"{doc[:100]}...\"" if len(doc) > 100 else f"  \"{doc}\"")
    print()

# STEP 6: Persistence test instructions
# Test by running script again without changes to check that notes survive restarts.
print(" STEP 6: Persistence confirmation ")
print(f"Notes saved to disk at: {os.path.abspath(DB_PATH)}")