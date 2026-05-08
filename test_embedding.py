# Loads two sentence embedding models, encodes some test sentences, and 
# computes similarity scores between them. 
 
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np
import time
 
# STEP 1: Load the smaller, faster model first
print("\n STEP 1: Loading all-MiniLM-L6-v2 (small, fast model)")
 
start = time.time()
model_mini = SentenceTransformer("all-MiniLM-L6-v2")
print(f"Loaded in {time.time() - start:.2f} seconds")
 
# STEP 2: Encode five test sentences (variable semantic similarity)
print("\n STEP 2: Encoding 5 test sentences")
 
sentences = [
    "A musician records a melody idea on their phone at 3am.",      # creative/music
    "The artist sketched a new character concept in her notebook.",  # creative/visual
    "I need to buy milk, eggs, and bread from the supermarket.",    # unrelated (shopping)
    "Improvisation is central to jazz composition and performance.", # creative/music
    "She photographed the colour palette she wanted to use.",       # creative/visual
]
 
start = time.time()
embeddings = model_mini.encode(sentences)
print(f"Encoded 5 sentences in {time.time() - start:.2f} seconds")
print(f"Each embedding shape: {embeddings[0].shape}")
 
# STEP 3: Compute similarity scores
print("\n STEP 3: Similarity scores")
 
similarity_matrix = cosine_similarity(embeddings)
 
pairs = [
    (0, 3, "Musician/3am memo  ↔  Jazz improvisation"),
    (0, 1, "Musician/3am memo  ↔  Artist sketching"),
    (1, 4, "Artist sketching   ↔  Colour palette photo"),
    (0, 2, "Musician/3am memo  ↔  Grocery list"),
    (2, 3, "Grocery list       ↔  Jazz improvisation"),
]
 
for i, j, label in pairs:
    score = similarity_matrix[i][j]
    bar = "█" * int(score * 20)
    print(f"  {score:.3f} {bar:<20} {label}")
 
# STEP 4: Test the larger, higher-quality model
print("\n STEP 4: Loading all-mpnet-base-v2")
 
start = time.time()
model_mpnet = SentenceTransformer("all-mpnet-base-v2")
print(f"Loaded in {time.time() - start:.2f} seconds")
 
start = time.time()
embeddings_mpnet = model_mpnet.encode(sentences)
encode_time_mpnet = time.time() - start
print(f"Encoded 5 sentences in {encode_time_mpnet:.2f} seconds")
print(f"Each embedding shape: {embeddings_mpnet[0].shape}")
 
# STEP 5: Compare the two models
print("\n STEP 5: Same similarity scores with mpnet")
 
similarity_matrix_mpnet = cosine_similarity(embeddings_mpnet)
 
for i, j, label in pairs:
    score = similarity_matrix_mpnet[i][j]
    bar = "█" * int(score * 20)
    print(f"  {score:.3f} {bar:<20} {label}")
 
# STEP 6: Record your findings

print("\n STEP 6: Summary")
print(f"  Music<>Jazz similarity (MiniLM): {similarity_matrix[0][3]:.3f}")
print(f"  Music<>Jazz similarity (mpnet):  {similarity_matrix_mpnet[0][3]:.3f}")
print(f"  Music<>Shopping (MiniLM):        {similarity_matrix[0][2]:.3f}")
print(f"  Music<>Shopping (mpnet):         {similarity_matrix_mpnet[0][2]:.3f}")